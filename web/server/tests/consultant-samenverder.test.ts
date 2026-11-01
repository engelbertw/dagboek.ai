import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activiteiten, calls, consultantDebriefs, employees, klanten, samenverderProgrammas, samenverderSessieConsultants, samenverderSessieOnderwerpen, samenverderSessies } from '../schema.js';
import { registreerVariant, verwijderVariant } from '../consultant-varianten.js';
import { SAMENVERDER_VARIANT, controleerSamenverderData } from '../consultant-samenverder.js';
import { vandaagNL } from '../samenvatten.js';
import { SERVICE_KEY, maakTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); verwijderVariant('samenverder'); });
beforeEach(() => { registreerVariant(SAMENVERDER_VARIANT); });

const SLEUTEL = { 'x-service-key': SERVICE_KEY };
const NUMMER = '0612345678';
const VERHAAL = 'Vandaag hebben we de inrichting van het zaaksysteem besproken en dat onderwerp is afgerond. Als volgende onderwerp stel ik de archivering voor. De gemeente stuurt de testdata niet op ondanks drie afspraken. De dag duurde een hele dag.';
const transcript = (keuze = 'Over een SamenVerder-dag bij Gemeente Voorbeeld.') => [
  { role: 'assistant', content: 'Goedemorgen Karin. Ik ben een AI-assistent en maak een verslag van dit gesprek. Vind je dat goed?' },
  { role: 'user', content: 'Ja, dat is goed.' },
  { role: 'assistant', content: 'Waar wil je een debrief over geven: een project, een module-implementatie of een SamenVerder-dag?' },
  { role: 'user', content: keuze },
  { role: 'assistant', content: 'Vertel maar.' },
  { role: 'user', content: VERHAAL },
];
const sv = (over: Record<string, unknown> = {}) => ({
  dagtype: 'uitvoering', dagtype_citaat: 'een hele dag', doel: '', doel_citaat: '', onderwerp: 'Inrichting zaaksysteem', onderwerp_citaat: 'de inrichting van het zaaksysteem besproken',
  afgerond: 'ja', afgerond_citaat: 'dat onderwerp is afgerond',
  sessie_voorstel: { uitgevoerd: 'ja', duur_dagen: 1, citaat: 'De dag duurde een hele dag' },
  volgend_onderwerp: 'Archivering', volgend_onderwerp_citaat: 'stel ik de archivering voor', extra_sessie_nodig: null, extra_sessie_citaat: '', evaluatie: '', evaluatie_citaat: '',
  samenwerkingssignalen: [{ omschrijving: 'De gemeente levert afgesproken testdata niet aan', citaat: 'De gemeente stuurt de testdata niet op ondanks drie afspraken' }], ...over,
});
const antwoord = (data: Record<string, unknown> = sv()) => ({
  toestemming: 'gegeven', toestemming_citaat: 'Ja, dat is goed',
  variant: { id: 'samenverder', bron: 'mondeling_gekozen', citaat: 'Over een SamenVerder-dag bij Gemeente Voorbeeld' },
  klant: { naam: 'Gemeente Voorbeeld', bestaand: 'Gemeente Voorbeeld' }, samenvatting: 'Inrichting afgerond.', werkzaamheden: ['Ingericht'],
  punten: [{ soort: 'actie', omschrijving: 'Testdata aanleveren', citaat: 'De gemeente stuurt de testdata niet op', eigenaar: 'Gemeente', deadline: null, deadline_citaat: '' }],
  contacten: [], afgeronde_activiteiten: [], variantdata: data,
});

