import { afterEach, describe, expect, it } from 'vitest';
import { maakKeycloakBeheer, type Gebruiker, type KeycloakBeheer } from '../gebruikers.js';
import { maakTestApp } from './helpers.js';
import { buildApp } from '../app.js';
import { connectMemory, migrate } from '../db.js';
import { hashWachtwoord } from '../auth.js';

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function geheugenBeheer(): KeycloakBeheer & { gebruikers: Gebruiker[]; wachtwoorden: string[] } {
  const gebruikers: Gebruiker[] = [
    { id: ID(1), email: 'beheer@test.nl', naam: 'Beheer Test', rol: 'beheerder', actief: true, mfa: true, aangemaakt: null },
    { id: ID(2), email: 'ruben@test.nl', naam: 'Ruben Test', rol: 'beheerder', actief: true, mfa: false, aangemaakt: null },
  ];
  const wachtwoorden: string[] = [];
  return {
    gebruikers, wachtwoorden,
    lijst: async () => gebruikers.map((g) => ({ ...g })),
    maak: async ({ email, naam, wachtwoord, rol = 'beheerder' }) => { wachtwoorden.push(wachtwoord); gebruikers.push({ id: ID(gebruikers.length + 1), email, naam, rol, actief: true, mfa: false, aangemaakt: null }); return ID(gebruikers.length); },
    zetRol: async (id, rol) => { gebruikers.find((g) => g.id === id)!.rol = rol; },
    zetActief: async (id, actief) => { gebruikers.find((g) => g.id === id)!.actief = actief; },
    resetWachtwoord: async (_id, w) => { wachtwoorden.push(w); },
    resetMfa: async (id) => { gebruikers.find((g) => g.id === id)!.mfa = false; },
    verwijder: async (id) => { gebruikers.splice(gebruikers.findIndex((g) => g.id === id), 1); },
  };
}

async function metBeheer(beheer?: KeycloakBeheer) {
  const t = await maakTestApp();
  // Dezelfde app nogmaals opbouwen, nu mét gebruikersbeheer (de helper kent dat niet).
  await t.close();
  const handle = await connectMemory();
  await migrate(handle);
  const config = { ...t.config, adminPasswordHash: hashWachtwoord('een-lang-testwachtwoord') };
  const app = buildApp({ db: handle.db, config, voice: async () => ({ gebeld: true, call_id: 'v' }), llm: async () => '', gebruikersbeheer: beheer });
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'beheer@test.nl', wachtwoord: 'een-lang-testwachtwoord' } });
  const cookies = { dagboek_sessie: String(login.cookies[0].value) };
  const api = (method: string, url: string, payload?: unknown) => app.inject({ method: method as any, url, payload: payload as any, cookies });
  open.push({ close: async () => { await app.close(); await handle.close(); } } as T);
  return { app, api };
}

