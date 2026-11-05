import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { activiteiten, bezoeken, calls, klanten, suggesties, topics, updates } from '../schema.js';
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

  async function metDagboekuitvoer() {
    const s = await scenario({ samenvattingStatus: 'klaar', samenvattingRuw: { onderwerpen: [{ nr: 1, afgeronde_open_punten: [{ nr: 1 }] }] } });
    const [topic] = await s.t.db.insert(topics).values({ titel: 'Eigen project', eigenaarId: s.m.id }).returning();
    const [ander] = await s.t.db.insert(calls).values({ employeeId: s.m.id, status: 'gesproken', bron: 'schema', type: 'dagboek', samenvattingStatus: 'klaar' }).returning();
    await s.t.db.insert(updates).values([{ topicId: topic.id, callId: s.callId, bron: 'voice', samenvatting: 'Uit dit gesprek' }, { topicId: topic.id, callId: ander.id, bron: 'voice', samenvatting: 'Uit een ander gesprek' }]);
    await s.t.db.insert(activiteiten).values([{ soort: 'intern', omschrijving: 'Dit gesprek', callId: s.callId }, { soort: 'intern', omschrijving: 'Ander gesprek', callId: ander.id }]);
    await s.t.db.insert(suggesties).values([{ soort: 'verbetering', tekst: 'Dit gesprek', callId: s.callId }, { soort: 'verbetering', tekst: 'Ander gesprek', callId: ander.id }]);
    return { ...s, ander: ander.id };
  }

  it('toont eerst wat er verwijderd zou worden en wijzigt niets zonder bevestiging', async () => {
    const s = await metDagboekuitvoer();
    const r = await s.t.api('POST', `/api/calls/${s.callId}/als-debrief`, { route: 'verkoop' });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ reden: 'al_verwerkt', uitvoer: { updates: 1, punten: 1, suggesties: 1 }, gevolgen: { puntenAfgerondOfGemarkeerd: 1 } });
    expect((await s.t.db.select().from(calls).where(eq(calls.id, s.callId)))[0]).toMatchObject({ type: 'dagboek', samenvattingStatus: 'klaar' });
    expect(await s.t.db.select().from(updates)).toHaveLength(2);
    expect(await s.t.db.select().from(bezoeken)).toHaveLength(0);
  });

  it('ruimt met bevestiging alleen de uitvoer van dit gesprek op en verwerkt het dan als debrief', async () => {
    const s = await metDagboekuitvoer();
    const r = await s.t.api('POST', `/api/calls/${s.callId}/als-debrief`, { route: 'verkoop', opruimen: true });
    expect(r.statusCode).toBe(202);
    expect((await s.t.db.select().from(calls).where(eq(calls.id, s.callId)))[0]).toMatchObject({ type: 'verkoop_debrief', routeBron: 'beheerder', samenvattingStatus: 'klaar' });
    // Wat bij een ander gesprek hoort blijft staan.
    expect((await s.t.db.select().from(updates)).map((u) => u.samenvatting)).toEqual(['Uit een ander gesprek']);
    expect((await s.t.db.select().from(activiteiten)).filter((a) => a.soort === 'intern').map((a) => a.omschrijving)).toEqual(['Ander gesprek']);
    expect((await s.t.db.select().from(suggesties)).map((x) => x.tekst)).toEqual(['Ander gesprek']);
    expect(await s.t.db.select().from(bezoeken)).toHaveLength(1);
    const log = (await s.t.api('GET', `/api/calls/${s.callId}/verloop`)).json().map((l: { gebeurtenis: string }) => l.gebeurtenis);
    expect(log).toContain('omgezet_van:dagboek:verwijderd_updates=1_punten=1_suggesties=1');
  });

  it('zet een als dagboek samengevat gesprek zonder uitvoer direct om', async () => {
    const s = await scenario({ samenvattingStatus: 'klaar' });
    const r = await s.t.api('POST', `/api/calls/${s.callId}/als-debrief`, { route: 'verkoop' });
    expect(r.statusCode).toBe(202);
    expect((await s.t.db.select().from(calls).where(eq(calls.id, s.callId)))[0]).toMatchObject({ type: 'verkoop_debrief', samenvattingStatus: 'klaar' });
  });

  it('weigert opruimen als een punt al naar Jira is gezet, of als het gesprek nu wordt samengevat', async () => {
    const s = await metDagboekuitvoer();
    await s.t.db.update(activiteiten).set({ jiraSleutel: 'DAG-1' }).where(eq(activiteiten.callId, s.callId));
    const r = await s.t.api('POST', `/api/calls/${s.callId}/als-debrief`, { route: 'verkoop', opruimen: true });
    expect(r.json()).toMatchObject({ reden: 'punt_in_jira' });
    expect((await s.t.db.select().from(updates)).length).toBe(2);
    await s.t.db.update(calls).set({ samenvattingStatus: 'bezig' }).where(eq(calls.id, s.callId));
    expect((await s.t.api('POST', `/api/calls/${s.callId}/als-debrief`, { route: 'verkoop', opruimen: true })).json()).toMatchObject({ reden: 'bezig' });
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
