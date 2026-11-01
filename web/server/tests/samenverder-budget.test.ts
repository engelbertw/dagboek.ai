import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { berekenBudget } from '../samenverder-budget.js';
import { magDoen } from '../rollen.js';
import { klanten, samenverderBudgetmutaties, samenverderSessies } from '../schema.js';
import { maakTestApp } from './helpers.js';

const nu = new Date();
const sessie = (status: string, omvangDagen: number, bevestigd = status === 'uitgevoerd') => ({ status, omvangDagen, bevestigdOp: bevestigd ? nu : null });

describe('berekenBudget', () => {
  it('rekent afgesproken, uitgevoerd, gepland en nog niet gepland uit', () => {
    const b = berekenBudget([{ dagen: '10.00' }, { dagen: 2 }, { dagen: -1 }], [sessie('uitgevoerd', 3), sessie('gepland', 2), sessie('gepland', 0.5)]);
    expect(b).toEqual({ beschikbaar: 11, uitgevoerd: 3, gepland: 2.5, nogNietGepland: 5.5, overschrijding: false });
  });

  it('telt halve dagen en breuken zonder afrondingsfout', () => {
    const b = berekenBudget([{ dagen: 0.3 }], [sessie('gepland', 0.1), sessie('gepland', 0.2)]);
    expect(b).toMatchObject({ gepland: 0.3, nogNietGepland: 0 });
  });

  it('laat geannuleerde en verplaatste sessies en onbevestigd uitgevoerde buiten beschouwing', () => {
    const b = berekenBudget([{ dagen: 5 }], [sessie('geannuleerd', 1), sessie('verplaatst', 1), sessie('uitgevoerd', 1, false), sessie('gepland', 1)]);
    expect(b).toMatchObject({ uitgevoerd: 0, gepland: 1, nogNietGepland: 4 });
  });

  it('toont een overschrijding in plaats van die te blokkeren', () => {
    const b = berekenBudget([{ dagen: 2 }], [sessie('uitgevoerd', 2), sessie('gepland', 1.5)]);
    expect(b).toMatchObject({ nogNietGepland: -1.5, overschrijding: true });
  });

  it('geeft nullen zonder mutaties en sessies', () => {
    expect(berekenBudget([], [])).toEqual({ beschikbaar: 0, uitgevoerd: 0, gepland: 0, nogNietGepland: 0, overschrijding: false });
  });
});

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });
const over = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function opzet() {
  const t = await maakTestApp(); open.push(t);
  const [k] = await t.db.insert(klanten).values({ naam: 'Gemeente A', status: 'klant' }).returning();
  const p = (await t.api('POST', '/api/samenverder/programmas', { klantId: k.id, pakket: 'SV', periodeVan: '2026-01-01' })).json();
  const budget = (payload: Record<string, unknown>) => t.api('POST', `/api/samenverder/programmas/${p.id}/budget`, payload);
  const sessie = async (extra: Record<string, unknown> = {}) => (await t.api('POST', `/api/samenverder/programmas/${p.id}/sessies`, { datum: over(7), omvangDagen: 1, ...extra })).json();
  return { t, k, p, budget, sessie };
}

