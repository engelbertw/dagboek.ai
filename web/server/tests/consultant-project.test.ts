import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activiteiten, consultantDebriefs, employees, klanten, topics, updates } from '../schema.js';
import { registreerVariant, verwijderVariant } from '../consultant-varianten.js';
import { PROJECT_VARIANT, controleerProjectData } from '../consultant-project.js';
import { magDoen } from '../rollen.js';
import { SERVICE_KEY, maakTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); verwijderVariant('project'); });
beforeEach(() => registreerVariant(PROJECT_VARIANT));

const SLEUTEL = { 'x-service-key': SERVICE_KEY };
const NUMMER = '0612345678';
const VERHAAL = 'In het project Zaakgericht werken hebben we de zaaktypen ingericht. We zitten nu in de uitvoering. De koppeling met het zaaksysteem blokkeert de livegang. Mevrouw De Boer levert de testlijst aan.';
const transcript = (verhaal = VERHAAL) => [
  { role: 'assistant', content: 'Goedemorgen Karin. Ik ben een AI-assistent en maak een verslag van dit gesprek. Vind je dat goed?' },
  { role: 'user', content: 'Ja, dat is goed.' },
  { role: 'assistant', content: 'Waar wil je een debrief over geven: een project?' },
  { role: 'user', content: 'Over een project bij Gemeente Voorbeeld.' },
  { role: 'assistant', content: 'Vertel maar.' },
  { role: 'user', content: verhaal },
];

const antwoord = (over: Record<string, unknown> = {}, onderwerp: Record<string, string> = { genoemd: 'Zaakgericht werken', bestaand: 'Zaakgericht werken' }, extra: Record<string, unknown> = {}) => ({
  toestemming: 'gegeven', toestemming_citaat: 'Ja, dat is goed',
  variant: { id: 'project', bron: 'mondeling_gekozen', citaat: 'Over een project bij Gemeente Voorbeeld' },
  klant: { naam: 'Gemeente Voorbeeld', bestaand: 'Gemeente Voorbeeld' },
  samenvatting: 'Zaaktypen ingericht; koppeling blokkeert de livegang.', werkzaamheden: ['Zaaktypen ingericht'],
  punten: [
    { soort: 'resultaat', omschrijving: 'Zaaktypen voor Gemeente Voorbeeld ingericht in de testomgeving', citaat: 'we de zaaktypen ingericht', eigenaar: '', deadline: null, deadline_citaat: '' },
    { soort: 'blokkade', omschrijving: 'Koppeling met het zaaksysteem blokkeert de livegang', citaat: 'De koppeling met het zaaksysteem blokkeert de livegang', eigenaar: '', deadline: null, deadline_citaat: '' },
  ],
  contacten: [], afgeronde_activiteiten: [],
  variantdata: { onderwerp, fase: 'uitvoering', fase_citaat: 'We zitten nu in de uitvoering', volgende_mijlpaal: '', mijlpaal_citaat: '', ...extra },
  ...over,
});

async function scenario(extractie: unknown, opzet: { klantProject?: 'zelfde' | 'andere' | 'geen'; verhaal?: string } = {}) {
  const vragen: string[] = [];
  const t = await maakTestApp({ gebeld: true, call_id: 'c1' }, async (_s, gebruiker) => { vragen.push(gebruiker); return JSON.stringify(extractie); });
  open.push(t);
  await t.api('PUT', '/api/instellingen/inkomend', { aan: true });
  await t.api('PUT', '/api/instellingen/consultant-debrief', { aan: true });
  const [klant] = await t.db.insert(klanten).values({ naam: 'Gemeente Voorbeeld', status: 'klant' }).returning();
  const [andere] = await t.db.insert(klanten).values({ naam: 'Gemeente Elders', status: 'klant' }).returning();
  const soort = opzet.klantProject ?? 'zelfde';
  const [project] = await t.db.insert(topics).values({ titel: 'Zaakgericht werken', type: 'project', klantId: soort === 'zelfde' ? klant.id : soort === 'andere' ? andere.id : null }).returning();
  await t.api('POST', '/api/employees', { naam: 'Karin Test', telefoon: NUMMER, rol: 'medewerker', consultant: true, toestemming: false });
  const start = (await t.app.inject({ method: 'POST', url: '/api/intern/inkomend/start', headers: SLEUTEL, payload: { beller: NUMMER } })).json();
  const r = await t.app.inject({ method: 'POST', url: `/api/intern/calls/${start.callId}/resultaat`, headers: SLEUTEL, payload: { status: 'gesproken', transcript: transcript(opzet.verhaal) } });
  await t.klaarMetAchtergrond();
  const [debrief] = await t.db.select().from(consultantDebriefs).where(eq(consultantDebriefs.callId, start.callId));
  const punten = await t.db.select().from(activiteiten).where(eq(activiteiten.callId, start.callId));
  return { t, r, klant, andere, project, debrief, punten, vragen };
}

