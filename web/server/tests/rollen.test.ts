import { afterEach, describe, expect, it } from 'vitest';
import { maakSessie } from '../auth.js';
import { magDoen, magInwonersWijzigen, normaleRol } from '../rollen.js';
import { klanten } from '../schema.js';
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

describe('rol administratie', () => {
  it('mag klantgegevens en contactpersonen, maar niet het werkregister of beheer', () => {
    for (const [m, p] of [['GET', '/api/klanten'], ['GET', `/api/klanten/${ID}`], ['PATCH', `/api/klanten/${ID}`], ['POST', `/api/klanten/${ID}/contacten`], ['GET', '/api/klant-contacten'],
      ['PATCH', `/api/klant-contacten/${ID}`], ['POST', '/api/klant-contacten/samenvoegen'], ['GET', '/api/kwaliteit'], ['GET', '/api/employees']]) expect(magDoen('administratie', m, p), `${m} ${p}`).toBe(true);
    for (const [m, p] of [['GET', '/api/activiteiten'], ['POST', '/api/klanten'], ['POST', '/api/klanten/import'], ['DELETE', `/api/klanten/${ID}`], ['POST', `/api/klanten/${ID}/controle`],
      ['GET', '/api/gebruikers'], ['GET', '/api/gesprekken'], ['GET', '/api/topics'], ['GET', '/api/samenverder/programmas'], ['PUT', '/api/instellingen/jira']]) expect(magDoen('administratie', m, p), `${m} ${p}`).toBe(false);
  });

  it('geeft een onbekende rol geen toegang en maakt er geen beheerder van', () => {
    expect(normaleRol('administratie')).toBe('administratie');
    expect(normaleRol('iets-anders')).toBe('accountmanager');
    expect(magDoen('iets-anders', 'GET', '/api/klanten')).toBe(false);
    expect(magInwonersWijzigen('accountmanager')).toBe(false);
    expect(magInwonersWijzigen('administratie')).toBe(true);
    expect(magInwonersWijzigen('beheerder')).toBe(true);
    expect(magInwonersWijzigen(undefined)).toBe(true);
  });

  it('laat alleen beheer en administratie het aantal inwoners wijzigen, en administratie niets anders', async () => {
    const t = await maakTestApp(); open.push(t);
    const [k] = await t.db.insert(klanten).values({ naam: 'Gemeente Voorbeeld', status: 'klant', inwoners: 1000 }).returning();
    const als = (rol: string) => {
      const cookies = { dagboek_sessie: maakSessie(`${rol}@test.nl`, t.config.sessionSecret, Date.now(), { naam: rol, rol }) };
      return (method: string, url: string, payload?: unknown) => t.app.inject({ method: method as any, url, payload: payload as any, cookies });
    };
    const am = als('accountmanager'); const adm = als('administratie');
    // Accountmanager: andere velden wel, een gewijzigd aantal inwoners niet; een ongewijzigd aantal in hetzelfde verzoek is geen wijziging.
    expect((await am('PATCH', `/api/klanten/${k.id}`, { omschrijving: 'Nieuw', inwoners: 1000 })).statusCode).toBe(200);
    expect((await am('PATCH', `/api/klanten/${k.id}`, { inwoners: 2000 })).statusCode).toBe(403);
    expect((await am('POST', '/api/klanten', { naam: 'Gemeente Nieuw', inwoners: 5 })).statusCode).toBe(403);
    expect((await am('POST', '/api/klanten', { naam: 'Gemeente Nieuw' })).statusCode).toBe(201);
    // Administratie: alleen inwoners.
    expect((await adm('PATCH', `/api/klanten/${k.id}`, { inwoners: 2000 })).statusCode).toBe(200);
    expect((await adm('PATCH', `/api/klanten/${k.id}`, { naam: 'Andere naam', inwoners: 2000 })).statusCode).toBe(403);
    expect((await adm('PATCH', `/api/klanten/${k.id}`, { omschrijving: 'Nieuw', inwoners: 2000 })).statusCode).toBe(200); // omschrijving is ongewijzigd
    expect((await adm('GET', '/api/activiteiten')).statusCode).toBe(403);
    expect((await adm('GET', '/api/me')).json()).toMatchObject({ ingelogd: true, rol: 'administratie' });
    expect((await adm('GET', '/api/employees')).json()[0]?.telefoon).toBeUndefined();
    // Beheerder: alles.
    expect((await t.api('PATCH', `/api/klanten/${k.id}`, { inwoners: 3000, naam: 'Gemeente Voorbeeld' })).statusCode).toBe(200);
    expect((await t.db.select().from(klanten)).find((x) => x.id === k.id)).toMatchObject({ inwoners: 3000 });
  });
});
