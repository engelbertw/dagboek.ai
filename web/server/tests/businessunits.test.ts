import { afterEach, describe, expect, it } from 'vitest';
import { hashWachtwoord, maakSessie } from '../auth.js';
import { buildApp } from '../app.js';
import { connectMemory, migrate } from '../db.js';
import type { Gebruiker, KeycloakBeheer } from '../gebruikers.js';
import { businessUnits, employees, gebruikersprofielen } from '../schema.js';
import { maakTestApp } from './helpers.js';

const sluit: (() => Promise<void>)[] = [];
afterEach(async () => { while (sluit.length) await sluit.pop()!(); });

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
function geheugenBeheer(): KeycloakBeheer & { gebruikers: Gebruiker[] } {
  const gebruikers: Gebruiker[] = [
    { id: ID(1), email: 'beheer@test.nl', naam: 'Beheer Test', rol: 'beheerder', actief: true, mfa: true, aangemaakt: null },
    { id: ID(2), email: 'ruben@test.nl', naam: 'Ruben Test', rol: 'beheerder', actief: true, mfa: false, aangemaakt: null },
  ];
  return {
    gebruikers, lijst: async () => gebruikers.map((g) => ({ ...g })),
    maak: async ({ email, naam, rol = 'beheerder' }) => { gebruikers.push({ id: ID(gebruikers.length + 1), email, naam, rol, actief: true, mfa: false, aangemaakt: null }); return ID(gebruikers.length); },
    zetRol: async () => {}, zetActief: async () => {}, resetWachtwoord: async () => {}, resetMfa: async () => {},
    verwijder: async (id) => { gebruikers.splice(gebruikers.findIndex((g) => g.id === id), 1); },
  };
}
async function app() {
  const t = await maakTestApp();
  await t.close();
  const handle = await connectMemory();
  await migrate(handle);
  const a = buildApp({ db: handle.db, config: { ...t.config, adminPasswordHash: hashWachtwoord('een-lang-testwachtwoord') }, voice: async () => ({ gebeld: true, call_id: 'v' }), llm: async () => '', gebruikersbeheer: geheugenBeheer() });
  await a.ready();
  sluit.push(async () => { await a.close(); await handle.close(); });
  const login = await a.inject({ method: 'POST', url: '/api/login', payload: { email: 'beheer@test.nl', wachtwoord: 'een-lang-testwachtwoord' } });
  const cookies = { dagboek_sessie: String(login.cookies[0].value) };
  const api = (method: string, url: string, payload?: unknown) => a.inject({ method: method as any, url, payload: payload as any, cookies });
  return { a, api, db: handle.db, config: t.config };
}