describe('projectdebrief', () => {
  it('koppelt aan een bestaand project van dezelfde gemeente en bewaart alleen bewezen voortgang', async () => {
    const s = await scenario(antwoord());
    expect(s.debrief).toMatchObject({ variant: 'project', klantId: s.klant.id, topicId: s.project.id, controleNodig: false, controleReden: null, promptVersie: 'consultant-project-v1' });
    expect(s.debrief.variantdata).toMatchObject({ fase: 'uitvoering' });
    expect(s.punten).toHaveLength(2);
    expect(s.punten.every((p) => p.topicId === s.project.id && p.klantId === s.klant.id)).toBe(true);
  });

  it('geeft het model de lijst met bekende projecten mee', async () => {
    const s = await scenario(antwoord());
    expect(s.vragen[0]).toContain('<onderwerpen>\n- [Gemeente Voorbeeld] Zaakgericht werken\n</onderwerpen>');
  });

  it('maakt een onbekend project nooit aan maar zet het onder Controle nodig', async () => {
    const s = await scenario(antwoord({}, { genoemd: 'Zaakgericht werken', bestaand: '' }), { klantProject: 'geen' });
    // Een project zonder gemeente is wel herkend op naam, maar nog niet van deze gemeente.
    expect(s.debrief.topicId).toBeNull();
    expect(s.debrief.controleReden).toBe('onderwerp_klant_koppelen');
    const onbekend = await scenario(antwoord({}, { genoemd: 'Digitaal loket', bestaand: '' }), { verhaal: VERHAAL.replace('Zaakgericht werken', 'Digitaal loket') });
    expect(onbekend.debrief).toMatchObject({ topicId: null, controleNodig: true, controleReden: 'onderwerp_onbekend' });
    expect(onbekend.debrief.variantdata).toMatchObject({ genoemd_onderwerp: 'Digitaal loket' });
    expect(await onbekend.t.db.select().from(topics)).toHaveLength(1);
  });

  it('koppelt niet aan een project van een andere gemeente', async () => {
    const s = await scenario(antwoord(), { klantProject: 'andere' });
    expect(s.debrief).toMatchObject({ topicId: null, controleNodig: true, controleReden: 'klant_inconsistent' });
    expect(s.punten.every((p) => p.topicId === null)).toBe(true);
    const [p] = await s.t.db.select().from(topics).where(eq(topics.id, s.project.id));
    expect(p.klantId).toBe(s.andere.id);
  });

  it('laat een project weg dat niet in het gesprek genoemd werd, ook als het model het in de lijst aanwijst', async () => {
    const s = await scenario(antwoord(), { verhaal: 'We hebben de zaaktypen ingericht. We zitten nu in de uitvoering. De koppeling met het zaaksysteem blokkeert de livegang.' });
    expect(s.debrief).toMatchObject({ topicId: null, controleReden: 'onderwerp_onbekend' });
  });

  it('wijzigt het project zelf niet', async () => {
    const s = await scenario(antwoord());
    const [p] = await s.t.db.select().from(topics).where(eq(topics.id, s.project.id));
    expect(p).toMatchObject({ status: 'actief', titel: 'Zaakgericht werken', klantId: s.klant.id });
    expect(await s.t.db.select().from(updates)).toHaveLength(0);
  });
});

