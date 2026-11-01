import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activiteiten, consultantDebriefs, implementaties, klantContacten, klanten, topics } from '../schema.js';
import { registreerVariant, verwijderVariant } from '../consultant-varianten.js';
import { PROJECT_VARIANT } from '../consultant-project.js';
import { IMPLEMENTATIE_VARIANT, controleerImplementatieData, isoDatum } from '../consultant-implementatie.js';
import { magDoen } from '../rollen.js';
import { SERVICE_KEY, maakTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); verwijderVariant('project'); verwijderVariant('implementatie'); });
beforeEach(() => { registreerVariant(PROJECT_VARIANT); registreerVariant(IMPLEMENTATIE_VARIANT); });

const SLEUTEL = { 'x-service-key': SERVICE_KEY };
const NUMMER = '0612345678';
const VERHAAL = 'Bij de implementatie Zaken uitrol zijn we klaar met de inrichting en we zitten nu in de testfase. De livegang staat gepland op 1 december 2026. De gemeente heeft op 20 november 2026 akkoord gegeven op de acceptatie. We zijn op 25 november 2026 live gegaan. Binnenkort bellen we nog over de nazorg.';
const transcript = (verhaal = VERHAAL, assistent = 'Vertel maar.', keuze = 'Over een implementatie bij Gemeente Voorbeeld.') => [
  { role: 'assistant', content: 'Goedemorgen Karin. Ik ben een AI-assistent en maak een verslag van dit gesprek. Vind je dat goed?' },
  { role: 'user', content: 'Ja, dat is goed.' },
  { role: 'assistant', content: 'Waar wil je een debrief over geven: een project of een module-implementatie?' },
  { role: 'user', content: keuze },
  { role: 'assistant', content: assistent },
  { role: 'user', content: verhaal },
];
const impl = (over: Record<string, unknown> = {}) => ({
  onderwerp: { genoemd: 'Zaken uitrol', bestaand: 'Zaken uitrol' }, module: 'Zaken',
  fase: 'test', fase_citaat: 'we zitten nu in de testfase', test_status: 'bezig', test_citaat: 'we zitten nu in de testfase',
  geplande_livegang: '2026-12-01', geplande_livegang_citaat: 'De livegang staat gepland op 1 december 2026',
  werkelijke_livegang: '2026-11-25', werkelijke_livegang_citaat: 'We zijn op 25 november 2026 live gegaan',
  acceptatie_op: '2026-11-20', acceptatie_citaat: 'De gemeente heeft op 20 november 2026 akkoord gegeven op de acceptatie',
  nazorg_tot: '2026-12-31', nazorg_citaat: 'Binnenkort bellen we nog over de nazorg', ...over,
});
const antwoord = (data: Record<string, unknown> = impl(), variantId = 'implementatie') => ({
  toestemming: 'gegeven', toestemming_citaat: 'Ja, dat is goed',
  variant: { id: variantId, bron: 'mondeling_gekozen', citaat: variantId === 'implementatie' ? 'Over een implementatie bij Gemeente Voorbeeld' : 'Over een project bij Gemeente Voorbeeld' },
  klant: { naam: 'Gemeente Voorbeeld', bestaand: 'Gemeente Voorbeeld' }, samenvatting: 'Testfase bereikt.', werkzaamheden: ['Ingericht'],
  punten: [{ soort: 'blokkade', omschrijving: 'Koppeling met het zaaksysteem blokkeert de livegang', citaat: 'zijn we klaar met de inrichting', eigenaar: '', deadline: null, deadline_citaat: '' }],
  contacten: [], afgeronde_activiteiten: [], variantdata: data,
});

