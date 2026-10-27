import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { calls } from '../schema.js';
import { HERPOGING_NA_MIN, INHAALTIJD_MIN, PAUZE_TUSSEN_GESPREKKEN_MS, nlNaarDate, nlWeekdag, tik, zetAutomatischBellen } from '../scheduler.js';
import { maakTestApp } from './helpers.js';

// Donderdag 29 oktober 2026, 9:00 Nederlandse tijd = 08:00 UTC (wintertijd sinds 25 oktober).
const SLOT = new Date('2026-10-29T08:00:00Z');
const na = (min: number) => new Date(SLOT.getTime() + min * 60_000);

const open: Awaited<ReturnType<typeof maakTestApp>>[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

async function opzet(opties: { dagen?: number[]; tijden?: string[]; maxPogingen?: number; personen?: number } = {}) {
  const t = await maakTestApp({ gebeld: true, call_id: 'v' });
  open.push(t);
  const mensen: any[] = [];
  for (let i = 0; i < (opties.personen ?? 2); i++) mensen.push((await t.api('POST', '/api/employees', { naam: `Collega ${i + 1}`, telefoon: `06123456${i}0` })).json());
  const planning = (await t.api('POST', '/api/plannings', {
    naam: 'Ochtend', dagen: opties.dagen ?? [1, 2, 3, 4, 5], tijden: opties.tijden ?? ['09:00'], maxPogingen: opties.maxPogingen ?? 2, employeeIds: mensen.map((m) => m.id),
  })).json();
  const wachten: number[] = [];
  const draai = (nu: Date) => tik({ db: t.db, voice: async (o) => { t.opdrachten.push(o); return { gebeld: true, call_id: 'v' }; }, wacht: async (ms) => { wachten.push(ms); } }, nu);
  const alleCalls = () => t.db.select().from(calls);
  return { t, mensen, planning, draai, wachten, alleCalls };
}

describe('tijd in Nederland', () => {
  it('rekent 9:00 om naar het juiste moment, in winter- en zomertijd en op de dag van de omschakeling', () => {
    expect(nlNaarDate('2026-10-29', '09:00').toISOString()).toBe('2026-10-29T08:00:00.000Z'); // CET
    expect(nlNaarDate('2026-07-15', '09:00').toISOString()).toBe('2026-07-15T07:00:00.000Z'); // CEST
    expect(nlNaarDate('2026-10-25', '09:00').toISOString()).toBe('2026-10-25T08:00:00.000Z'); // omschakeldag: al wintertijd om 9:00
    expect(nlNaarDate('2026-03-29', '09:00').toISOString()).toBe('2026-03-29T07:00:00.000Z'); // al zomertijd om 9:00
  });
  it('bepaalt de weekdag in Nederland, niet in UTC', () => {
    expect(nlWeekdag(new Date('2026-10-29T08:00:00Z'))).toBe(4); // donderdag
    expect(nlWeekdag(new Date('2026-10-28T23:30:00Z'))).toBe(4); // 00:30 donderdag in NL, nog woensdag in UTC
    expect(nlWeekdag(new Date('2026-11-01T12:00:00Z'))).toBe(7); // zondag
  });
});

describe('scheduler', () => {
  it('belt niet vóór het tijdstip en belt iedereen in de planning daarna, met pauzes ertussen', async () => {
    const s = await opzet({ personen: 3 });
    expect(await s.draai(na(-1))).toMatchObject({ gestart: 0 });
    expect(await s.draai(na(0))).toMatchObject({ gestart: 3, mislukt: 0 });
    expect(s.t.opdrachten.map((o) => o.medewerker).sort()).toEqual(['Collega 1', 'Collega 2', 'Collega 3']);
    expect(s.wachten).toEqual([PAUZE_TUSSEN_GESPREKKEN_MS, PAUZE_TUSSEN_GESPREKKEN_MS]);
    const gesprekken = await s.alleCalls();
    expect(gesprekken.every((c) => c.bron === 'schema' && c.scheduleId === s.planning.id && c.slotStart!.getTime() === SLOT.getTime() && c.poging === 1)).toBe(true);
  });

  it('belt nooit dubbel, ook niet bij herhaalde of gelijktijdige tikken (zoals na een herstart)', async () => {
    const s = await opzet();
    await Promise.all([s.draai(na(0)), s.draai(na(0))]);
    await s.draai(na(1));
    await s.draai(na(2));
    expect(await s.alleCalls()).toHaveLength(2);
    expect(s.t.opdrachten).toHaveLength(2);
  });

  it('belt alleen op de geplande dagen en niet als de planning uit staat', async () => {
    const weekend = await opzet({ dagen: [6, 7] });
    expect(await weekend.draai(na(0))).toMatchObject({ gestart: 0 });
    const uit = await opzet();
    await uit.t.api('PATCH', `/api/plannings/${uit.planning.id}`, { actief: false });
    expect(await uit.draai(na(0))).toMatchObject({ gestart: 0 });
  });

  it('slaat een niet-actieve medewerker over, en een medewerker die uit de planning is gehaald', async () => {
    const s = await opzet({ personen: 3 });
    await s.t.api('PATCH', `/api/employees/${s.mensen[0].id}`, { actief: false });
    await s.t.api('PATCH', `/api/plannings/${s.planning.id}`, { employeeIds: [s.mensen[0].id, s.mensen[1].id] });
    await s.draai(na(0));
    expect(s.t.opdrachten.map((o) => o.medewerker)).toEqual(['Collega 2']);
  });

  it('haalt een gemist tijdstip nog een uur in, daarna niet meer', async () => {
    const laat = await opzet();
    expect(await laat.draai(na(INHAALTIJD_MIN + 1))).toMatchObject({ gestart: 0 });
    const net = await opzet();
    expect(await net.draai(na(INHAALTIJD_MIN))).toMatchObject({ gestart: 2 });
  });

  it('probeert opnieuw na een gemist gesprek, maar niet vaker dan het maximum en niet te snel', async () => {
    const s = await opzet({ personen: 1, maxPogingen: 2 });
    await s.draai(na(0));
    const eerste = (await s.alleCalls())[0];
    await s.t.db.update(calls).set({ status: 'niet_bereikt', afgerondOp: na(1) }).where(eq(calls.id, eerste.id));
    expect(await s.draai(na(1 + HERPOGING_NA_MIN - 1))).toMatchObject({ gestart: 0 }); // te snel
    expect(await s.draai(na(1 + HERPOGING_NA_MIN))).toMatchObject({ gestart: 1 });
    const tweede = (await s.alleCalls()).find((c) => c.poging === 2)!;
    await s.t.db.update(calls).set({ status: 'voicemail', afgerondOp: na(40) }).where(eq(calls.id, tweede.id));
    expect(await s.draai(na(120))).toMatchObject({ gestart: 0 }); // maximum van 2 bereikt
    expect(await s.alleCalls()).toHaveLength(2);
  });

  it('probeert niet opnieuw na een gesprek dat gelukt is, en niet als iemand nog in gesprek is', async () => {
    const s = await opzet({ personen: 1 });
    await s.draai(na(0));
    const c = (await s.alleCalls())[0];
    await s.t.db.update(calls).set({ status: 'gesproken', afgerondOp: na(10) }).where(eq(calls.id, c.id));
    expect(await s.draai(na(60))).toMatchObject({ gestart: 0 });
    // Wie op dat moment al gebeld wordt, krijgt geen tweede gesprek erbij.
    const bezig = await opzet({ personen: 1 });
    await bezig.t.db.insert(calls).values({ employeeId: bezig.mensen[0].id, status: 'belt', createdAt: na(-5) });
    expect(await bezig.draai(na(0))).toMatchObject({ gestart: 0 });
  });

  it('meldt een mislukt gesprek en gaat door met de rest', async () => {
    const s = await opzet({ personen: 2 });
    let n = 0;
    const r = await tik({ db: s.t.db, voice: async () => (++n === 1 ? { gebeld: false, reden: 'ongeldig telefoonnummer' } : { gebeld: true, call_id: 'v' }), wacht: async () => {} }, na(0));
    expect(r).toMatchObject({ gestart: 1, mislukt: 1 });
    expect((await s.alleCalls()).map((c) => c.status).sort()).toEqual(['belt', 'mislukt']);
  });

  it('doet niets als automatisch bellen is uitgezet', async () => {
    const s = await opzet();
    await zetAutomatischBellen(s.t.db, false);
    expect(await s.draai(na(0))).toMatchObject({ gestart: 0 });
    await zetAutomatischBellen(s.t.db, true);
    expect(await s.draai(na(0))).toMatchObject({ gestart: 2 });
  });

  it('belt een medewerker in twee plannings op hetzelfde tijdstip maar één keer', async () => {
    const s = await opzet({ personen: 1 });
    await s.t.api('POST', '/api/plannings', { naam: 'Dubbel', dagen: [4], tijden: ['09:00'], employeeIds: [s.mensen[0].id] });
    expect(await s.draai(na(0))).toMatchObject({ gestart: 1 });
  });

  it('belt op meerdere tijden per dag, elk tijdstip apart', async () => {
    const s = await opzet({ personen: 1, tijden: ['09:00', '14:00'] });
    await s.draai(na(0));
    await s.t.db.update(calls).set({ status: 'gesproken', afgerondOp: na(10) });
    expect(await s.draai(na(300))).toMatchObject({ gestart: 1 }); // 14:00 NL = 13:00 UTC
    expect((await s.alleCalls()).map((c) => c.slotStart!.toISOString()).sort()).toEqual(['2026-10-29T08:00:00.000Z', '2026-10-29T13:00:00.000Z']);
  });
});

describe('planning beheren', () => {
  it('maakt een planning voor meerdere personen, past de personen en tijden aan en verwijdert hem', async () => {
    const s = await opzet({ personen: 3 });
    const lijst = (await s.t.api('GET', '/api/plannings')).json();
    expect(lijst).toHaveLength(1);
    expect(lijst[0].employeeIds.sort()).toEqual(s.mensen.map((m) => m.id).sort());
    const na2 = (await s.t.api('PATCH', `/api/plannings/${s.planning.id}`, { employeeIds: [s.mensen[2].id], tijden: ['08:30'] })).json();
    expect(na2).toMatchObject({ employeeIds: [s.mensen[2].id], tijden: ['08:30'], naam: 'Ochtend', dagen: [1, 2, 3, 4, 5], maxPogingen: 2 });
    expect((await s.t.api('PATCH', `/api/plannings/${s.planning.id}`, { employeeIds: [] })).statusCode).toBe(400);
    expect((await s.t.api('PATCH', '/api/plannings/00000000-0000-4000-8000-000000000000', { actief: false })).statusCode).toBe(404);
    await s.t.api('POST', `/api/employees/${s.mensen[0].id}/bel`);
    expect((await s.t.api('DELETE', `/api/plannings/${s.planning.id}`)).statusCode).toBe(200);
    expect((await s.t.api('GET', '/api/plannings')).json()).toEqual([]);
    expect(await s.alleCalls()).toHaveLength(1); // gespreksgeschiedenis blijft
  });

  it('is alleen voor de beheerder en bewaart de noodschakelaar', async () => {
    const s = await opzet();
    expect((await s.t.app.inject({ method: 'GET', url: '/api/plannings' })).statusCode).toBe(401);
    expect((await s.t.app.inject({ method: 'PUT', url: '/api/instellingen/automatisch-bellen', payload: { aan: false } })).statusCode).toBe(401);
    expect((await s.t.api('GET', '/api/instellingen/automatisch-bellen')).json()).toEqual({ aan: true });
    expect((await s.t.api('PUT', '/api/instellingen/automatisch-bellen', { aan: false })).json()).toEqual({ aan: false });
    expect((await s.t.api('GET', '/api/instellingen/automatisch-bellen')).json()).toEqual({ aan: false });
  });

  it('de unieke index voorkomt dubbele pogingen ook op databaseniveau', async () => {
    const s = await opzet({ personen: 1 });
    const waarden = { employeeId: s.mensen[0].id, scheduleId: s.planning.id, slotStart: SLOT, poging: 1, bron: 'schema' as const };
    await s.t.db.insert(calls).values(waarden);
    await expect(s.t.db.insert(calls).values(waarden)).rejects.toThrow();
    expect((await s.t.db.select().from(calls).where(and(eq(calls.scheduleId, s.planning.id)))).length).toBe(1);
  });
});