describe('gebruikersbeheer (routes)', () => {
  it('is niet beschikbaar zonder Keycloak en vraagt een sessie', async () => {
    const { app, api } = await metBeheer(undefined);
    expect((await api('GET', '/api/gebruikers')).statusCode).toBe(503);
    expect((await app.inject({ method: 'GET', url: '/api/gebruikers' })).statusCode).toBe(401);
  });

  it('toont de lijst en maakt een gebruiker aan met een tijdelijk wachtwoord', async () => {
    const beheer = geheugenBeheer();
    const { api } = await metBeheer(beheer);
    expect((await api('GET', '/api/gebruikers')).json()).toHaveLength(2);
    const r = await api('POST', '/api/gebruikers', { naam: 'Nieuwe Beheerder', email: 'Nieuw@Test.NL' });
    expect(r.statusCode).toBe(201);
    expect(r.json().tijdelijkWachtwoord).toBe(beheer.wachtwoorden[0]);
    expect(r.json().tijdelijkWachtwoord.length).toBeGreaterThanOrEqual(20);
    expect(beheer.gebruikers.at(-1)).toMatchObject({ email: 'nieuw@test.nl', naam: 'Nieuwe Beheerder' });
    expect((await api('POST', '/api/gebruikers', { naam: '', email: 'geen-mail' })).statusCode).toBe(400);
  });

  it('laat je jezelf niet uitzetten of verwijderen', async () => {
    const { api } = await metBeheer(geheugenBeheer());
    // De noodlogin geeft het e-mailadres beheer@test.nl; dat is de eigen gebruiker 1.
    expect((await api('PATCH', `/api/gebruikers/${ID(1)}`, { actief: false })).statusCode).toBe(409);
    expect((await api('DELETE', `/api/gebruikers/${ID(1)}`)).statusCode).toBe(409);
  });

  it('laat de laatste actieve beheerder bestaan', async () => {
    const beheer = geheugenBeheer();
    const { api } = await metBeheer(beheer);
    // Ruben uitzetten mag: de ingelogde beheerder blijft actief. Een uitgezet account verwijderen mag ook.
    expect((await api('PATCH', `/api/gebruikers/${ID(2)}`, { actief: false })).statusCode).toBe(200);
    expect((await api('DELETE', `/api/gebruikers/${ID(2)}`)).statusCode).toBe(200);
    // De enige overgebleven actieve beheerder is jezelf, en die blijft staan.
    expect((await api('PATCH', `/api/gebruikers/${ID(1)}`, { actief: false })).statusCode).toBe(409);
    expect(beheer.gebruikers).toHaveLength(1);
  });

  it('zet aan, reset wachtwoord en MFA, en verwijdert', async () => {
    const beheer = geheugenBeheer();
    const { api } = await metBeheer(beheer);
    expect((await api('PATCH', `/api/gebruikers/${ID(2)}`, { actief: false })).statusCode).toBe(200);
    expect(beheer.gebruikers[1].actief).toBe(false);
    expect((await api('PATCH', `/api/gebruikers/${ID(2)}`, { actief: true })).statusCode).toBe(200);
    expect((await api('POST', `/api/gebruikers/${ID(2)}/wachtwoord`)).json().tijdelijkWachtwoord).toBe(beheer.wachtwoorden.at(-1));
    beheer.gebruikers[0].mfa = true;
    expect((await api('POST', `/api/gebruikers/${ID(1)}/mfa-reset`)).statusCode).toBe(200);
    expect(beheer.gebruikers[0].mfa).toBe(false);
    expect((await api('DELETE', `/api/gebruikers/${ID(2)}`)).statusCode).toBe(200);
    expect(beheer.gebruikers).toHaveLength(1);
    expect((await api('PATCH', '/api/gebruikers/geen-uuid', { actief: true })).statusCode).toBe(400);
  });
});

describe('gebruikersbeheer: rollen', () => {
  it('maakt een accountmanager aan en wijzigt de rol, maar niet bij jezelf of de laatste beheerder', async () => {
    const beheer = geheugenBeheer();
    const { api } = await metBeheer(beheer);
    const r = await api('POST', '/api/gebruikers', { naam: 'Ana Account', email: 'ana@test.nl', rol: 'accountmanager' });
    expect(r.statusCode).toBe(201);
    expect(beheer.gebruikers.at(-1)).toMatchObject({ email: 'ana@test.nl', rol: 'accountmanager' });
    expect((await api('POST', '/api/gebruikers', { naam: 'X', email: 'x@test.nl', rol: 'baas' })).statusCode).toBe(400);
    expect((await api('POST', `/api/gebruikers/${ID(2)}/rol`, { rol: 'accountmanager' })).statusCode).toBe(200);
    expect(beheer.gebruikers[1].rol).toBe('accountmanager');
    // Jezelf (beheer@test.nl) blijft beheerder, en een ongeldige rol wordt geweigerd.
    expect((await api('POST', `/api/gebruikers/${ID(1)}/rol`, { rol: 'accountmanager' })).statusCode).toBe(409);
    expect((await api('POST', `/api/gebruikers/${ID(2)}/rol`, { rol: 'baas' })).statusCode).toBe(400);
    // Een accountmanager telt niet mee als beheerder: de enige andere beheerder (jij) is al beschermd, en Ana uitzetten mag.
    expect((await api('PATCH', `/api/gebruikers/${ID(3)}`, { actief: false })).statusCode).toBe(200);
  });
});