async function scenario(extractie: unknown, opzet: { verhaal?: string; assistent?: string; impl?: boolean; keuze?: string } = {}) {
  const t = await maakTestApp({ gebeld: true, call_id: 'c1' }, async () => JSON.stringify(extractie));
  open.push(t);
  await t.api('PUT', '/api/instellingen/inkomend', { aan: true });
  await t.api('PUT', '/api/instellingen/consultant-debrief', { aan: true });
  const [klant] = await t.db.insert(klanten).values({ naam: 'Gemeente Voorbeeld', status: 'klant' }).returning();
  const [topic] = await t.db.insert(topics).values({ titel: 'Zaken uitrol', type: 'thema', klantId: klant.id }).returning();
  if (opzet.impl !== false) await t.db.insert(implementaties).values({ topicId: topic.id, module: 'Zaken' });
  await t.api('POST', '/api/employees', { naam: 'Karin Test', telefoon: NUMMER, rol: 'medewerker', consultant: true, toestemming: false });
  const start = (await t.app.inject({ method: 'POST', url: '/api/intern/inkomend/start', headers: SLEUTEL, payload: { beller: NUMMER } })).json();
  await t.app.inject({ method: 'POST', url: `/api/intern/calls/${start.callId}/resultaat`, headers: SLEUTEL, payload: { status: 'gesproken', transcript: transcript(opzet.verhaal, opzet.assistent, opzet.keuze) } });
  await t.klaarMetAchtergrond();
  const [debrief] = await t.db.select().from(consultantDebriefs).where(eq(consultantDebriefs.callId, start.callId));
  const [rij] = await t.db.select().from(implementaties).where(eq(implementaties.topicId, topic.id));
  return { t, klant, topic, debrief, rij, start };
}

describe('implementatiedebrief', () => {
  it('werkt fase, test en geplande livegang bij en bewaart de rest alleen als voorstel', async () => {
    const s = await scenario(antwoord());
    expect(s.debrief).toMatchObject({ variant: 'implementatie', topicId: s.topic.id, controleNodig: false, promptVersie: 'consultant-implementatie-v1' });
    expect(s.rij).toMatchObject({ fase: 'test', testStatus: 'bezig', geplandeLivegang: '2026-12-01', werkelijkeLivegang: null, acceptatieOp: null, nazorgTot: null });
    const v = (await s.t.api('GET', `/api/implementaties/${s.topic.id}`)).json();
    expect(v.voorstellen.map((x: { veld: string }) => x.veld).sort()).toEqual(['acceptatieOp', 'werkelijkeLivegang']);
    expect(v.voorstellen.find((x: { veld: string }) => x.veld === 'acceptatieOp')).toMatchObject({ waarde: '2026-11-20', citaat: expect.stringContaining('akkoord gegeven') });
  });

  it('neemt een voorstel pas over na bevestiging door de beheerder', async () => {
    const s = await scenario(antwoord());
    const v = (await s.t.api('GET', `/api/implementaties/${s.topic.id}`)).json();
    const accept = v.voorstellen.find((x: { veld: string }) => x.veld === 'acceptatieOp');
    const r = await s.t.api('PUT', `/api/implementaties/${s.topic.id}`, { ...v.implementatie, acceptatieOp: accept.waarde, acceptatieCitaat: accept.citaat });
    expect(r.statusCode).toBe(200);
    const na = r.json();
    expect(na.implementatie).toMatchObject({ acceptatieOp: '2026-11-20' });
    expect(na.voorstellen.map((x: { veld: string }) => x.veld)).toEqual(['werkelijkeLivegang']);
  });

  it('laat acceptatie weg als de woorden niet van de consultant komen', async () => {
    const s = await scenario(antwoord(), { verhaal: 'We zitten nu in de testfase bij de implementatie Zaken uitrol.', assistent: 'Heeft de gemeente op 20 november 2026 akkoord gegeven op de acceptatie?' });
    const data = s.debrief.variantdata as Record<string, unknown>;
    expect(data.acceptatie_op).toBeNull();
    expect(data.werkelijke_livegang).toBeNull();
    expect(s.rij.acceptatieOp).toBeNull();
  });

  it('negeert een vage termijn als datum en een onbekende fase', async () => {
    const uit = controleerImplementatieData(impl({ geplande_livegang: '2026-12-15', geplande_livegang_citaat: 'Binnenkort bellen we nog over de nazorg', fase: 'bijna klaar' }), transcript());
    expect(uit).toMatchObject({ geplande_livegang: null, fase: null });
  });

  it('koppelt niet aan een onderwerp dat geen implementatie is', async () => {
    const s = await scenario(antwoord(), { impl: false });
    expect(s.debrief).toMatchObject({ topicId: null, controleReden: 'onderwerp_onbekend' });
  });

  it('biedt een implementatie niet aan als project, en een project niet als implementatie', async () => {
    const s = await scenario(antwoord(impl({ onderwerp: { genoemd: 'Zaken uitrol', bestaand: 'Zaken uitrol' } }), 'project'), { keuze: 'Over een project bij Gemeente Voorbeeld.' });
    expect(s.debrief).toMatchObject({ variant: 'project', topicId: null });
    const [rij] = await s.t.db.select().from(implementaties);
    expect(rij.fase).toBe('voorbereiding');
  });

  it('past niets toe als het onderwerp van een andere gemeente is', async () => {
    const t = await maakTestApp({ gebeld: true, call_id: 'c1' }, async () => JSON.stringify(antwoord()));
    open.push(t);
    await t.api('PUT', '/api/instellingen/inkomend', { aan: true });
    await t.api('PUT', '/api/instellingen/consultant-debrief', { aan: true });
    await t.db.insert(klanten).values({ naam: 'Gemeente Voorbeeld', status: 'klant' });
    const [elders] = await t.db.insert(klanten).values({ naam: 'Gemeente Elders', status: 'klant' }).returning();
    const [topic] = await t.db.insert(topics).values({ titel: 'Zaken uitrol', type: 'thema', klantId: elders.id }).returning();
    await t.db.insert(implementaties).values({ topicId: topic.id, module: 'Zaken' });
    await t.api('POST', '/api/employees', { naam: 'Karin Test', telefoon: NUMMER, rol: 'medewerker', consultant: true, toestemming: false });
    const start = (await t.app.inject({ method: 'POST', url: '/api/intern/inkomend/start', headers: SLEUTEL, payload: { beller: NUMMER } })).json();
    await t.app.inject({ method: 'POST', url: `/api/intern/calls/${start.callId}/resultaat`, headers: SLEUTEL, payload: { status: 'gesproken', transcript: transcript() } });
    await t.klaarMetAchtergrond();
    const [d] = await t.db.select().from(consultantDebriefs).where(eq(consultantDebriefs.callId, start.callId));
    expect(d).toMatchObject({ topicId: null, controleReden: 'klant_inconsistent' });
    const [rij] = await t.db.select().from(implementaties).where(eq(implementaties.topicId, topic.id));
    expect(rij.fase).toBe('voorbereiding');
    expect(await t.db.select().from(activiteiten).where(eq(activiteiten.topicId, topic.id))).toHaveLength(0);
  });
});

