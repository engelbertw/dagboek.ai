/**
 * Gebruikersbeheer: de accounts van de beheerders staan in Keycloak, niet in de database van het dagboek. Dit bestand praat met de Admin API van
 * Keycloak via een service-account met alleen rechten op gebruikers, en biedt de routes voor het scherm Gebruikers.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { asc } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './db.js';
import { employees } from './schema.js';
import type { KeycloakConfig } from './config.js';
import { ACCOUNTMANAGER_ROL, BEHEERDER_ROL, ROLLEN, type GebruikersRol } from './rollen.js';
import { log } from './log.js';

type Haal = typeof fetch;

export interface Gebruiker { id: string; email: string; naam: string; rol: GebruikersRol; actief: boolean; mfa: boolean; aangemaakt: string | null }

export interface KeycloakBeheer {
  lijst(): Promise<Gebruiker[]>;
  maak(p: { email: string; naam: string; wachtwoord: string; rol?: GebruikersRol }): Promise<string>;
  zetRol(id: string, rol: GebruikersRol): Promise<void>;
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

  /** De rol zoals Keycloak hem kent; ontbreekt hij (de rol is nog niet aangemaakt in de realm), dan is dat een duidelijke fout. */
  const rolVan = async (rol: GebruikersRol) => {
    try { return await (await vraag(`/roles/${rol}`)).json(); } catch (e) {
      if (e instanceof BeheerFout && e.status === 404) throw new BeheerFout(409, `De rol ${rol} bestaat nog niet in Keycloak`);
      throw e;
    }
  };
  type KcGebruiker = { id: string; email?: string; firstName?: string; lastName?: string; enabled: boolean; createdTimestamp?: number };
  const metRol = async (rol: GebruikersRol): Promise<KcGebruiker[]> => {
    try { return (await (await vraag(`/roles/${rol}/users?max=200`)).json()) as KcGebruiker[]; } catch (e) {
      if (e instanceof BeheerFout && e.status === 404) return []; // een rol die nog niet bestaat heeft nog geen gebruikers
      throw e;
    }
  };

  return {
    async lijst() {
      const perRol = await Promise.all(ROLLEN.map(async (rol) => (await metRol(rol)).map((u) => ({ u, rol }))));
      const uniek = new Map<string, { u: KcGebruiker; rol: GebruikersRol }>();
      for (const r of perRol.flat()) if (!uniek.has(r.u.id)) uniek.set(r.u.id, r); // ROLLEN begint met beheerder: wie beide heeft, is beheerder
      return Promise.all([...uniek.values()].map(async ({ u, rol }) => ({
        id: u.id, email: u.email ?? '', naam: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '', rol, actief: u.enabled,
        mfa: await heeftOtp(u.id), aangemaakt: u.createdTimestamp ? new Date(u.createdTimestamp).toISOString() : null,
      })));
    },
    async maak({ email, naam, wachtwoord, rol = BEHEERDER_ROL }) {
      const rolRep = await rolVan(rol);
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
      await vraag(`/users/${id}/role-mappings/realm`, { method: 'POST', body: JSON.stringify([rolRep]) });
      return id;
    },
    async zetRol(id, rol) {
      const nieuw = await rolVan(rol);
      const andere = ROLLEN.filter((x) => x !== rol);
      for (const o of andere) {
        const rep = await rolVan(o).catch(() => null);
        if (rep) await vraag(`/users/${id}/role-mappings/realm`, { method: 'DELETE', body: JSON.stringify([rep]) });
      }
      await vraag(`/users/${id}/role-mappings/realm`, { method: 'POST', body: JSON.stringify([nieuw]) });
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
  rol: z.enum(ROLLEN).default(BEHEERDER_ROL),
});

