import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { maakSessie } from '../auth.js';
import { magDoen } from '../rollen.js';
import { activiteiten, employees, klanten, opvolgingen } from '../schema.js';
import { maakTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

async function opzet() {
  const t = await maakTestApp(); open.push(t);
  const [ana] = await t.db.insert(employees).values({ naam: 'Ana', telefoon: '0611111111', rol: 'accountmanager', email: 'ana@test.nl' }).returning();
  const [piet] = await t.db.insert(employees).values({ naam: 'Piet', telefoon: '0622222222', rol: 'accountmanager', email: 'piet@test.nl' }).returning();
  const [a] = await t.db.insert(klanten).values({ naam: 'Gemeente A', status: 'klant', accountmanagerId: ana.id }).returning();
  const [zonder] = await t.db.insert(klanten).values({ naam: 'Gemeente Zonder', status: 'klant' }).returning();
  const signaal = async (over: Partial<typeof activiteiten.$inferInsert> = {}) => (await t.db.insert(activiteiten).values({
    klantId: a.id, soort: 'vervolgsignaal', omschrijving: 'Gemeente wil ook de module Bezwaren', citaat: 'ze willen ook Bezwaren erbij', ...over,
  }).returning())[0];
  const als = (email: string, rol: string) => {
    const cookies = { dagboek_sessie: maakSessie(email, t.config.sessionSecret, Date.now(), { naam: email, rol }) };
    return (method: string, url: string, payload?: unknown) => t.app.inject({ method: method as any, url, payload: payload as any, cookies });
  };
  return { t, ana, piet, a, zonder, signaal, als };
}

describe('opvolging van een vervolgsignaal', () => {
  it('maakt van een signaal een leeg punt (kans) en laat het signaal en zijn citaat bestaan', async () => {
    const o = await opzet();
    const s = await o.signaal();
    const r = await o.t.api('POST', `/api/activiteiten/${s.id}/opvolging`, { besluit: 'kans' });
    expect(r.statusCode).toBe(201);
    const kans = (await o.t.db.select().from(activiteiten).where(eq(activiteiten.id, r.json().kansId)))[0];
    expect(kans).toMatchObject({ soort: 'kans', omschrijving: s.omschrijving, details: {}, citaat: '', callId: null, deadline: null, bronActiviteitId: s.id, eigenaarId: o.ana.id, klantId: o.a.id, status: 'open' });
    const [na] = await o.t.db.select().from(activiteiten).where(eq(activiteiten.id, s.id));
    expect(na).toMatchObject({ status: 'afgerond', citaat: 'ze willen ook Bezwaren erbij', omschrijving: s.omschrijving });
    const get = (await o.t.api('GET', `/api/activiteiten/${s.id}/opvolging`)).json();
    expect(get.opvolging).toMatchObject({ besluit: 'kans', kansId: kans.id, door: expect.any(String) });
    expect(get.signaal.citaat).toBe('ze willen ook Bezwaren erbij');
  });

  it('legt geen vervolg vast met een verplichte reden en maakt geen punt aan', async () => {
    const o = await opzet();
    const s = await o.signaal();
    expect((await o.t.api('POST', `/api/activiteiten/${s.id}/opvolging`, { besluit: 'geen_vervolg' })).statusCode).toBe(400);
    expect((await o.t.api('POST', `/api/activiteiten/${s.id}/opvolging`, { besluit: 'geen_vervolg', reden: '  ' })).statusCode).toBe(400);
    expect((await o.t.api('POST', `/api/activiteiten/${s.id}/opvolging`, { besluit: 'geen_vervolg', reden: 'Valt binnen het pakket' })).statusCode).toBe(201);
    expect(await o.t.db.select().from(activiteiten).where(eq(activiteiten.soort, 'kans'))).toHaveLength(0);
    expect((await o.t.db.select().from(opvolgingen))[0]).toMatchObject({ besluit: 'geen_vervolg', reden: 'Valt binnen het pakket', nieuwActiviteitId: null });
  });

  it('staat één besluit per signaal toe en laat een besloten signaal niet verwijderen', async () => {
    const o = await opzet();
    const s = await o.signaal();
    expect((await o.t.api('POST', `/api/activiteiten/${s.id}/opvolging`, { besluit: 'kans' })).statusCode).toBe(201);
    expect((await o.t.api('POST', `/api/activiteiten/${s.id}/opvolging`, { besluit: 'geen_vervolg', reden: 'Toch niet' })).statusCode).toBe(409);
    expect((await o.t.api('DELETE', `/api/activiteiten/${s.id}`)).statusCode).toBe(409);
    expect(await o.t.db.select().from(activiteiten).where(eq(activiteiten.soort, 'kans'))).toHaveLength(1);
  });

  it('laat alleen de accountmanager van de gemeente beslissen, naast de beheerder', async () => {
    const o = await opzet();
    const eigen = o.als('ana@test.nl', 'accountmanager');
    const ander = o.als('piet@test.nl', 'accountmanager');
    const s1 = await o.signaal();
    expect((await ander('POST', `/api/activiteiten/${s1.id}/opvolging`, { besluit: 'kans' })).statusCode).toBe(403);
    expect((await o.als('ana@test.nl', 'administratie')('POST', `/api/activiteiten/${s1.id}/opvolging`, { besluit: 'kans' })).statusCode).toBe(403);
    expect((await o.als('onbekend@test.nl', 'accountmanager')('POST', `/api/activiteiten/${s1.id}/opvolging`, { besluit: 'kans' })).statusCode).toBe(403);
    expect((await eigen('POST', `/api/activiteiten/${s1.id}/opvolging`, { besluit: 'kans' })).statusCode).toBe(201);
    // Een gemeente zonder accountmanager: alleen een beheerder.
    const s2 = await o.signaal({ klantId: o.zonder.id });
    expect((await eigen('POST', `/api/activiteiten/${s2.id}/opvolging`, { besluit: 'kans' })).statusCode).toBe(403);
    expect((await o.t.api('POST', `/api/activiteiten/${s2.id}/opvolging`, { besluit: 'kans' })).statusCode).toBe(201);
    expect((await o.t.db.select().from(activiteiten).where(eq(activiteiten.klantId, o.zonder.id))).find((x) => x.soort === 'kans')?.eigenaarId).toBeNull();
  });

  it('weigert iets wat geen vervolgsignaal is, een nog niet gecontroleerd signaal en een signaal zonder gemeente', async () => {
    const o = await opzet();
    const actie = (await o.t.db.insert(activiteiten).values({ klantId: o.a.id, soort: 'actie', omschrijving: 'Bellen' }).returning())[0];
    expect((await o.t.api('POST', `/api/activiteiten/${actie.id}/opvolging`, { besluit: 'kans' })).statusCode).toBe(404);
    const onzeker = await o.signaal({ controleNodig: true, controleReden: 'bron_niet_te_verifieren' });
    expect((await o.t.api('POST', `/api/activiteiten/${onzeker.id}/opvolging`, { besluit: 'kans' })).statusCode).toBe(409);
    const zwevend = await o.signaal({ klantId: null });
    expect((await o.t.api('POST', `/api/activiteiten/${zwevend.id}/opvolging`, { besluit: 'kans' })).statusCode).toBe(409);
    expect(await o.t.db.select().from(opvolgingen)).toHaveLength(0);
  });

  it('staat in de rollen: accountmanager mag lezen en posten (de gemeente wordt apart gecontroleerd), administratie niet', () => {
    const pad = '/api/activiteiten/00000000-0000-4000-8000-000000000001/opvolging';
    expect(magDoen('accountmanager', 'POST', pad)).toBe(true);
    expect(magDoen('accountmanager', 'GET', pad)).toBe(true);
    expect(magDoen('administratie', 'POST', pad)).toBe(false);
  });
});