describe('implementaties-API', () => {
  async function opzet() {
    const t = await maakTestApp();
    open.push(t);
    const [a] = await t.db.insert(klanten).values({ naam: 'A', status: 'klant' }).returning();
    const [b] = await t.db.insert(klanten).values({ naam: 'B', status: 'klant' }).returning();
    const [topic] = await t.db.insert(topics).values({ titel: 'Uitrol', type: 'thema', klantId: a.id }).returning();
    const [projectA] = await t.db.insert(topics).values({ titel: 'Project A', type: 'project', klantId: a.id }).returning();
    const [projectB] = await t.db.insert(topics).values({ titel: 'Project B', type: 'project', klantId: b.id }).returning();
    const [contactA] = await t.db.insert(klantContacten).values({ klantId: a.id, naam: 'Piet' }).returning();
    const [contactB] = await t.db.insert(klantContacten).values({ klantId: b.id, naam: 'Kees' }).returning();
    return { t, a, b, topic, projectA, projectB, contactA, contactB };
  }

  it('maakt een implementatie aan, werkt haar bij en haalt alleen de markering weg', async () => {
    const o = await opzet();
    expect((await o.t.api('GET', `/api/implementaties/${o.topic.id}`)).json()).toEqual({ implementatie: null, voorstellen: [] });
    const r = await o.t.api('PUT', `/api/implementaties/${o.topic.id}`, { module: 'Zaken', fase: 'inrichting', bovenliggendTopicId: o.projectA.id, contactpersoonId: o.contactA.id, geplandeLivegang: '2026-12-01' });
    expect(r.statusCode).toBe(200);
    expect(r.json().implementatie).toMatchObject({ module: 'Zaken', fase: 'inrichting', geplandeLivegang: '2026-12-01', bovenliggendTopicId: o.projectA.id });
    expect((await o.t.api('GET', '/api/implementaties')).json()).toHaveLength(1);
    expect((await o.t.api('DELETE', `/api/implementaties/${o.topic.id}`)).statusCode).toBe(200);
    expect(await o.t.db.select().from(topics).where(eq(topics.id, o.topic.id))).toHaveLength(1);
    expect((await o.t.api('DELETE', `/api/implementaties/${o.topic.id}`)).statusCode).toBe(404);
  });

  it('weigert ongeldige invoer en koppelingen met een andere gemeente', async () => {
    const o = await opzet();
    const put = (b: unknown, id = o.topic.id) => o.t.api('PUT', `/api/implementaties/${id}`, b);
    expect((await put({ module: '' })).statusCode).toBe(400);
    expect((await put({ module: 'Zaken', fase: 'bijna' })).statusCode).toBe(400);
    expect((await put({ module: 'Zaken', geplandeLivegang: '2026-02-31' })).statusCode).toBe(400);
    expect((await put({ module: 'Zaken', bovenliggendTopicId: o.projectB.id })).statusCode).toBe(400);
    expect((await put({ module: 'Zaken', bovenliggendTopicId: o.topic.id })).statusCode).toBe(400);
    expect((await put({ module: 'Zaken', contactpersoonId: o.contactB.id })).statusCode).toBe(400);
    expect((await put({ module: 'Zaken' }, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await put({ module: 'Zaken' }, 'geen-uuid')).statusCode).toBe(404);
  });

  it('laat de koppelingen vervallen als het onderwerp naar een andere gemeente gaat', async () => {
    const o = await opzet();
    await o.t.api('PUT', `/api/implementaties/${o.topic.id}`, { module: 'Zaken', bovenliggendTopicId: o.projectA.id, contactpersoonId: o.contactA.id });
    expect((await o.t.api('PATCH', `/api/topics/${o.topic.id}`, { titel: 'Uitrol' })).statusCode).toBe(200);
    expect((await o.t.api('GET', `/api/implementaties/${o.topic.id}`)).json().implementatie).toMatchObject({ contactpersoonId: o.contactA.id });
    expect((await o.t.api('PATCH', `/api/topics/${o.topic.id}`, { klantId: o.b.id })).statusCode).toBe(200);
    expect((await o.t.api('GET', `/api/implementaties/${o.topic.id}`)).json().implementatie).toMatchObject({ module: 'Zaken', contactpersoonId: null, bovenliggendTopicId: null });
  });

  it('staat in de bezoekvoorbereiding en is alleen voor de beheerder te wijzigen', async () => {
    const o = await opzet();
    await o.t.api('PUT', `/api/implementaties/${o.topic.id}`, { module: 'Zaken', fase: 'test' });
    const v = (await o.t.api('GET', `/api/klanten/${o.a.id}/voorbereiding`)).json();
    expect(v.implementaties).toEqual([expect.objectContaining({ titel: 'Uitrol', module: 'Zaken', fase: 'test', bron: 'werkregister' })]);
    const id = o.topic.id;
    for (const m of ['GET', 'PUT', 'DELETE']) expect(magDoen('accountmanager', m, `/api/implementaties/${id}`)).toBe(false);
    expect(magDoen('accountmanager', 'GET', '/api/implementaties')).toBe(false);
    expect(magDoen('beheerder', 'PUT', `/api/implementaties/${id}`)).toBe(true);
  });

  it('verwijdert een implementatie samen met haar onderwerp', async () => {
    const o = await opzet();
    await o.t.api('PUT', `/api/implementaties/${o.topic.id}`, { module: 'Zaken' });
    await o.t.api('DELETE', `/api/topics/${o.topic.id}`);
    expect(await o.t.db.select().from(implementaties)).toHaveLength(0);
  });
});

describe('isoDatum', () => {
  it('accepteert alleen echte kalenderdatums', () => {
    expect(isoDatum('2026-12-01')).toBe('2026-12-01');
    for (const x of ['2026-02-31', '1 december', '', null, undefined, '2026-13-01']) expect(isoDatum(x as string)).toBeNull();
  });
});