/** `ikEmail` geeft het e-mailadres van wie ingelogd is, zodat je jezelf niet kunt uitzetten of verwijderen. */
export function registreerGebruikers(app: FastifyInstance, beheer: KeycloakBeheer | undefined, db: Db, ikEmail: (req: unknown) => string | null) {
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

  // Medewerkers die een account kunnen krijgen: met een e-mailadres en nog zonder account in Keycloak.
  app.get('/api/gebruikers/kandidaten', async (_req, reply) => {
    if (!beheer) return ontbreekt(reply);
    return metFout(reply, async () => {
      const bestaand = new Set((await beheer.lijst()).map((g) => g.email.toLowerCase()));
      const rijen = await db.select({ id: employees.id, naam: employees.naam, email: employees.email, actief: employees.actief, rol: employees.rol }).from(employees).orderBy(asc(employees.naam));
      return rijen.map((m) => ({ ...m, status: !m.email ? 'geen_email' : bestaand.has(m.email.toLowerCase()) ? 'heeft_account' : 'kan' }));
    });
  });

  // Accounts maken voor geselecteerde medewerkers. Wie geen e-mailadres heeft of al een account heeft, wordt overgeslagen.
  app.post('/api/gebruikers/uit-medewerkers', async (req, reply) => {
    if (!beheer) return ontbreekt(reply);
    const b = z.object({ employeeIds: z.array(uuid).min(1).max(100), rol: z.enum(ROLLEN).default(ACCOUNTMANAGER_ROL) }).parse(req.body);
    return metFout(reply, async () => {
      const bestaand = new Set((await beheer.lijst()).map((g) => g.email.toLowerCase()));
      const rijen = await db.select({ id: employees.id, naam: employees.naam, email: employees.email }).from(employees).orderBy(asc(employees.naam));
      const uitkomst: { id: string; naam: string; email: string; status: 'aangemaakt' | 'heeft_account' | 'geen_email' | 'ongeldig_email' | 'fout'; tijdelijkWachtwoord?: string; reden?: string }[] = [];
      for (const m of rijen.filter((r) => b.employeeIds.includes(r.id))) {
        const email = m.email.trim().toLowerCase();
        if (!email) { uitkomst.push({ id: m.id, naam: m.naam, email, status: 'geen_email' }); continue; }
        if (!z.string().email().safeParse(email).success) { uitkomst.push({ id: m.id, naam: m.naam, email, status: 'ongeldig_email' }); continue; }
        if (bestaand.has(email)) { uitkomst.push({ id: m.id, naam: m.naam, email, status: 'heeft_account' }); continue; }
        const wachtwoord = tijdelijkWachtwoord();
        try {
          await beheer.maak({ email, naam: m.naam, wachtwoord, rol: b.rol });
          bestaand.add(email);
          uitkomst.push({ id: m.id, naam: m.naam, email, status: 'aangemaakt', tijdelijkWachtwoord: wachtwoord });
        } catch (e) {
          if (!(e instanceof BeheerFout)) throw e;
          uitkomst.push({ id: m.id, naam: m.naam, email, status: 'fout', reden: e.message });
          if (e.status === 502 || e.message.includes('bestaat nog niet')) break; // Keycloak onbereikbaar of rol ontbreekt: doorgaan heeft geen zin
        }
      }
      log('info', 'gebruikers.uit_medewerkers', { rol: b.rol, aangemaakt: uitkomst.filter((u) => u.status === 'aangemaakt').length });
      return { rol: b.rol, resultaat: uitkomst };
    });
  });

  app.post('/api/gebruikers', async (req, reply) => {
    if (!beheer) return ontbreekt(reply);
    const b = nieuweGebruiker.parse(req.body);
    return metFout(reply, async () => {
      const wachtwoord = tijdelijkWachtwoord();
      const id = await beheer.maak({ ...b, wachtwoord });
      log('info', 'gebruiker.aangemaakt', { rol: b.rol });
      return reply.code(201).send({ id, tijdelijkWachtwoord: wachtwoord });
    });
  });

  // Je kunt jezelf niet uitzetten of verwijderen, en de laatste actieve beheerder blijft altijd bestaan.
  async function beschermd(b: KeycloakBeheer, id: string, req: unknown, eigenBericht = 'Je kunt je eigen account niet uitzetten of verwijderen', laatsteBericht = 'De laatste actieve beheerder kan niet worden uitgezet of verwijderd') {
    const lijst = await b.lijst();
    const doel = lijst.find((g) => g.id === id);
    if (!doel) throw new BeheerFout(404, 'Gebruiker niet gevonden');
    if (doel.email.toLowerCase() === ikEmail(req)) throw new BeheerFout(409, eigenBericht);
    if (doel.actief && doel.rol === BEHEERDER_ROL && lijst.filter((g) => g.actief && g.rol === BEHEERDER_ROL && g.id !== id).length === 0) throw new BeheerFout(409, laatsteBericht);
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

  // Een rol wijzigen mag niet bij jezelf, en de laatste actieve beheerder blijft beheerder.
  app.post('/api/gebruikers/:id/rol', async (req, reply) => {
    if (!beheer) return ontbreekt(reply);
    const id = uuid.parse((req.params as any).id);
    const { rol } = z.object({ rol: z.enum(ROLLEN) }).parse(req.body);
    return metFout(reply, async () => {
      const doel = (await beheer.lijst()).find((g) => g.id === id);
      if (!doel) throw new BeheerFout(404, 'Gebruiker niet gevonden');
      if (rol !== BEHEERDER_ROL) await beschermd(beheer, id, req, 'De rol van je eigen account kun je niet wijzigen', 'De laatste actieve beheerder kan geen accountmanager worden');
      await beheer.zetRol(id, rol);
      log('info', 'gebruiker.rol_gewijzigd', { rol });
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