describe('businessunits', () => {
  it('zaait de zeven units en laat de beheerder ze beheren', async () => {
    const { api } = await app();
    const lijst = (await api('GET', '/api/business-units')).json();
    expect(lijst.map((u: any) => u.afkorting)).toEqual(['PZ', 'IV', 'P&S', 'F&S', 'SAM', 'R&O', 'iNzicht']);
    const nieuw = await api('POST', '/api/business-units', { naam: 'Nieuwe unit', afkorting: 'NU' });
    expect(nieuw.statusCode).toBe(201);
    expect((await api('POST', '/api/business-units', { naam: 'publiekszaken', afkorting: 'XX' })).statusCode).toBe(409);
    expect((await api('PATCH', `/api/business-units/${nieuw.json().id}`, { actief: false })).json().actief).toBe(false);
    expect((await api('PATCH', `/api/business-units/${nieuw.json().id}`, { afkorting: 'pz' })).statusCode).toBe(409);
    expect((await api('DELETE', `/api/business-units/${nieuw.json().id}`)).statusCode).toBe(200);
  });

  it('is alleen voor de beheerder', async () => {
    const { a, config } = await app();
    for (const rol of ['accountmanager', 'consultant', 'administratie']) {
      const cookies = { dagboek_sessie: maakSessie(`${rol}@test.nl`, config.sessionSecret, Date.now(), { rol }) };
      expect((await a.inject({ method: 'GET', url: '/api/business-units', cookies })).statusCode, rol).toBe(403);
    }
  });

  it('koppelt een medewerker aan functie en unit, en weigert een onbekende unit', async () => {
    const { api, db } = await app();
    const [pz] = await db.select().from(businessUnits).where((await import('drizzle-orm')).eq(businessUnits.afkorting, 'PZ'));
    const m = await api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678', functie: 'Productmanager', businessUnitId: pz.id });
    expect(m.statusCode).toBe(201);
    expect(m.json()).toMatchObject({ functie: 'Productmanager', businessUnitId: pz.id });
    expect((await api('POST', '/api/employees', { naam: 'X', telefoon: '0612345678', businessUnitId: ID(9) })).statusCode).toBe(400);
    expect((await api('PATCH', `/api/employees/${m.json().id}`, { functie: 'Teamlead' })).json()).toMatchObject({ functie: 'Teamlead', businessUnitId: pz.id });
    // een unit in gebruik kan niet worden verwijderd
    expect((await api('DELETE', `/api/business-units/${pz.id}`)).statusCode).toBe(409);
  });

  it('bewaart het profiel van een gebruiker en houdt de medewerker met hetzelfde e-mailadres gelijk', async () => {
    const { api, db } = await app();
    const eenheden = await db.select().from(businessUnits);
    const iv = eenheden.find((u) => u.afkorting === 'IV')!;
    const pz = eenheden.find((u) => u.afkorting === 'PZ')!;
    const m = (await api('POST', '/api/employees', { naam: 'Ruben', telefoon: '0612345678', email: 'ruben@test.nl', functie: 'Architect', businessUnitId: pz.id })).json();
    // zonder eigen profiel leest de gebruiker mee met de medewerker
    expect((await api('GET', '/api/gebruikers')).json().find((g: any) => g.id === ID(2))).toMatchObject({ functie: 'Architect', businessUnitId: pz.id });
    // een profielwijziging werkt de medewerker bij
    expect((await api('PUT', `/api/gebruikers/${ID(2)}/profiel`, { functie: 'Enterprise architect', businessUnitId: iv.id })).statusCode).toBe(200);
    expect((await db.select().from(employees)).find((e) => e.id === m.id)).toMatchObject({ functie: 'Enterprise architect', businessUnitId: iv.id });
    // en andersom
    await api('PATCH', `/api/employees/${m.id}`, { functie: 'Lead architect' });
    expect((await db.select().from(gebruikersprofielen))[0]).toMatchObject({ email: 'ruben@test.nl', functie: 'Lead architect' });
    expect((await api('PUT', `/api/gebruikers/${ID(2)}/profiel`, { functie: '', businessUnitId: ID(9) })).statusCode).toBe(400);
    expect((await api('PUT', `/api/gebruikers/${ID(8)}/profiel`, { functie: 'x' })).statusCode).toBe(404);
  });

  it('legt bij het aanmaken van een gebruiker functie en unit vast, en wist het profiel bij verwijderen', async () => {
    const { api, db } = await app();
    const [pz] = await db.select().from(businessUnits);
    const r = await api('POST', '/api/gebruikers', { naam: 'Nieuw Persoon', email: 'Nieuw@Test.nl', rol: 'accountmanager', functie: 'Consultant', businessUnitId: pz.id });
    expect(r.statusCode).toBe(201);
    expect((await db.select().from(gebruikersprofielen))).toEqual([expect.objectContaining({ email: 'nieuw@test.nl', functie: 'Consultant' })]);
    expect((await api('POST', '/api/gebruikers', { naam: 'Fout', email: 'fout@test.nl', businessUnitId: ID(9) })).statusCode).toBe(400);
    expect((await api('DELETE', `/api/gebruikers/${r.json().id}`)).statusCode).toBe(200);
    expect(await db.select().from(gebruikersprofielen)).toHaveLength(0);
  });
});