describe('maakKeycloakBeheer (Admin API)', () => {
  const CFG = { issuer: 'https://kc.test/realms/dagboek', clientId: 'w', clientSecret: 's', beheerClientId: 'dagboek-beheer', beheerClientSecret: 'b' };

  it('maakt een gebruiker met verplichte acties en geeft hem de rol beheerder', async () => {
    const verzoeken: { url: string; method: string; body?: any; auth?: string }[] = [];
    const haal: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = init?.body && typeof init.body === 'string' && !url.endsWith('/token') ? JSON.parse(init.body) : undefined;
      verzoeken.push({ url, method: init?.method ?? 'GET', body, auth: (init?.headers as any)?.authorization });
      if (url.endsWith('/token')) return Response.json({ access_token: 'tok', expires_in: 300 });
      if (url.endsWith('/admin/realms/dagboek/users') && init?.method === 'POST') return new Response(null, { status: 201, headers: { location: 'https://kc.test/admin/realms/dagboek/users/abc' } });
      if (url.endsWith('/roles/beheerder')) return Response.json({ id: 'r1', name: 'beheerder' });
      return new Response(null, { status: 204 });
    };
    const id = await maakKeycloakBeheer(CFG, haal).maak({ email: 'a@b.nl', naam: 'Anna van Dijk', wachtwoord: 'tijdelijk-wachtwoord-1' });
    expect(id).toBe('abc');
    const maak = verzoeken.find((v) => v.method === 'POST' && v.url.endsWith('/users'))!;
    expect(maak.auth).toBe('Bearer tok');
    expect(maak.body).toMatchObject({
      username: 'a@b.nl', email: 'a@b.nl', firstName: 'Anna', lastName: 'van Dijk', enabled: true,
      requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'], credentials: [{ type: 'password', value: 'tijdelijk-wachtwoord-1', temporary: true }],
    });
    expect(verzoeken.find((v) => v.url.endsWith('/users/abc/role-mappings/realm'))!.body).toEqual([{ id: 'r1', name: 'beheerder' }]);
  });

  it('geeft een accountmanager de rol accountmanager en meldt een rol die nog niet bestaat', async () => {
    const verzoeken: { url: string; method: string; body?: any }[] = [];
    const haal: typeof fetch = async (input, init) => {
      const url = String(input);
      verzoeken.push({ url, method: init?.method ?? 'GET', body: init?.body && typeof init.body === 'string' && !url.endsWith('/token') ? JSON.parse(init.body) : undefined });
      if (url.endsWith('/token')) return Response.json({ access_token: 'tok', expires_in: 300 });
      if (url.endsWith('/users') && init?.method === 'POST') return new Response(null, { status: 201, headers: { location: 'https://kc.test/admin/realms/dagboek/users/abc' } });
      if (url.endsWith('/roles/accountmanager')) return Response.json({ id: 'r2', name: 'accountmanager' });
      if (url.endsWith('/roles/beheerder')) return new Response(null, { status: 404 });
      return new Response(null, { status: 204 });
    };
    const kc = maakKeycloakBeheer(CFG, haal);
    await kc.maak({ email: 'a@b.nl', naam: 'Anna', wachtwoord: 'tijdelijk-wachtwoord-1', rol: 'accountmanager' });
    expect(verzoeken.find((v) => v.url.endsWith('/users/abc/role-mappings/realm'))!.body).toEqual([{ id: 'r2', name: 'accountmanager' }]);
    // Zonder bestaande rol wordt er geen gebruiker aangemaakt.
    const voor = verzoeken.length;
    await expect(kc.maak({ email: 'c@d.nl', naam: 'Cor', wachtwoord: 'x', rol: 'beheerder' })).rejects.toMatchObject({ status: 409 });
    expect(verzoeken.slice(voor).some((v) => v.url.endsWith('/users'))).toBe(false);
  });

  it('meldt een bestaand e-mailadres en een onbereikbare Keycloak', async () => {
    const dubbel: typeof fetch = async (i) => (String(i).endsWith('/token') ? Response.json({ access_token: 't', expires_in: 300 }) : new Response(null, { status: 409 }));
    await expect(maakKeycloakBeheer(CFG, dubbel).maak({ email: 'a@b.nl', naam: 'A', wachtwoord: 'x' })).rejects.toMatchObject({ status: 409 });
    await expect(maakKeycloakBeheer(CFG, async () => { throw new Error('netwerk'); }).lijst()).rejects.toMatchObject({ status: 502 });
  });
});
