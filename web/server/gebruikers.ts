/**
 * Gebruikersbeheer: de accounts van de beheerders staan in Keycloak, niet in de database van het dagboek. Dit bestand praat met de Admin API van
 * Keycloak via een service-account met alleen rechten op gebruikers, en biedt de routes voor het scherm Gebruikers.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { KeycloakConfig } from './config.js';
import { BEHEERDER_ROL } from './oidc.js';
import { log } from './log.js';

type Haal = typeof fetch;

export interface Gebruiker { id: string; email: string; naam: string; actief: boolean; mfa: boolean; aangemaakt: string | null }

export interface KeycloakBeheer {
  lijst(): Promise<Gebruiker[]>;
  maak(p: { email: string; naam: string; wachtwoord: string }): Promise<string>;
  zetActief(id: string, actief: boolean): Promise<void>;
  resetWachtwoord(id: string, wachtwoord: string): Promise<void>;
  resetMfa(id: string): Promise<void>;
  verwijder(id: string): Promise<void>;
}

export class BeheerFout extends Error {
  constructor(readonly status: number, bericht: string) { super(bericht); }
}

/** Een tijdelijk wachtwoord dat de gebruiker bij de eerste login meteen moet wijzigen. */
export const tijdelijkWachtwoord = () => randomBytes(18).toString('base64url');

