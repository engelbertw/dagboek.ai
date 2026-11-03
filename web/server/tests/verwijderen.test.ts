import { afterEach, describe, expect, it } from 'vitest';
import { maakSessie } from '../auth.js';
import { activiteiten, bezoeken, calls, consultantDebriefs, dagboekDigests, employees, klanten, opvolgingen } from '../schema.js';
import { maakTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

async function zaai(t: T) {
  const [k] = await t.db.insert(klanten).values({ naam: 'Oldambt', status: 'klant' }).returning();
  const [mw] = await t.db.insert(employees).values({ naam: 'Engelbert', telefoon: '0612345678' }).returning();
  const [call] = await t.db.insert(calls).values({ employeeId: mw.id }).returning();
  const [bezoek] = await t.db.insert(bezoeken).values({ klantId: k.id, callId: call.id, samenvatting: 'Samen Verder-dag' }).returning();
  const [punt] = await t.db.insert(activiteiten).values({ klantId: k.id, bezoekId: bezoek.id, soort: 'actie', omschrijving: 'Plan sturen', callId: call.id }).returning();
  await t.db.insert(dagboekDigests).values({ dagen: 7, tekst: 'oud' });
  return { k, mw, call, bezoek, punt };
}
const als = (t: T, rol: string) => (method: string, url: string) => t.app.inject({ method: method as any, url, cookies: { dagboek_sessie: maakSessie(`${rol}@test.nl`, t.config.sessionSecret, Date.now(), { rol }) } });

describe('verslagen verwijderen', () => {
  it('wist een bezoek met zijn punten en de bewaarde samenvatting, maar niet de gemeente', async () => {
    const t = await maakTestApp(); open.push(t);
    const { k, bezoek } = await zaai(t);
    const r = await t.api('DELETE', `/api/bezoeken/${bezoek.id}`);
    expect(r.json()).toEqual({ ok: true, punten: 1 });
    expect(await t.db.select().from(bezoeken)).toHaveLength(0);
    expect(await t.db.select().from(activiteiten)).toHaveLength(0);
    expect(await t.db.select().from(dagboekDigests)).toHaveLength(0);
    expect(await t.db.select().from(klanten)).toEqual([expect.objectContaining({ id: k.id })]);
    expect((await t.api('DELETE', `/api/bezoeken/${bezoek.id}`)).statusCode).toBe(404);
  });

  it('weigert als over een vervolgsignaal uit het bezoek is besloten, en wist dan niets', async () => {
    const t = await maakTestApp(); open.push(t);
    const { bezoek, punt } = await zaai(t);
    await t.db.insert(opvolgingen).values({ signaalId: punt.id, besluit: 'geen_vervolg', reden: 'Klant ziet af', door: 'beheer@test.nl' });
    expect((await t.api('DELETE', `/api/bezoeken/${bezoek.id}`)).statusCode).toBe(409);
    expect(await t.db.select().from(bezoeken)).toHaveLength(1);
    expect(await t.db.select().from(activiteiten)).toHaveLength(1);
  });

  it('wist een consultantdebrief met de punten van dat gesprek', async () => {
    const t = await maakTestApp(); open.push(t);
    const { k, mw, call } = await zaai(t);
    const [d] = await t.db.insert(consultantDebriefs).values({ callId: call.id, employeeId: mw.id, klantId: k.id, variant: 'project', samenvatting: 'Verslag' }).returning();
    expect((await t.api('DELETE', `/api/consultant-debriefs/${d.id}`)).json()).toEqual({ ok: true, punten: 1 });
    expect(await t.db.select().from(consultantDebriefs)).toHaveLength(0);
    expect((await t.api('DELETE', `/api/consultant-debriefs/${d.id}`)).statusCode).toBe(404);
  });

  it('staat het alleen de beheerder toe', async () => {
    const t = await maakTestApp(); open.push(t);
    const { bezoek } = await zaai(t);
    for (const rol of ['accountmanager', 'consultant', 'administratie']) {
      expect((await als(t, rol)('DELETE', `/api/bezoeken/${bezoek.id}`)).statusCode, rol).toBe(403);
    }
    expect(await t.db.select().from(bezoeken)).toHaveLength(1);
  });
});
