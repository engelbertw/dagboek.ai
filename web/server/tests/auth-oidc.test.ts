import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashWachtwoord } from '../auth.js';
import { ontbrekendeInstellingen, type Config, type KeycloakConfig } from '../config.js';
import { connectMemory, migrate } from '../db.js';
import { maakOidc, type Oidc } from '../oidc.js';

const ISSUER = 'https://kc.test/realms/dagboek';
const KC: KeycloakConfig = { issuer: ISSUER, clientId: 'dagboek-web', clientSecret: 'geheim', beheerClientId: '', beheerClientSecret: '' };

const sluit: (() => Promise<void>)[] = [];
afterEach(async () => { while (sluit.length) await sluit.pop()!(); });

/** Een Keycloak-nabootsing: ontdekking, sleutels en tokenuitgifte, ondertekend met een eigen sleutelpaar. */
async function nepKeycloak(opties: { rollen?: string[]; nonce?: (n: string) => string; email?: string; sleutelWissel?: boolean } = {}) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const aanvragen: string[] = [];
  let verwachteNonce = '';
  const haal: typeof fetch = async (input, init) => {
    const url = String(input);
    aanvragen.push(url);
    if (url.endsWith('/.well-known/openid-configuration')) {
      return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`, token_endpoint: `${ISSUER}/protocol/openid-connect/token`, jwks_uri: `${ISSUER}/protocol/openid-connect/certs`, end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout` });
    }
    if (url.endsWith('/certs')) return Response.json({ keys: opties.sleutelWissel && !aanvragen.some((u, i) => u.endsWith('/token') && i) ? [] : [jwk] });
    if (url.endsWith('/token')) {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('code_verifier')).toBeTruthy();
      expect(body.get('client_secret')).toBe('geheim');
      const teken = (claims: Record<string, unknown>, audience?: string) => {
        const t = new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(ISSUER).setSubject('u1').setIssuedAt().setExpirationTime('5m');
        return (audience ? t.setAudience(audience) : t).sign(privateKey);
      };
      const id = await teken({ nonce: opties.nonce ? opties.nonce(verwachteNonce) : verwachteNonce, email: opties.email ?? 'Ruben@Test.nl', name: 'Ruben Test' }, 'dagboek-web');
      const toegang = await teken({ realm_access: { roles: opties.rollen ?? ['beheerder'] } }, 'account');
      return Response.json({ id_token: id, access_token: toegang });
    }
    return new Response('niet gevonden', { status: 404 });
  };
  return { haal, aanvragen, zetNonce: (n: string) => { verwachteNonce = n; } };
}

describe('maakOidc', () => {
  it('bouwt een inlog-URL met PKCE, state en nonce', async () => {
    const kc = await nepKeycloak();
    const s = await maakOidc(KC, kc.haal).start('https://dagboek.test/api/auth/callback');
    const u = new URL(s.url);
    expect(u.origin + u.pathname).toBe(`${ISSUER}/protocol/openid-connect/auth`);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')).toBe(s.state);
    expect(u.searchParams.get('nonce')).toBe(s.nonce);
    expect(u.searchParams.get('redirect_uri')).toBe('https://dagboek.test/api/auth/callback');
    expect(s.verifier.length).toBeGreaterThan(40);
  });

  it('geeft een beheerder terug met e-mail in kleine letters', async () => {
    const kc = await nepKeycloak();
    const oidc = maakOidc(KC, kc.haal);
    const s = await oidc.start('https://x/cb');
    kc.zetNonce(s.nonce);
    expect(await oidc.afronden({ code: 'c', verifier: s.verifier, nonce: s.nonce, redirectUri: 'https://x/cb' })).toEqual({ email: 'ruben@test.nl', naam: 'Ruben Test', rol: 'beheerder' });
  });

  it('geeft een accountmanager de rol accountmanager, en wie beide heeft is beheerder', async () => {
    for (const [rollen, verwacht] of [[['accountmanager'], 'accountmanager'], [['accountmanager', 'beheerder'], 'beheerder']] as const) {
      const kc = await nepKeycloak({ rollen: [...rollen] });
      const oidc = maakOidc(KC, kc.haal);
      const s = await oidc.start('https://x/cb');
      kc.zetNonce(s.nonce);
      expect((await oidc.afronden({ code: 'c', verifier: s.verifier, nonce: s.nonce, redirectUri: 'https://x/cb' })).rol).toBe(verwacht);
    }
  });

  it('weigert zonder beheerdersrol', async () => {
    const kc = await nepKeycloak({ rollen: ['uma_authorization'] });
    const oidc = maakOidc(KC, kc.haal);
    const s = await oidc.start('https://x/cb');
    kc.zetNonce(s.nonce);
    await expect(oidc.afronden({ code: 'c', verifier: s.verifier, nonce: s.nonce, redirectUri: 'https://x/cb' })).rejects.toMatchObject({ code: 'geen_toegang' });
  });

  it('weigert een andere nonce', async () => {
    const kc = await nepKeycloak({ nonce: () => 'iets-anders' });
    const oidc = maakOidc(KC, kc.haal);
    const s = await oidc.start('https://x/cb');
    await expect(oidc.afronden({ code: 'c', verifier: s.verifier, nonce: s.nonce, redirectUri: 'https://x/cb' })).rejects.toMatchObject({ code: 'ongeldig' });
  });

  it('weigert een token dat met een andere sleutel is ondertekend', async () => {
    const kc = await nepKeycloak();
    const andere = await nepKeycloak();
    // Tokens van de ene nep-Keycloak, sleutels van de andere.
    const haal: typeof fetch = (i, init) => (String(i).endsWith('/certs') ? andere.haal(i, init) : kc.haal(i, init));
    const oidc = maakOidc(KC, haal);
    const s = await oidc.start('https://x/cb');
    kc.zetNonce(s.nonce);
    await expect(oidc.afronden({ code: 'c', verifier: s.verifier, nonce: s.nonce, redirectUri: 'https://x/cb' })).rejects.toMatchObject({ code: 'ongeldig' });
  });

  it('meldt een onbereikbare Keycloak', async () => {
    const oidc = maakOidc(KC, async () => { throw new Error('netwerk'); });
    await expect(oidc.start('https://x/cb')).rejects.toMatchObject({ code: 'keycloak' });
  });
});