export function maakKeycloakBeheer(cfg: KeycloakConfig, haal: Haal = fetch): KeycloakBeheer {
  const [basis, realm] = (() => {
    const m = /^(.*)\/realms\/([^/]+)$/.exec(cfg.issuer);
    return [m?.[1] ?? cfg.issuer, m?.[2] ?? 'dagboek'];
  })();
  const admin = `${basis}/admin/realms/${realm}`;
  let token: { waarde: string; tot: number } | null = null;

  async function sleutel(): Promise<string> {
    if (token && token.tot > Date.now() + 10_000) return token.waarde;
    const r = await haal(`${basis}/realms/${realm}/protocol/openid-connect/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(8000),
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.beheerClientId, client_secret: cfg.beheerClientSecret }),
    }).catch(() => { throw new BeheerFout(502, 'Keycloak is niet bereikbaar'); });
    if (!r.ok) throw new BeheerFout(502, 'Inloggen bij Keycloak voor gebruikersbeheer mislukt');
    const b = (await r.json()) as { access_token: string; expires_in: number };
    token = { waarde: b.access_token, tot: Date.now() + b.expires_in * 1000 };
    return token.waarde;
  }

  async function vraag(pad: string, init: RequestInit = {}): Promise<Response> {
    const r = await haal(`${admin}${pad}`, {
      ...init, signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${await sleutel()}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
    }).catch((e) => { if (e instanceof BeheerFout) throw e; throw new BeheerFout(502, 'Keycloak is niet bereikbaar'); });
    if (r.status === 404) throw new BeheerFout(404, 'Gebruiker niet gevonden');
    if (r.status === 409) throw new BeheerFout(409, 'Er bestaat al een gebruiker met dit e-mailadres');
    if (!r.ok) throw new BeheerFout(502, `Keycloak antwoordde ${r.status}`);
    return r;
  }

  const heeftOtp = async (id: string) => ((await (await vraag(`/users/${id}/credentials`)).json()) as { type: string }[]).some((c) => c.type === 'otp');

  return {
    async lijst() {
      const rollen = await (await vraag(`/roles/${BEHEERDER_ROL}/users?max=200`)).json() as { id: string; email?: string; firstName?: string; lastName?: string; enabled: boolean; createdTimestamp?: number }[];
      return Promise.all(rollen.map(async (u) => ({
        id: u.id, email: u.email ?? '', naam: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '', actief: u.enabled,
        mfa: await heeftOtp(u.id), aangemaakt: u.createdTimestamp ? new Date(u.createdTimestamp).toISOString() : null,
      })));
    },
    async maak({ email, naam, wachtwoord }) {
      const [voor, ...rest] = naam.split(/\s+/);
      const r = await vraag('/users', {
        method: 'POST',
        body: JSON.stringify({
          username: email, email, firstName: voor, lastName: rest.join(' '), enabled: true, emailVerified: true,
          requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'], credentials: [{ type: 'password', value: wachtwoord, temporary: true }],
        }),
      });
      const id = r.headers.get('location')?.split('/').pop();
      if (!id) throw new BeheerFout(502, 'Keycloak gaf geen gebruiker terug');
      const rol = await (await vraag(`/roles/${BEHEERDER_ROL}`)).json();
      await vraag(`/users/${id}/role-mappings/realm`, { method: 'POST', body: JSON.stringify([rol]) });
      return id;
    },
    async zetActief(id, actief) { await vraag(`/users/${id}`, { method: 'PUT', body: JSON.stringify({ enabled: actief }) }); },
    async resetWachtwoord(id, wachtwoord) {
      await vraag(`/users/${id}/reset-password`, { method: 'PUT', body: JSON.stringify({ type: 'password', value: wachtwoord, temporary: true }) });
    },
    async resetMfa(id) {
      const creds = (await (await vraag(`/users/${id}/credentials`)).json()) as { id: string; type: string }[];
      for (const c of creds.filter((x) => x.type === 'otp')) await vraag(`/users/${id}/credentials/${c.id}`, { method: 'DELETE' });
      const u = (await (await vraag(`/users/${id}`)).json()) as { requiredActions?: string[] };
      const acties = Array.from(new Set([...(u.requiredActions ?? []), 'CONFIGURE_TOTP']));
      await vraag(`/users/${id}`, { method: 'PUT', body: JSON.stringify({ requiredActions: acties }) });
    },
    async verwijder(id) { await vraag(`/users/${id}`, { method: 'DELETE' }); },
  };
}

const uuid = z.string().uuid();
const nieuweGebruiker = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  naam: z.string().trim().min(1).max(150),
});

/** `ikEmail` geeft het e-mailadres van wie ingelogd is, zodat je jezelf niet kunt uitzetten of verwijderen. */
export function registreerGebruikers(app: FastifyInstance, beheer: KeycloakBeheer | undefined, ikEmail: (req: unknown) => string | null) {
  const ontbreekt = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => reply.code(503).send({ fout: 'Gebruikersbeheer is niet ingesteld (Keycloak ontbreekt)' });

  const metFout = async (reply: any, taak: () => Promise<unknown>) => {
    try { return await taak(); } catch (e) {
      if (e instanceof BeheerFout) return reply.code(e.status).send({ fout: e.message });
      throw e;
    }
  };

  app.get('/api/gebruikers', async (_req, reply) => {
    if (!beheer) return ontbreekt(reply);
    return metFout(reply, () => beheer.lijst());
  });

  app.post('/api/gebruikers', async (req, reply) => {
    if (!beheer) return ontbreekt(reply);
    const b = nieuweGebruiker.parse(req.body);
    return metFout(reply, async () => {
      const wachtwoord = tijdelijkWachtwoord();
      const id = await beheer.maak({ ...b, wachtwoord });
      log('info', 'gebruiker.aangemaakt', { door: 'beheerder' });
      return reply.code(201).send({ id, tijdelijkWachtwoord: wachtwoord });
    });
  });

  // Je kunt jezelf niet uitzetten of verwijderen, en de laatste actieve beheerder blijft altijd bestaan.
  async function beschermd(b: KeycloakBeheer, id: string, req: unknown) {
    const lijst = await b.lijst();
    const doel = lijst.find((g) => g.id === id);
    if (!doel) throw new BeheerFout(404, 'Gebruiker niet gevonden');
    if (doel.email.toLowerCase() === ikEmail(req)) throw new BeheerFout(409, 'Je kunt je eigen account niet uitzetten of verwijderen');
    if (doel.actief && lijst.filter((g) => g.actief && g.id !== id).length === 0) throw new BeheerFout(409, 'De laatste actieve beheerder kan niet worden uitgezet of verwijderd');
  }

  app.patch('/api/gebruikers/:id', async (req, reply) => {
    if (!beheer) return ontbreekt(reply);
    const id = uuid.parse((req.params as any).id);
    const { actief } = z.object({ actief: z.boolean() }).parse(req.body);
    return metFout(reply, async () => {
      if (!actief) await beschermd(beheer, id, req);
      await beheer.zetActief(id, actief);
      log('info', actief ? 'gebruiker.aangezet' : 'gebruiker.uitgezet', {});
      return { ok: true };
    });
  });

  app.post('/api/gebruikers/:id/wachtwoord', async (req, reply) => {
    if (!beheer) return ontbreekt(reply);
    const id = uuid.parse((req.params as any).id);
    return metFout(reply, async () => {
      const wachtwoord = tijdelijkWachtwoord();
      await beheer.resetWachtwoord(id, wachtwoord);
      log('info', 'gebruiker.wachtwoord_reset', {});
      return { tijdelijkWachtwoord: wachtwoord };
    });
  });

  app.post('/api/gebruikers/:id/mfa-reset', async (req, reply) => {
    if (!beheer) return ontbreekt(reply);
    const id = uuid.parse((req.params as any).id);
    return metFout(reply, async () => {
      await beheer.resetMfa(id);
      log('info', 'gebruiker.mfa_reset', {});
      return { ok: true };
    });
  });

  app.delete('/api/gebruikers/:id', async (req, reply) => {
    if (!beheer) return ontbreekt(reply);
    const id = uuid.parse((req.params as any).id);
    return metFout(reply, async () => {
      await beschermd(beheer, id, req);
      await beheer.verwijder(id);
      log('info', 'gebruiker.verwijderd', {});
      return { ok: true };
    });
  });
}
