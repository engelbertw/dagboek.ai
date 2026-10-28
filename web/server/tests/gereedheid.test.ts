import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { migratieNamen } from '../db.js';
import { maakTestApp } from './helpers.js';

const open: Awaited<ReturnType<typeof maakTestApp>>[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

describe('liveness en readiness', () => {
  it('/api/health blijft altijd ok, ook zonder database (liveness), en vraagt geen inlog', async () => {
    const t = await maakTestApp(); open.push(t);
    const kapot = new Proxy(t.db, { get: () => { throw new Error('database weg'); } });
    const app = buildApp({ db: kapot as any, config: t.config, voice: async () => ({ gebeld: false, reden: 'x' }), llm: async () => '' });
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({ ok: true });
    await app.close();
  });

  it('/api/ready is ok met database, alle migraties en configuratie, zonder inlog en zonder gevoelige gegevens', async () => {
    const t = await maakTestApp(); open.push(t);
    const r = await t.app.inject({ method: 'GET', url: '/api/ready' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, checks: { database: 'ok', migraties: 'ok', configuratie: 'ok' } });
  });

  it('/api/ready geeft 503 als een migratie ontbreekt', async () => {
    const t = await maakTestApp(); open.push(t);
    const laatste = migratieNamen().at(-1)!;
    await t.db.execute(sql`delete from migraties where naam = ${laatste}`);
    const r = await t.app.inject({ method: 'GET', url: '/api/ready' });
    expect(r.statusCode).toBe(503);
    expect(r.json().checks).toMatchObject({ database: 'ok', migraties: 'fout' });
  });

  it('/api/ready geeft 503 als de database niet antwoordt, zonder de foutmelding te lekken', async () => {
    const t = await maakTestApp(); open.push(t);
    const traag = new Proxy(t.db, { get: (d, p, o) => (p === 'execute' ? () => Promise.reject(new Error('geheime verbindingsstring postgres://u:p@h')) : Reflect.get(d, p, o)) });
    const app = buildApp({ db: traag as any, config: t.config, voice: async () => ({ gebeld: false, reden: 'x' }), llm: async () => '' });
    await app.ready();
    const r = await app.inject({ method: 'GET', url: '/api/ready' });
    expect(r.statusCode).toBe(503);
    expect(r.json().checks.database).toBe('fout');
    expect(r.body).not.toContain('postgres://');
    await app.close();
  });

  it('een storing bij het taalmodel of de voice-service maakt de instantie niet "niet gereed"', async () => {
    const t = await maakTestApp({ gebeld: false, reden: 'voice weg' }, async () => { throw new Error('taalmodel weg'); }); open.push(t);
    expect((await t.app.inject({ method: 'GET', url: '/api/ready' })).statusCode).toBe(200);
  });
});
