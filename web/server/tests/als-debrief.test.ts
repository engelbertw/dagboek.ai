import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { activiteiten, bezoeken, calls, klanten } from '../schema.js';
import { magDoen } from '../rollen.js';
import { maakTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

// Een klantbezoek dat via 'Bel nu' als dagboekgesprek is gevoerd, zoals dat van 5 november.
const TRANSCRIPT = [
  { role: 'assistant', content: 'Goedemorgen Irma. Ik maak een samenvatting van ons gesprek voor het dagboek. Vind je dat goed?' },
  { role: 'user', content: 'Ja, dat is goed. Ik was gisteren bij Gemeente Voorbeeld voor een roadmapgesprek. Ik stuur de offerte voor vrijdag.' },
];
const DEBRIEF = {
  toestemming: 'gegeven', toestemming_citaat: 'Ja, dat is goed',
  klant: { naam: 'Gemeente Voorbeeld', bestaand: '', bezoek_soort: 'vervolg', datum: null, tevredenheid: null },
  samenvatting: 'Roadmapgesprek met de klant.', doelen: [], resultaten: [],
  afspraken: [{ omschrijving: 'Offerte sturen', eigenaar: 'collega', deadline: null, citaat: 'Ik stuur de offerte voor vrijdag' }],
  acties: [], risicos: [], kansen: [], contacten: [],
};

async function scenario(extra: Partial<typeof calls.$inferInsert> = {}) {
  const t = await maakTestApp({ gebeld: true, call_id: 'v1' }, async (systeem) => (systeem.includes('woordenlijst voor spraakherkenning') ? '{"voorstellen":[]}' : JSON.stringify(DEBRIEF)));
  open.push(t);
  const m = (await t.api('POST', '/api/employees', { naam: 'Irma Test', telefoon: '0612345678', rol: 'accountmanager', toestemming: false })).json();
  const [call] = await t.db.insert(calls).values({ employeeId: m.id, status: 'gesproken', bron: 'handmatig', type: 'dagboek', transcript: TRANSCRIPT, ...extra }).returning();
  return { t, m, callId: call.id };
}

describe('dagboekgesprek omzetten naar een debrief', () => {
  it('verwerkt een dagboekgesprek zonder uitvoer alsnog als verkoop-debrief, met bezoek bij de klant', async () => {
    const s = await scenario();
    const r = await s.t.api('POST', `/api/calls/${s.callId}/als-debrief`, { route: 'verkoop' });
    expect(r.statusCode).toBe(202);
    const [c] = await s.t.db.select().from(calls).where(eq(calls.id, s.callId));
    expect(c).toMatchObject({ type: 'verkoop_debrief', routeBron: 'beheerder', samenvattingStatus: 'klaar' });
    const k = await s.t.db.select().from(klanten);
    expect(k.map((x) => x.naam)).toEqual(['Gemeente Voorbeeld']);
    expect((await s.t.db.select().from(bezoeken))).toHaveLength(1);
    // Een tweede keer mag niet meer: het is geen dagboekgesprek meer.
    expect((await s.t.api('POST', `/api/calls/${s.callId}/als-debrief`, { route: 'verkoop' })).json()).toMatchObject({ reden: 'geen_dagboek' });
  });

  it('weigert een gesprek dat het dagboek al heeft verwerkt, zonder iets te wijzigen', async () => {
    const s = await scenario({ samenvattingStatus: 'klaar' });
    const r = await s.t.api('POST', `/api/calls/${s.callId}/als-debrief`, { route: 'verkoop' });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ reden: 'al_verwerkt' });
    const [c] = await s.t.db.select().from(calls).where(eq(calls.id, s.callId));
    expect(c.type).toBe('dagboek');
    expect(await s.t.db.select().from(bezoeken)).toHaveLength(0);
  });

  it('weigert ook als er al een punt aan dit gesprek hangt, bij een nog niet afgeronde samenvatting', async () => {
    const s = await scenario();
    await s.t.db.insert(activiteiten).values({ soort: 'actie', omschrijving: 'Iets uit het dagboek', callId: s.callId });
    const r = await s.t.api('POST', `/api/calls/${s.callId}/als-debrief`, { route: 'verkoop' });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ reden: 'al_verwerkt' });
    expect((await s.t.db.select().from(calls).where(eq(calls.id, s.callId)))[0].type).toBe('dagboek');
  });

  it('weigert een gesprek dat nog niet is afgerond, geen dagboekgesprek is of niet bestaat', async () => {
    const onderweg = await scenario({ status: 'belt', transcript: null });
    expect((await onderweg.t.api('POST', `/api/calls/${onderweg.callId}/als-debrief`, { route: 'verkoop' })).json()).toMatchObject({ reden: 'geen_transcript' });
    const debrief = await scenario({ type: 'verkoop_debrief' });
    expect((await debrief.t.api('POST', `/api/calls/${debrief.callId}/als-debrief`, { route: 'consultancy' })).json()).toMatchObject({ reden: 'geen_dagboek' });
    expect((await debrief.t.api('POST', '/api/calls/00000000-0000-4000-8000-000000000000/als-debrief', { route: 'verkoop' })).statusCode).toBe(404);
    expect((await debrief.t.api('POST', `/api/calls/${debrief.callId}/als-debrief`, { route: 'iets' })).statusCode).toBe(400);
  });

  it('is alleen voor beheerders: accountmanager, administratie en consultant mogen het niet', () => {
    const pad = '/api/calls/11111111-1111-4111-8111-111111111111/als-debrief';
    expect(magDoen('beheerder', 'POST', pad)).toBe(true);
    for (const rol of ['accountmanager', 'administratie', 'consultant']) expect(magDoen(rol, 'POST', pad)).toBe(false);
  });
});