describe('controleerProjectData', () => {
  const t = transcript();
  const basis = { onderwerp: { genoemd: 'Zaakgericht werken', bestaand: '' }, fase: 'uitvoering', fase_citaat: 'We zitten nu in de uitvoering', scope_wijziging: '', scope_citaat: '', volgende_mijlpaal: '', mijlpaal_citaat: '' };
  it('houdt een fase met een citaat uit het gesprek', () => {
    expect(controleerProjectData(basis, t)).toMatchObject({ fase: 'uitvoering', fase_citaat: 'We zitten nu in de uitvoering' });
  });
  it('gooit een fase weg zonder citaat of met een citaat dat niet in het gesprek staat', () => {
    expect(controleerProjectData({ ...basis, fase_citaat: '' }, t)).toMatchObject({ fase: null });
    expect(controleerProjectData({ ...basis, fase_citaat: 'We zitten in de oplevering' }, t)).toMatchObject({ fase: null, fase_citaat: '' });
  });
  it('gooit een mijlpaal en scopewijziging zonder bewijs weg', () => {
    const uit = controleerProjectData({ ...basis, volgende_mijlpaal: 'Livegang', mijlpaal_citaat: 'Volgende maand live', scope_wijziging: 'Extra module', scope_citaat: '' }, t);
    expect(uit).toMatchObject({ volgende_mijlpaal: '', scope_wijziging: '' });
  });
  it('maakt van een onbekende fase geen fase', () => {
    expect(controleerProjectData({ ...basis, fase: 'bijna klaar' }, t)).toMatchObject({ fase: null });
  });
});

describe('bezoekvoorbereiding', () => {
  it('toont bevestigde gegevens met bron en zet niet-bevestigde punten apart', async () => {
    const s = await scenario(antwoord({ contacten: [{ naam: 'Mevrouw De Boer', functie: 'projectleider', rol: '' }] }));
    await s.t.db.insert(activiteiten).values({ klantId: s.klant.id, soort: 'actie', omschrijving: 'Onbevestigde actie', controleNodig: true, controleReden: 'bron_niet_te_verifieren' });
    const r = await s.t.api('GET', `/api/klanten/${s.klant.id}/voorbereiding`);
    expect(r.statusCode).toBe(200);
    const v = r.json();
    expect(v.klant.naam).toBe('Gemeente Voorbeeld');
    expect(v.gesprekken).toHaveLength(1);
    expect(v.gesprekken[0]).toMatchObject({ soort: 'project', bron: 'consultant-debrief', door: 'Karin Test' });
    expect(v.onderwerpen.map((o: { titel: string }) => o.titel)).toEqual(['Zaakgericht werken']);
    expect(v.openPunten.map((p: { omschrijving: string }) => p.omschrijving).sort()).toEqual(['Koppeling met het zaaksysteem blokkeert de livegang', 'Zaaktypen voor Gemeente Voorbeeld ingericht in de testomgeving']);
    expect(v.nietBevestigd.map((p: { omschrijving: string }) => p.omschrijving)).toEqual(['Onbevestigde actie']);
    expect(v.contacten[0]).toMatchObject({ naam: 'Mevrouw De Boer', functie: 'projectleider' });
    expect(v.contacten[0].laatstGesproken).toBeTruthy();
    expect(JSON.stringify(v)).not.toContain('transcript');
  });

  it('telt een debrief die gecontroleerd moet worden niet mee als gesprek maar toont hem apart', async () => {
    const s = await scenario(antwoord({}, { genoemd: 'Digitaal loket', bestaand: '' }), { verhaal: VERHAAL.replace('Zaakgericht werken', 'Digitaal loket') });
    const v = (await s.t.api('GET', `/api/klanten/${s.klant.id}/voorbereiding`)).json();
    expect(v.gesprekken).toHaveLength(0);
    expect(v.nietBevestigd.some((n: { soort: string; reden: string }) => n.soort === 'debrief' && n.reden === 'onderwerp_onbekend')).toBe(true);
  });

  it('geeft een nette lege staat en 404 voor een onbekende gemeente', async () => {
    const t = await maakTestApp();
    open.push(t);
    const [k] = await t.db.insert(klanten).values({ naam: 'Leeg', status: 'klant' }).returning();
    const v = (await t.api('GET', `/api/klanten/${k.id}/voorbereiding`)).json();
    expect(v).toMatchObject({ contacten: [], onderwerpen: [], gesprekken: [], openPunten: [], nietBevestigd: [] });
    expect((await t.api('GET', '/api/klanten/00000000-0000-4000-8000-000000000000/voorbereiding')).statusCode).toBe(404);
    expect((await t.api('GET', '/api/klanten/geen-uuid/voorbereiding')).statusCode).toBe(404);
  });

  it('is leesbaar voor een accountmanager maar niet te wijzigen', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(magDoen('accountmanager', 'GET', `/api/klanten/${id}/voorbereiding`)).toBe(true);
    expect(magDoen('accountmanager', 'POST', `/api/klanten/${id}/voorbereiding`)).toBe(false);
    expect(magDoen('accountmanager', 'GET', '/api/gesprekken')).toBe(false);
  });
});