async function appMet(oidc: Oidc | undefined, config: Partial<Config> = {}) {
  const handle = await connectMemory();
  await migrate(handle);
  const volledig: Config = {
    port: 0, databaseUrl: 'memory', sessionSecret: 'geheim-voor-tests', adminEmail: 'beheer@test.nl', adminPasswordHash: hashWachtwoord('een-lang-testwachtwoord'),
    secureCookies: false, voiceUrl: '', voiceAdminToken: '', serviceKey: 's', llmBaseUrl: '', llmApiKey: '', llmModel: 't', transcriptBewaarDagen: 30,
    transcriptOnbevestigdUren: 24, jiraEmail: '', jiraApiToken: '', publiekeUrl: 'https://dagboek.test', mcpKey: '', ...config,
  };
  const app = buildApp({ db: handle.db, config: volledig, voice: async () => ({ gebeld: true, call_id: 'v' }), llm: async () => '', oidc });
  await app.ready();
  sluit.push(async () => { await app.close(); await handle.close(); });
  return app;
}

const namen = (r: { cookies: { name: string; value: string }[] }) => Object.fromEntries(r.cookies.map((c) => [c.name, c.value]));

describe('inloggen via Keycloak (routes)', () => {
  const nepOidc = (uitkomst: 'ok' | 'geen_toegang'): Oidc => ({
    start: async () => ({ url: 'https://kc.test/auth?x=1', state: 'st', nonce: 'no', verifier: 'ver' }),
    afronden: async (p) => {
      expect(p).toMatchObject({ code: 'code1', verifier: 'ver', nonce: 'no' });
      if (uitkomst === 'geen_toegang') { const { OidcFout } = await import('../oidc.js'); throw new OidcFout('geen_toegang', 'nee'); }
      return { email: 'ruben@test.nl', naam: 'Ruben Test', rol: 'beheerder' };
    },
    uitlogUrl: async (terug) => `https://kc.test/logout?terug=${encodeURIComponent(terug)}`,
  });

  it('stuurt naar Keycloak en zet een tijdelijke cookie', async () => {
    const app = await appMet(nepOidc('ok'), { keycloak: KC, noodlogin: false });
    const r = await app.inject({ method: 'GET', url: '/api/auth/start' });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('https://kc.test/auth?x=1');
    expect(namen(r).dagboek_oidc).toBeTruthy();
    expect(r.headers['set-cookie']).toEqual(expect.stringContaining('SameSite=Lax'));
  });

  it('logt in na een geldige terugkeer en geeft rol en naam door', async () => {
    const app = await appMet(nepOidc('ok'), { keycloak: KC, noodlogin: false });
    const start = await app.inject({ method: 'GET', url: '/api/auth/start' });
    const cb = await app.inject({ method: 'GET', url: '/api/auth/callback?code=code1&state=st', cookies: { dagboek_oidc: namen(start).dagboek_oidc } });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe('/');
    const sessie = namen(cb).dagboek_sessie;
    expect(sessie).toBeTruthy();
    expect((await app.inject({ method: 'GET', url: '/api/me', cookies: { dagboek_sessie: sessie } })).json()).toMatchObject({ ingelogd: true, email: 'ruben@test.nl', naam: 'Ruben Test', rol: 'beheerder', keycloak: true, noodlogin: false });
    expect((await app.inject({ method: 'GET', url: '/api/employees', cookies: { dagboek_sessie: sessie } })).statusCode).toBe(200);
  });

  it('weigert een verkeerde state, ontbrekende cookie of Keycloak-fout', async () => {
    const app = await appMet(nepOidc('ok'), { keycloak: KC, noodlogin: false });
    const start = await app.inject({ method: 'GET', url: '/api/auth/start' });
    const cookies = { dagboek_oidc: namen(start).dagboek_oidc };
    for (const r of [
      await app.inject({ method: 'GET', url: '/api/auth/callback?code=code1&state=fout', cookies }),
      await app.inject({ method: 'GET', url: '/api/auth/callback?code=code1&state=st' }),
      await app.inject({ method: 'GET', url: '/api/auth/callback?error=access_denied&state=st', cookies }),
    ]) {
      expect(r.headers.location).toBe('/?inlogfout=ongeldig');
      expect(namen(r).dagboek_sessie).toBeUndefined();
    }
  });

  it('geeft geen sessie aan iemand zonder beheerdersrol', async () => {
    const app = await appMet(nepOidc('geen_toegang'), { keycloak: KC, noodlogin: false });
    const start = await app.inject({ method: 'GET', url: '/api/auth/start' });
    const cb = await app.inject({ method: 'GET', url: '/api/auth/callback?code=code1&state=st', cookies: { dagboek_oidc: namen(start).dagboek_oidc } });
    expect(cb.headers.location).toBe('/?inlogfout=geen_toegang');
    expect(namen(cb).dagboek_sessie).toBeUndefined();
  });

  it('zet de noodlogin uit met Keycloak, en aan met NOODLOGIN=aan', async () => {
    const uit = await appMet(nepOidc('ok'), { keycloak: KC, noodlogin: false });
    expect((await uit.inject({ method: 'POST', url: '/api/login', payload: { email: 'beheer@test.nl', wachtwoord: 'een-lang-testwachtwoord' } })).statusCode).toBe(404);
    const aan = await appMet(nepOidc('ok'), { keycloak: KC, noodlogin: true });
    expect((await aan.inject({ method: 'POST', url: '/api/login', payload: { email: 'beheer@test.nl', wachtwoord: 'een-lang-testwachtwoord' } })).statusCode).toBe(200);
  });

  it('geeft bij uitloggen de Keycloak-uitlog-URL terug', async () => {
    const app = await appMet(nepOidc('ok'), { keycloak: KC, noodlogin: false });
    const start = await app.inject({ method: 'GET', url: '/api/auth/start' });
    const cb = await app.inject({ method: 'GET', url: '/api/auth/callback?code=code1&state=st', cookies: { dagboek_oidc: namen(start).dagboek_oidc } });
    const uit = await app.inject({ method: 'POST', url: '/api/logout', cookies: { dagboek_sessie: namen(cb).dagboek_sessie } });
    expect(uit.json().eindUrl).toBe('https://kc.test/logout?terug=https%3A%2F%2Fdagboek.test%2F');
  });

  it('is er niet zonder Keycloak, en de oude login blijft dan gewoon werken', async () => {
    const app = await appMet(undefined);
    expect((await app.inject({ method: 'GET', url: '/api/auth/start' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/me' })).json()).toMatchObject({ ingelogd: false, keycloak: false, noodlogin: true });
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'beheer@test.nl', wachtwoord: 'een-lang-testwachtwoord' } })).statusCode).toBe(200);
  });
});

describe('configuratie', () => {
  const basis = { databaseUrl: 'x', sessionSecret: 'x', serviceKey: 'x', adminEmail: '', adminPasswordHash: '' } as Config;
  it('eist ADMIN_* alleen met noodlogin, en de client-gegevens met Keycloak', () => {
    expect(ontbrekendeInstellingen({ ...basis, noodlogin: true })).toEqual(['ADMIN_EMAIL', 'ADMIN_PASSWORD_HASH']);
    expect(ontbrekendeInstellingen({ ...basis, noodlogin: false, keycloak: { ...KC, clientSecret: '' } })).toEqual(['KEYCLOAK_CLIENT_SECRET']);
    expect(ontbrekendeInstellingen({ ...basis, noodlogin: false, keycloak: KC })).toEqual([]);
  });
});
