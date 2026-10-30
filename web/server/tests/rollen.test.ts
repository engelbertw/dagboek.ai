import { afterEach, describe, expect, it } from 'vitest';
import { maakSessie } from '../auth.js';
import { magDoen } from '../rollen.js';
import { maakTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

const ID = '00000000-0000-4000-8000-000000000001';

describe('rollen', () => {
  it('geeft een beheerder alles en een accountmanager alleen werk en klanten', () => {
    expect(magDoen('beheerder', 'DELETE', '/api/medewerkers/x')).toBe(true);
    expect(magDoen(undefined, 'GET', '/api/gebruikers')).toBe(true); // oude sessies zonder rol zijn beheerder
    for (const [m, p] of [['GET', '/api/activiteiten'], ['POST', '/api/activiteiten'], ['PATCH', `/api/activiteiten/${ID}`], ['POST', `/api/activiteiten/${ID}/controle`],
      ['DELETE', `/api/activiteiten/${ID}`], ['GET', '/api/klanten'], ['GET', '/api/klant-contacten'], ['PATCH', `/api/klant-contacten/${ID}`], ['PATCH', `/api/klanten/${ID}`], ['GET', '/api/employees']]) expect(magDoen('accountmanager', m, p), `${m} ${p}`).toBe(true);
    for (const [m, p] of [['POST', '/api/activiteiten/jira'], ['GET', '/api/gebruikers'], ['POST', '/api/gebruikers'], ['GET', '/api/gesprekken'], ['PUT', '/api/instellingen/jira'],
      ['GET', '/api/instellingen/jira'], ['POST', '/api/klanten/import'], ['DELETE', `/api/klanten/${ID}`], ['POST', `/api/klanten/${ID}/controle`], ['POST', '/api/employees'],
      ['GET', '/api/topics'], ['GET', '/api/dashboard'], ['PATCH', `/api/employees/${ID}`]]) expect(magDoen('accountmanager', m, p), `${m} ${p}`).toBe(false);
  });

  it('dwingt de rol af op de server', async () => {
    const t = await maakTestApp();
    open.push(t);
    const cookies = { dagboek_sessie: maakSessie('ana@test.nl', t.config.sessionSecret, Date.now(), { naam: 'Ana', rol: 'accountmanager' }) };
    const doe = (method: string, url: string, payload?: unknown) => t.app.inject({ method: method as any, url, payload: payload as any, cookies });
    await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678' });
    expect((await doe('GET', '/api/activiteiten')).statusCode).toBe(200);
    expect((await doe('POST', '/api/activiteiten', { omschrijving: 'Offerte opvolgen', soort: 'intern' })).statusCode).toBe(201);
    const namen = (await doe('GET', '/api/employees')).json();
    expect(namen[0]).toEqual({ id: expect.any(String), naam: 'Daan', rol: 'medewerker', actief: true }); // geen telefoonnummer
    for (const [m, u] of [['GET', '/api/topics'], ['GET', '/api/gebruikers'], ['GET', '/api/instellingen/jira'], ['POST', '/api/activiteiten/jira'], ['GET', '/api/dashboard']]) {
      expect((await doe(m, u, m === 'POST' ? { ids: [ID] } : undefined)).statusCode, `${m} ${u}`).toBe(403);
    }
    expect((await doe('GET', '/api/me')).json()).toMatchObject({ ingelogd: true, rol: 'accountmanager' });
    // Een beheerder ziet de volledige medewerkers.
    expect((await t.api('GET', '/api/employees')).json()[0].telefoon).toBeTruthy();
  });
});