interface Opzet { programma?: boolean; sessies?: { toewijzen?: boolean; offset?: number }[]; volgende?: boolean }
async function maakT(extractie: unknown = antwoord()) {
  const t = await maakTestApp({ gebeld: true, call_id: 'c1' }, async () => JSON.stringify(extractie));
  open.push(t);
  await t.api('PUT', '/api/instellingen/inkomend', { aan: true });
  await t.api('PUT', '/api/instellingen/consultant-debrief', { aan: true });
  const [klant] = await t.db.insert(klanten).values({ naam: 'Gemeente Voorbeeld', status: 'klant' }).returning();
  await t.api('POST', '/api/employees', { naam: 'Karin Test', telefoon: NUMMER, rol: 'medewerker', consultant: true, toestemming: false });
  const [karin] = await t.db.select().from(employees).where(eq(employees.naam, 'Karin Test'));
  return { t, klant, karin };
}
const datumPlus = (n: number) => new Date(new Date(`${vandaagNL()}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

async function zetOp(t: T, klantId: string, karinId: string, opzet: Opzet) {
  const sessies: { id: string }[] = [];
  if (opzet.programma !== false) {
    const [p] = await t.db.insert(samenverderProgrammas).values({ klantId, periodeVan: '2026-01-01', pakket: 'Test' }).returning();
    for (const o of opzet.sessies ?? [{ toewijzen: true, offset: 0 }]) {
      const [s] = await t.db.insert(samenverderSessies).values({ programmaId: p.id, datum: datumPlus(o.offset ?? 0), status: 'gepland' }).returning();
      if (o.toewijzen !== false) await t.db.insert(samenverderSessieConsultants).values({ sessieId: s.id, employeeId: karinId });
      sessies.push(s);
    }
    if (opzet.volgende) sessies.push((await t.db.insert(samenverderSessies).values({ programmaId: p.id, datum: datumPlus(14), status: 'gepland' }).returning())[0]);
    return { programma: p, sessies };
  }
  return { programma: null, sessies };
}

async function bel(t: T, tr = transcript()) {
  const start = (await t.app.inject({ method: 'POST', url: '/api/intern/inkomend/start', headers: SLEUTEL, payload: { beller: NUMMER } })).json();
  await t.app.inject({ method: 'POST', url: `/api/intern/calls/${start.callId}/resultaat`, headers: SLEUTEL, payload: { status: 'gesproken', transcript: tr } });
  await t.klaarMetAchtergrond();
  const [debrief] = await t.db.select().from(consultantDebriefs).where(eq(consultantDebriefs.callId, start.callId));
  return { start, debrief };
}

describe('SamenVerder-debrief', () => {
  it('koppelt aan de geplande sessie en laat de planning ongemoeid', async () => {
    const { t, klant, karin } = await maakT();
    const { programma, sessies } = await zetOp(t, klant.id, karin.id, { volgende: true });
    const { debrief } = await bel(t);
    expect(debrief).toMatchObject({ variant: 'samenverder', programmaId: programma!.id, sessieId: sessies[0].id, controleNodig: false, promptVersie: 'consultant-samenverder-v1' });
    const [sessie] = await t.db.select().from(samenverderSessies).where(eq(samenverderSessies.id, sessies[0].id));
    expect(sessie).toMatchObject({ status: 'gepland', bevestigdOp: null, doel: null, omvangDagen: '1.00' });
    expect(debrief.variantdata).toMatchObject({ sessie_voorstel: { uitgevoerd: true, duur_dagen: 1 }, afgerond: true });
    const acts = await t.db.select().from(activiteiten).where(eq(activiteiten.callId, debrief.callId));
    expect(acts.length).toBe(2);
    expect(acts.every((a) => a.samenverderSessieId === sessies[0].id && a.samenverderProgrammaId === programma!.id)).toBe(true);
    expect(acts.find((a) => a.soort === 'risico')).toMatchObject({ details: { categorie: 'samenwerking' }, citaat: expect.stringContaining('testdata') });
  });

  it('hangt het voorgestelde volgende onderwerp aan de eerstvolgende geplande sessie', async () => {
    const { t, klant, karin } = await maakT();
    const { sessies } = await zetOp(t, klant.id, karin.id, { volgende: true });
    await bel(t);
    const rijen = await t.db.select().from(samenverderSessieOnderwerpen);
    expect(rijen).toHaveLength(1);
    expect(rijen[0]).toMatchObject({ sessieId: sessies[1].id, titel: 'Archivering', status: 'voorgesteld', voorgesteldInSessieId: sessies[0].id });
  });

  it('maakt geen programma of sessie aan als er geen programma is', async () => {
    const { t, klant, karin } = await maakT();
    await zetOp(t, klant.id, karin.id, { programma: false });
    const { debrief } = await bel(t);
    expect(debrief).toMatchObject({ programmaId: null, sessieId: null, controleNodig: true, controleReden: 'programma_onbekend' });
    expect(await t.db.select().from(samenverderProgrammas)).toHaveLength(0);
    expect(await t.db.select().from(samenverderSessies)).toHaveLength(0);
  });

  it('koppelt bij twee mogelijke sessies geen enkele en meldt sessie_onbekend', async () => {
    const { t, klant, karin } = await maakT();
    const { programma } = await zetOp(t, klant.id, karin.id, { sessies: [{ toewijzen: true, offset: 0 }, { toewijzen: true, offset: -1 }] });
    const { debrief } = await bel(t);
    expect(debrief).toMatchObject({ programmaId: programma!.id, sessieId: null, controleNodig: true, controleReden: 'sessie_onbekend' });
  });

  it('koppelt niet aan een sessie van een andere consultant', async () => {
    const { t, klant, karin } = await maakT();
    const [ander] = await t.db.insert(employees).values({ naam: 'Piet Ander', telefoon: '0687654321', rol: 'medewerker', consultant: true }).returning();
    const { programma, sessies } = await zetOp(t, klant.id, ander.id, { sessies: [{ toewijzen: false }] });
    await t.db.insert(samenverderSessieConsultants).values({ sessieId: sessies[0].id, employeeId: ander.id });
    const { debrief } = await bel(t);
    expect(debrief).toMatchObject({ programmaId: programma!.id, sessieId: null, controleReden: 'sessie_onbekend' });
    void karin;
  });

  it('accepteert een door de planning voorgestelde variant als de consultant die bevestigt', async () => {
    const extractie = antwoord(); extractie.variant = { id: 'samenverder', bron: 'context_bevestigd', citaat: 'Ja, dat klopt' };
    const { t, klant, karin } = await maakT(extractie);
    await zetOp(t, klant.id, karin.id, {});
    const tr = transcript();
    tr.splice(2, 2, { role: 'assistant', content: 'Volgens de planning was je vandaag bij Gemeente Voorbeeld voor een SamenVerder-dag. Klopt dat?' }, { role: 'user', content: 'Ja, dat klopt' });
    const { debrief } = await bel(t, tr);
    expect(debrief).toMatchObject({ variant: 'samenverder', variantBron: 'context_bevestigd', controleNodig: false });
  });

  it('weigert context_bevestigd zonder voorstel uit de planning', async () => {
    const extractie = antwoord(); extractie.variant = { id: 'samenverder', bron: 'context_bevestigd', citaat: 'Ja, dat klopt' };
    const { t, klant, karin } = await maakT(extractie);
    await zetOp(t, klant.id, karin.id, { sessies: [{ toewijzen: true, offset: 3 }] });
    const tr = transcript();
    tr.splice(2, 2, { role: 'assistant', content: 'Volgens de planning was je vandaag bij Gemeente Voorbeeld voor een SamenVerder-dag. Klopt dat?' }, { role: 'user', content: 'Ja, dat klopt' });
    const { debrief } = await bel(t, tr);
    expect(debrief).toMatchObject({ variant: null, controleNodig: true, controleReden: 'variant_onzeker' });
  });

  it('laat een signaal zonder echt citaat en een onbewezen veld weg', () => {
    const tr = transcript();
    const r = controleerSamenverderData(sv({ afgerond_citaat: 'verzonnen zin', samenwerkingssignalen: [{ omschrijving: 'Slechte sfeer', citaat: 'dit zei niemand' }] }), tr) as Record<string, unknown>;
    expect(r.afgerond).toBeNull();
    expect(r.samenwerkingssignalen).toEqual([]);
    expect(r.volgend_onderwerp).toBe('Archivering');
  });

  it('bewaart een sessievoorstel alleen met bewijs', () => {
    const r = controleerSamenverderData(sv({ sessie_voorstel: { uitgevoerd: 'ja', duur_dagen: 2, citaat: 'niet gezegd' } }), transcript()) as { sessie_voorstel: { uitgevoerd: unknown } };
    expect(r.sessie_voorstel.uitgevoerd).toBeNull();
  });
});

describe('planningsvoorstel bij inkomend bellen', () => {
  it('bewaart een voorstel bij precies één sessie vandaag', async () => {
    const { t, klant, karin } = await maakT();
    await zetOp(t, klant.id, karin.id, {});
    const start = (await t.app.inject({ method: 'POST', url: '/api/intern/inkomend/start', headers: SLEUTEL, payload: { beller: NUMMER } })).json();
    expect(start.voorstel).toEqual({ variant: 'samenverder', klant: 'Gemeente Voorbeeld' });
    const [call] = await t.db.select().from(calls).where(eq(calls.id, start.callId));
    expect(call.context).toEqual({ variant: { waarde: 'samenverder', noemt: 'Gemeente Voorbeeld' } });
  });

  it('doet geen voorstel bij twee sessies vandaag', async () => {
    const { t, klant, karin } = await maakT();
    await zetOp(t, klant.id, karin.id, { sessies: [{ toewijzen: true, offset: 0 }, { toewijzen: true, offset: 0 }] });
    const start = (await t.app.inject({ method: 'POST', url: '/api/intern/inkomend/start', headers: SLEUTEL, payload: { beller: NUMMER } })).json();
    expect(start.voorstel).toBeNull();
  });

  it('doet geen voorstel zonder sessie vandaag', async () => {
    const { t, klant, karin } = await maakT();
    await zetOp(t, klant.id, karin.id, { sessies: [{ toewijzen: true, offset: 3 }] });
    const start = (await t.app.inject({ method: 'POST', url: '/api/intern/inkomend/start', headers: SLEUTEL, payload: { beller: NUMMER } })).json();
    expect(start.voorstel).toBeNull();
  });
});