describe('dagenbudget (API)', () => {
  it('legt start en uitbreiding vast en berekent de stand uit de sessies', async () => {
    const o = await opzet();
    expect((await o.budget({ soort: 'start', dagen: 10, reden: 'Contract 2026' })).statusCode).toBe(201);
    expect((await o.budget({ soort: 'uitbreiding', dagen: 2.5, reden: 'Extra verzoek' })).statusCode).toBe(201);
    const s1 = await o.sessie(); await o.sessie({ omvangDagen: 0.5 });
    await o.t.api('POST', `/api/samenverder/sessies/${s1.id}/uitgevoerd`, {});
    const d = (await o.t.api('GET', `/api/samenverder/programmas/${o.p.id}`)).json();
    expect(d.budget).toMatchObject({ beschikbaar: 12.5, uitgevoerd: 1, gepland: 0.5, nogNietGepland: 11, overschrijding: false });
    expect(d.budget.mutaties.map((m: { soort: string; reden: string }) => [m.soort, m.reden])).toEqual([['start', 'Contract 2026'], ['uitbreiding', 'Extra verzoek']]);
    const lijst = (await o.t.api('GET', '/api/samenverder/programmas')).json();
    expect(lijst[0].budget).toMatchObject({ beschikbaar: 12.5, nogNietGepland: 11 });
    const voor = (await o.t.api('GET', `/api/klanten/${o.k.id}/voorbereiding`)).json();
    expect(voor.samenverder[0].budget).toMatchObject({ beschikbaar: 12.5, gepland: 0.5 });
  });

  it('weigert een tweede start, afgehaalde dagen buiten een correctie en een totaal onder nul', async () => {
    const o = await opzet();
    await o.budget({ soort: 'start', dagen: 2, reden: 'Contract' });
    expect((await o.budget({ soort: 'start', dagen: 3, reden: 'Nog een start' })).statusCode).toBe(409);
    expect((await o.budget({ soort: 'uitbreiding', dagen: -1, reden: 'Min' })).statusCode).toBe(400);
    expect((await o.budget({ soort: 'correctie', dagen: -3, reden: 'Te veel' })).statusCode).toBe(400);
    expect((await o.budget({ soort: 'correctie', dagen: 0, reden: 'Niets' })).statusCode).toBe(400);
    expect((await o.budget({ soort: 'correctie', dagen: -1, reden: '  ' })).statusCode).toBe(400);
    expect((await o.budget({ soort: 'correctie', dagen: -1, reden: 'Fout in contract' })).statusCode).toBe(201);
    const d = (await o.t.api('GET', `/api/samenverder/programmas/${o.p.id}`)).json();
    expect(d.budget.beschikbaar).toBe(1);
    expect(await o.t.db.select().from(samenverderBudgetmutaties).where(eq(samenverderBudgetmutaties.programmaId, o.p.id))).toHaveLength(2);
  });

  it('toont een overschrijding en blokkeert het plannen niet', async () => {
    const o = await opzet();
    await o.budget({ soort: 'start', dagen: 1, reden: 'Contract' });
    expect((await o.sessie()).id).toBeTruthy();
    expect((await o.sessie({ omvangDagen: 1.5 })).id).toBeTruthy();
    const d = (await o.t.api('GET', `/api/samenverder/programmas/${o.p.id}`)).json();
    expect(d.budget).toMatchObject({ gepland: 2.5, nogNietGepland: -1.5, overschrijding: true });
  });

  it('laat een geannuleerde sessie niet meetellen en een verplaatste maar één keer', async () => {
    const o = await opzet();
    await o.budget({ soort: 'start', dagen: 5, reden: 'Contract' });
    const a = await o.sessie(); const b = await o.sessie();
    await o.t.api('POST', `/api/samenverder/sessies/${a.id}/annuleer`, {});
    await o.t.api('POST', `/api/samenverder/sessies/${b.id}/verplaats`, { datum: over(14) });
    const d = (await o.t.api('GET', `/api/samenverder/programmas/${o.p.id}`)).json();
    expect(d.budget).toMatchObject({ gepland: 1, nogNietGepland: 4 });
  });

  it('verwijdert geen programma met een dagenbudget', async () => {
    const o = await opzet();
    await o.budget({ soort: 'start', dagen: 1, reden: 'Contract' });
    expect((await o.t.api('DELETE', `/api/samenverder/programmas/${o.p.id}`)).statusCode).toBe(409);
  });

  it('mag alleen door een beheerder worden vastgelegd; een accountmanager leest alleen', () => {
    const pad = '/api/samenverder/programmas/00000000-0000-4000-8000-000000000001/budget';
    expect(magDoen('accountmanager', 'POST', pad)).toBe(false);
    expect(magDoen('administratie', 'POST', pad)).toBe(false);
    expect(magDoen('beheerder', 'POST', pad)).toBe(true);
    expect(magDoen('accountmanager', 'GET', '/api/samenverder/programmas/00000000-0000-4000-8000-000000000001')).toBe(true);
  });
});
