import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { InlogBeperking, controleerWachtwoord, hashWachtwoord, leesOndertekend, leesSessie, maakSessie, onderteken } from './auth.js';
import { OidcFout, type Oidc } from './oidc.js';
import { registreerGebruikers, type KeycloakBeheer } from './gebruikers.js';
import { noodloginAan, ontbrekendeInstellingen, type Config } from './config.js';
import { migratieNamen, type Db } from './db.js';
import { callLog, calls, employees, activiteiten, instellingen, opschoningRuns, overzichtToegang, projects, scheduleEmployees, schedules, suggesties, topics, updateHistorie, updates } from './schema.js';
import type { LlmClient } from './llm.js';
import { startGesprek } from './gesprek-starten.js';
import { foutcode, log } from './log.js';
import { opschoningStatus } from './opschoning.js';
import { logGebeurtenis } from './call-log.js';
import { EINDSTATUSSEN, zetStatus } from './gesprek-status.js';
import { JiraFout, geldigProject, geldigTeamId, schoneSite, type JiraClient, type JiraPunt } from './jira.js';
import { startInkomendGesprek } from './inkomend.js';
import { registreerMcp } from './mcp.js';
import { normaliseerCodewoord } from './gesprek-tools.js';
import { MOTOREN, bewaarGespreksmotor, bewaarInkomend, leesInkomend, bewaarJira, leesJira, bewaarHouding, bewaarInstructie, leesGespreksmotor, leesHouding, leesInstructie } from './instellingen.js';
import { stelInstructieVoor, type OnderwerpVoorSuggestie } from './suggestie.js';
import { automatischBellenAan, zetAutomatischBellen } from './scheduler.js';
import { berekenDashboard } from './dashboard.js';
import { samenvattenGesprek, vandaagNL } from './samenvatten.js';
import { bepaalBewaartermijn, leggToestemmingVast } from './toestemming.js';
import type { GespreksOnderwerp } from './schema.js';
import type { Onderwerp, VoiceClient, VoiceHerstel } from './voice.js';
import { vraagHerstel } from './gesprek-herstel.js';
import { registreerVerkoop } from './verkoop.js';
import { actieRijen, registreerActiviteiten } from './activiteiten.js';
import { ACCOUNTMANAGER_ROL, magDoen, normaleRol } from './rollen.js';
import { beoordeelLijst } from './medewerkers-import.js';

const COOKIE = 'dagboek_sessie';
/** Tijdelijke gegevens van een lopende Keycloak-inlogpoging (state, nonce, PKCE). */
const OIDC_COOKIE = 'dagboek_oidc';
const uuid = z.string().uuid();
const tijd = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Gebruik HH:MM');
const nonEmpty = z.string().trim().min(1);

// Bij een deelwijziging (PATCH) mogen velden die niet worden meegestuurd niet terugvallen op hun standaardwaarde.
function deelwijziging<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const velden = Object.fromEntries(Object.entries(schema.shape).map(([naam, veld]) => [naam, veld instanceof z.ZodDefault ? veld.unwrap() : veld]));
  return z.object(velden).partial() as z.ZodObject<{ [K in keyof T]: z.ZodOptional<T[K] extends z.ZodDefault<infer U> ? U : T[K]> }>;
}

const medewerkerBody = z.object({
  naam: nonEmpty.max(100), telefoon: nonEmpty.max(30), email: z.union([z.literal(''), z.string().trim().toLowerCase().email().max(200)]).default(''), taal: z.enum(['nl', 'en']).default('nl'),
  locgovGebruikersnaam: z.union([z.literal(''), z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{1,64}$/)]).default(''),
  actief: z.boolean().default(true), notitie: z.string().max(2000).default(''), toestemming: z.boolean().optional(),
  rol: z.enum(['medewerker', 'accountmanager']).default('medewerker'),
});
const projectBody = z.object({
  naam: nonEmpty.max(150), omschrijving: z.string().max(2000).default(''), status: z.enum(['actief', 'afgerond']).default('actief'),
});
const topicBody = z.object({
  titel: nonEmpty.max(200), type: z.enum(['project', 'thema', 'taak']).default('thema'),
  status: z.enum(['actief', 'wacht', 'afgerond']).default('actief'),
  projectId: uuid.nullable().default(null), eigenaarId: uuid.nullable().default(null), aanwijzingen: z.string().max(4000).default(''),
});
const updateBody = z.object({ samenvatting: nonEmpty.max(8000), besluiten: z.string().max(4000).default('') });
const scheduleBody = z.object({
  naam: z.string().trim().max(100).default(''),
  dagen: z.array(z.number().int().min(1).max(7)).min(1).max(7), tijden: z.array(tijd).min(1).max(6),
  actief: z.boolean().default(true), maxPogingen: z.number().int().min(1).max(5).default(2),
  employeeIds: z.array(uuid).min(1).max(50),
  gespreksinstructie: z.string().trim().max(4000).nullable().default(null),
});
const actieVelden = {
  eigenaarId: uuid.nullable().optional(), eigenaarExtern: z.string().trim().max(100).optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d, 'Ongeldige datum').nullable().optional(),
};
const resultaatBody = z.object({
  status: z.enum(['belt', 'gesprek', 'gesproken', 'niet_bereikt', 'voicemail', 'mislukt', 'onderbroken']),
  transcript: z.unknown().optional(), twilioSid: z.string().max(100).optional(), fout: z.string().max(500).optional(),
});

const gelijk = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export interface AppDeps {
  db: Db; config: Config; voice: VoiceClient; llm: LlmClient; clientDir?: string;
  /** Zonder client kan er niets naar Jira. */
  jira?: JiraClient;
  /** Laat voice een agent-gesprek alsnog bij ElevenLabs ophalen. */
  herstel?: VoiceHerstel;
  /** Inloggen via Keycloak en het beheren van gebruikers; zonder deze twee werkt alleen de noodlogin. */
  oidc?: Oidc;
  gebruikersbeheer?: KeycloakBeheer;
  /** Start werk dat na het antwoord doorloopt. Standaard fire-and-forget; tests wachten erop. */
  achtergrond?: (taak: Promise<unknown>) => void;
}

export function buildApp({ db, config, voice, llm, clientDir, jira, herstel, oidc, gebruikersbeheer, achtergrond = (t) => void t.catch((e) => log('error', 'achtergrondtaak.mislukt', { foutcode: foutcode(e) })) }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const beperking = new InlogBeperking();
  app.register(cookie);

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ fout: 'Ongeldige invoer', details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ fout: err.message });
    log('error', 'verzoek.mislukt', { foutcode: foutcode(err), pad: req.url.split('?')[0] });
    return reply.code(500).send({ fout: 'Interne fout' });
  });

  app.addHook('onRequest', async (req, reply) => {
    const pad = req.url.split('?')[0];
    if (!pad.startsWith('/api/') || pad === '/api/login' || pad === '/api/auth/start' || pad === '/api/auth/callback' || pad === '/api/health' || pad === '/api/ready' || pad === '/api/me') return;
    if (pad.startsWith('/api/intern/')) {
      const sleutel = String(req.headers['x-service-key'] ?? '');
      if (!config.serviceKey || !gelijk(sleutel, config.serviceKey)) return reply.code(401).send({ fout: 'Niet toegestaan' });
      return;
    }
    const sessie = leesSessie(req.cookies[COOKIE], config.sessionSecret);
    if (!sessie) return reply.code(401).send({ fout: 'Niet ingelogd' });
    if (pad !== '/api/logout' && !magDoen(sessie.rol, req.method, pad)) return reply.code(403).send({ fout: 'Geen toegang met deze rol' });
  });

  // Liveness: het proces draait. Bewust zonder controles, zodat een storing elders het proces niet laat herstarten.
  app.get('/api/health', async () => ({ ok: true }));
  // Readiness: kan deze instantie werk aannemen? Alleen wat de instantie zelf nodig heeft (database, migraties, configuratie).
  // Externe diensten (taalmodel, spraak, Twilio) horen hier niet bij: een storing daar maakt een instantie niet beter door hem te vervangen.
  app.get('/api/ready', async (_req, reply) => {
    const checks: Record<string, 'ok' | 'fout'> = { database: 'fout', migraties: 'fout', configuratie: ontbrekendeInstellingen(config).length ? 'fout' : 'ok' };
    try {
      const gedaan = await Promise.race([
        db.execute(sql`select naam from migraties`) as Promise<unknown>,
        new Promise<never>((_, nee) => setTimeout(() => nee(new Error('time-out')), 2000).unref()),
      ]);
      checks.database = 'ok';
      const namen = new Set(((gedaan as { rows?: { naam: string }[] }).rows ?? []).map((r) => r.naam));
      checks.migraties = migratieNamen().every((n) => namen.has(n)) ? 'ok' : 'fout';
    } catch { /* database of migratietabel niet bereikbaar: blijft 'fout' */ }
    const klaar = Object.values(checks).every((c) => c === 'ok');
    return reply.code(klaar ? 200 : 503).send({ ok: klaar, checks });
  });

  // ── Inloggen ────────────────────────────────────────────────────────────
  const zetSessie = (reply: any, email: string, extra: { naam?: string; rol?: string } = {}) => reply.setCookie(COOKIE, maakSessie(email, config.sessionSecret, Date.now(), extra), {
    httpOnly: true, sameSite: 'strict', secure: config.secureCookies, path: '/', maxAge: 12 * 60 * 60,
  });
  const publiekeUrl = (req: any) => config.publiekeUrl || `${String(req.headers['x-forwarded-proto'] ?? req.protocol).split(',')[0]}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
  const terugNaarInlog = (reply: any, fout: string) => reply.redirect(`/?inlogfout=${fout}`);

  // Noodingang met het vaste beheerdersaccount. Met Keycloak staat die standaard uit (NOODLOGIN=aan zet hem aan).
  app.post('/api/login', async (req, reply) => {
    if (!noodloginAan(config)) return reply.code(404).send({ fout: 'Inloggen met wachtwoord staat uit; gebruik Keycloak' });
    const { email, wachtwoord } = z.object({ email: z.string(), wachtwoord: z.string() }).parse(req.body);
    if (beperking.geblokkeerd(req.ip)) return reply.code(429).send({ fout: 'Te veel pogingen, probeer het later opnieuw' });
    const ok = email.trim().toLowerCase() === config.adminEmail && controleerWachtwoord(wachtwoord, config.adminPasswordHash);
    if (!ok) { beperking.mislukt(req.ip); return reply.code(401).send({ fout: 'E-mailadres of wachtwoord klopt niet' }); }
    if (oidc) log('warn', 'login.noodingang', {});
    zetSessie(reply, config.adminEmail, { naam: 'Beheerder', rol: 'beheerder' });
    return { email: config.adminEmail };
  });

  app.get('/api/auth/start', async (req, reply) => {
    if (!oidc) return reply.code(404).send({ fout: 'Inloggen via Keycloak is niet ingesteld' });
    try {
      const { url, state, nonce, verifier } = await oidc.start(`${publiekeUrl(req)}/api/auth/callback`);
      // Lax, want de browser komt vanaf Keycloak terug op deze site; de sessiecookie zelf blijft Strict.
      reply.setCookie(OIDC_COOKIE, onderteken({ state, nonce, verifier }, config.sessionSecret, 10 * 60_000), {
        httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/api/auth', maxAge: 10 * 60,
      });
      return reply.redirect(url);
    } catch (e) {
      log('error', 'login.start_mislukt', { foutcode: foutcode(e) });
      return terugNaarInlog(reply, 'keycloak');
    }
  });

  app.get('/api/auth/callback', async (req, reply) => {
    if (!oidc) return reply.code(404).send({ fout: 'Inloggen via Keycloak is niet ingesteld' });
    const q = z.object({ code: z.string().max(4000).optional(), state: z.string().max(200).optional(), error: z.string().max(100).optional() }).parse(req.query);
    const eigen = leesOndertekend(req.cookies[OIDC_COOKIE], config.sessionSecret);
    reply.clearCookie(OIDC_COOKIE, { path: '/api/auth' });
    if (q.error || !q.code || !eigen || typeof eigen.state !== 'string' || !q.state || !gelijk(q.state, eigen.state)) return terugNaarInlog(reply, 'ongeldig');
    try {
      const wie = await oidc.afronden({ code: q.code, verifier: String(eigen.verifier), nonce: String(eigen.nonce), redirectUri: `${publiekeUrl(req)}/api/auth/callback` });
      zetSessie(reply, wie.email, { naam: wie.naam, rol: wie.rol });
      log('info', 'login.keycloak', {});
      return reply.redirect('/');
    } catch (e) {
      log('warn', 'login.keycloak_geweigerd', { foutcode: e instanceof OidcFout ? e.code : foutcode(e) });
      return terugNaarInlog(reply, e instanceof OidcFout ? e.code : 'keycloak');
    }
  });

  app.post('/api/logout', async (req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    const eindUrl = oidc && leesSessie(req.cookies[COOKIE], config.sessionSecret) && config.keycloak ? await oidc.uitlogUrl(`${publiekeUrl(req)}/`).catch(() => null) : null;
    return { ok: true, eindUrl };
  });
  app.get('/api/me', async (req) => {
    const sessie = leesSessie(req.cookies[COOKIE], config.sessionSecret);
    const opties = { keycloak: !!oidc, noodlogin: noodloginAan(config), gebruikersbeheer: !!gebruikersbeheer };
    return sessie ? { ingelogd: true, email: sessie.email, naam: sessie.naam ?? sessie.email, rol: normaleRol(sessie.rol), ...opties } : { ingelogd: false, ...opties };
  });

  registreerGebruikers(app, gebruikersbeheer, (req: any) => leesSessie(req.cookies[COOKIE], config.sessionSecret)?.email.toLowerCase() ?? null);

  // ── Medewerkers ─────────────────────────────────────────────────────────
  app.get('/api/employees', async (req) => {
    const rijen = await db.select().from(employees).orderBy(asc(employees.naam));
    // Een accountmanager heeft de namen nodig om een eigenaar te kiezen, geen telefoonnummers of notities.
    if (leesSessie(req.cookies[COOKIE], config.sessionSecret)?.rol !== ACCOUNTMANAGER_ROL) return rijen;
    return rijen.map((m) => ({ id: m.id, naam: m.naam, rol: m.rol, actief: m.actief }));
  });
  // Een geplakte lijst in één keer toevoegen. Met `voorbeeld` gebeurt er niets; zonder worden alleen de nieuwe, geldige regels toegevoegd.
  app.post('/api/employees/import', async (req) => {
    const b = z.object({ tekst: z.string().max(20_000), rol: z.enum(['medewerker', 'accountmanager']), voorbeeld: z.boolean().default(false) }).parse(req.body);
    return db.transaction(async (tx) => {
      // Vergrendelt de tabel tegen een tweede import op hetzelfde moment, zodat een nummer niet dubbel kan ontstaan.
      await tx.execute(sql`lock table employees in share row exclusive mode`);
      const regels = beoordeelLijst(b.tekst, await tx.select({ naam: employees.naam, telefoon: employees.telefoon }).from(employees));
      const nieuw = regels.filter((r) => r.status === 'nieuw');
      if (!b.voorbeeld && nieuw.length) {
        await tx.insert(employees).values(nieuw.map((r) => ({ naam: r.naam, telefoon: r.telefoon, email: r.email, locgovGebruikersnaam: r.locgovGebruikersnaam, rol: b.rol })));
      }
      return { regels, toegevoegd: b.voorbeeld ? 0 : nieuw.length };
    });
  });
  app.post('/api/employees', async (req, reply) => {
    const b = medewerkerBody.parse(req.body);
    const rij = await db.transaction(async (tx) => {
      const [nieuw] = await tx.insert(employees).values({
        naam: b.naam, telefoon: b.telefoon, email: b.email, locgovGebruikersnaam: b.locgovGebruikersnaam, taal: b.taal, actief: b.actief, notitie: b.notitie, rol: b.rol,
      }).returning();
      if (!b.toestemming) return nieuw;
      await leggToestemmingVast(tx, { employeeId: nieuw.id, besluit: 'gegeven', bron: 'beheerder' });
      return (await tx.select().from(employees).where(eq(employees.id, nieuw.id)))[0];
    });
    return reply.code(201).send(rij);
  });
  app.patch('/api/employees/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const b = deelwijziging(medewerkerBody).parse(req.body);
    const { toestemming, ...rest } = b;
    if (!Object.keys(rest).length && toestemming === undefined) return reply.code(400).send({ fout: 'Niets te wijzigen' });
    const rij = await db.transaction(async (tx) => {
      // De rij blijft vergrendeld tot het einde, zodat een samenvatting die tegelijk loopt de toestemming niet halverwege ziet veranderen.
      const [huidig] = await tx.select().from(employees).where(eq(employees.id, id)).for('update');
      if (!huidig) return undefined;
      if (Object.keys(rest).length) await tx.update(employees).set(rest).where(eq(employees.id, id));
      // Alleen een echte verandering komt in het register; het opnieuw aanvinken verandert niets.
      if (toestemming === true && !huidig.toestemmingOp) await leggToestemmingVast(tx, { employeeId: id, besluit: 'gegeven', bron: 'beheerder' });
      if (toestemming === false && huidig.toestemmingOp) await leggToestemmingVast(tx, { employeeId: id, besluit: 'ingetrokken', bron: 'beheerder' });
      return (await tx.select().from(employees).where(eq(employees.id, id)))[0];
    });
    return rij ?? reply.code(404).send({ fout: 'Medewerker niet gevonden' });
  });
  app.delete('/api/employees/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const gewist = await db.delete(employees).where(eq(employees.id, id)).returning({ id: employees.id });
    return gewist.length ? { ok: true } : reply.code(404).send({ fout: 'Medewerker niet gevonden' });
  });

  // ── Projecten ───────────────────────────────────────────────────────────
  app.get('/api/projects', async () => db.select().from(projects).orderBy(asc(projects.naam)));
  app.post('/api/projects', async (req, reply) => reply.code(201).send((await db.insert(projects).values(projectBody.parse(req.body)).returning())[0]));
  app.patch('/api/projects/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const [rij] = await db.update(projects).set(deelwijziging(projectBody).parse(req.body)).where(eq(projects.id, id)).returning();
    return rij ?? reply.code(404).send({ fout: 'Project niet gevonden' });
  });
  app.delete('/api/projects/:id', async (req, reply) => {
    const gewist = await db.delete(projects).where(eq(projects.id, uuid.parse((req.params as any).id))).returning({ id: projects.id });
    return gewist.length ? { ok: true } : reply.code(404).send({ fout: 'Project niet gevonden' });
  });

  // ── Onderwerpen ─────────────────────────────────────────────────────────
  app.get('/api/topics', async (req) => {
    const status = z.enum(['actief', 'wacht', 'afgerond', 'alle']).default('alle').parse((req.query as any).status);
    const lijst = await db.select({
      id: topics.id, titel: topics.titel, type: topics.type, status: topics.status, aanwijzingen: topics.aanwijzingen,
      projectId: topics.projectId, projectNaam: projects.naam, eigenaarId: topics.eigenaarId, eigenaarNaam: employees.naam,
      updatedAt: topics.updatedAt, afgerondOp: topics.afgerondOp,
    }).from(topics).leftJoin(projects, eq(topics.projectId, projects.id)).leftJoin(employees, eq(topics.eigenaarId, employees.id))
      .where(status === 'alle' ? undefined : eq(topics.status, status)).orderBy(desc(topics.updatedAt));
    if (!lijst.length) return [];
    const ids = lijst.map((t) => t.id);
    const laatste = await db.selectDistinctOn([updates.topicId], { topicId: updates.topicId, samenvatting: updates.samenvatting, createdAt: updates.createdAt })
      .from(updates).where(inArray(updates.topicId, ids)).orderBy(updates.topicId, desc(updates.createdAt));
    const open = await db.select({ topicId: activiteiten.topicId, aantal: sql<number>`count(*)::int` }).from(activiteiten)
      .where(and(inArray(activiteiten.topicId, ids), eq(activiteiten.status, 'open'))).groupBy(activiteiten.topicId);
    return lijst.map((t) => ({
      ...t,
      laatsteUpdate: laatste.find((l) => l.topicId === t.id) ?? null,
      openPunten: open.find((o) => o.topicId === t.id)?.aantal ?? 0,
    }));
  });
  app.post('/api/topics', async (req, reply) => {
    const b = topicBody.parse(req.body);
    const [rij] = await db.insert(topics).values({ ...b, afgerondOp: b.status === 'afgerond' ? new Date() : null }).returning();
    return reply.code(201).send(rij);
  });
  app.get('/api/topics/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const [topic] = await db.select().from(topics).where(eq(topics.id, id));
    if (!topic) return reply.code(404).send({ fout: 'Onderwerp niet gevonden' });
    const [lijstUpdates, items] = await Promise.all([
      db.select().from(updates).where(eq(updates.topicId, id)).orderBy(desc(updates.createdAt)),
      db.select().from(activiteiten).where(eq(activiteiten.topicId, id)).orderBy(asc(activiteiten.status), asc(activiteiten.createdAt)),
    ]);
    return { ...topic, updates: lijstUpdates, openItems: items.map((p) => ({ ...p, tekst: p.omschrijving })) };
  });
  app.patch('/api/topics/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const b = deelwijziging(topicBody).parse(req.body);
    const waarden: Record<string, unknown> = { ...b, updatedAt: new Date() };
    if (b.status) waarden.afgerondOp = b.status === 'afgerond' ? new Date() : null;
    const [rij] = await db.update(topics).set(waarden).where(eq(topics.id, id)).returning();
    return rij ?? reply.code(404).send({ fout: 'Onderwerp niet gevonden' });
  });
  app.delete('/api/topics/:id', async (req, reply) => {
    const gewist = await db.delete(topics).where(eq(topics.id, uuid.parse((req.params as any).id))).returning({ id: topics.id });
    return gewist.length ? { ok: true } : reply.code(404).send({ fout: 'Onderwerp niet gevonden' });
  });

  // ── Updates (dagboekregels) ─────────────────────────────────────────────
  app.post('/api/topics/:id/updates', async (req, reply) => {
    const topicId = uuid.parse((req.params as any).id);
    const [topic] = await db.select({ id: topics.id }).from(topics).where(eq(topics.id, topicId));
    if (!topic) return reply.code(404).send({ fout: 'Onderwerp niet gevonden' });
    const [rij] = await db.insert(updates).values({ topicId, bron: 'handmatig', ...updateBody.parse(req.body) }).returning();
    await db.update(topics).set({ updatedAt: new Date() }).where(eq(topics.id, topicId));
    return reply.code(201).send(rij);
  });
  app.patch('/api/updates/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const b = updateBody.parse(req.body);
    const [oud] = await db.select().from(updates).where(eq(updates.id, id));
    if (!oud) return reply.code(404).send({ fout: 'Update niet gevonden' });
    if (oud.samenvatting === b.samenvatting && oud.besluiten === b.besluiten) return oud;
    await db.insert(updateHistorie).values({ updateId: id, vorigeSamenvatting: oud.samenvatting, vorigeBesluiten: oud.besluiten });
    const [rij] = await db.update(updates).set({ ...b, bewerktOp: new Date() }).where(eq(updates.id, id)).returning();
    return rij;
  });
  app.get('/api/updates/:id/historie', async (req) =>
    db.select().from(updateHistorie).where(eq(updateHistorie.updateId, uuid.parse((req.params as any).id))).orderBy(desc(updateHistorie.gewijzigdOp)));
  app.delete('/api/updates/:id', async (req, reply) => {
    const gewist = await db.delete(updates).where(eq(updates.id, uuid.parse((req.params as any).id))).returning({ id: updates.id });
    return gewist.length ? { ok: true } : reply.code(404).send({ fout: 'Update niet gevonden' });
  });

  // ── Suggesties uit gesprekken ───────────────────────────────────────────
  app.get('/api/suggesties', async () => db.select({
    id: suggesties.id, soort: suggesties.soort, tekst: suggesties.tekst, status: suggesties.status, createdAt: suggesties.createdAt,
    employeeId: suggesties.employeeId, employeeNaam: employees.naam, topicId: suggesties.topicId,
  }).from(suggesties).leftJoin(employees, eq(suggesties.employeeId, employees.id)).orderBy(desc(suggesties.createdAt)));
  app.patch('/api/suggesties/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const b = z.object({ status: z.enum(['nieuw', 'afgewezen', 'klaar']) }).parse(req.body);
    const [rij] = await db.update(suggesties).set(b).where(eq(suggesties.id, id)).returning();
    return rij ?? reply.code(404).send({ fout: 'Suggestie niet gevonden' });
  });
  // Een voorgesteld onderwerp wordt pas een onderwerp als de beheerder dat wil; de collega die het voorstelde wordt de eigenaar.
  app.post('/api/suggesties/:id/overnemen', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const [s] = await db.select().from(suggesties).where(eq(suggesties.id, id));
    if (!s) return reply.code(404).send({ fout: 'Suggestie niet gevonden' });
    if (s.soort !== 'onderwerp') return reply.code(409).send({ fout: 'Alleen een voorgesteld onderwerp kan worden overgenomen' });
    if (s.status === 'overgenomen') return reply.code(409).send({ fout: 'Deze suggestie is al overgenomen' });
    const b = z.object({ titel: nonEmpty.max(200).optional() }).parse(req.body ?? {});
    return db.transaction(async (tx) => {
      const [topic] = await tx.insert(topics).values({ titel: b.titel ?? s.tekst.slice(0, 200), eigenaarId: s.employeeId }).returning();
      await tx.update(suggesties).set({ status: 'overgenomen', topicId: topic.id }).where(eq(suggesties.id, id));
      return reply.code(201).send(topic);
    });
  });
  app.get('/api/instellingen/houding', async () => leesHouding(db));
  app.put('/api/instellingen/houding', async (req) => {
    const { waarde } = z.object({ waarde: z.string().max(4000) }).parse(req.body);
    await bewaarHouding(db, waarde);
    return leesHouding(db);
  });
  app.get('/api/instellingen/gespreksmotor', async () => ({ motor: await leesGespreksmotor(db) }));
  app.put('/api/instellingen/gespreksmotor', async (req) => {
    const { motor } = z.object({ motor: z.enum(MOTOREN) }).parse(req.body);
    await bewaarGespreksmotor(db, motor);
    return { motor: await leesGespreksmotor(db) };
  });
  app.get('/api/instellingen/inkomend', async () => ({ aan: await leesInkomend(db) }));
  app.put('/api/instellingen/inkomend', async (req) => {
    const { aan } = z.object({ aan: z.boolean() }).parse(req.body);
    await bewaarInkomend(db, aan);
    return { aan: await leesInkomend(db) };
  });
  // ── Overzicht via de telefoon: beheerrol met codewoord ──────────────────
  app.get('/api/overzicht-toegang', async () => (await db.select({ employeeId: overzichtToegang.employeeId }).from(overzichtToegang)).map((r) => r.employeeId));
  app.put('/api/employees/:id/overzicht', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const { codewoord } = z.object({ codewoord: z.string().min(1).max(60) }).parse(req.body);
    const norm = normaliseerCodewoord(codewoord);
    if (norm.length < 6) return reply.code(400).send({ fout: 'Kies een codewoord van minstens 6 letters of cijfers' });
    const [m] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, id));
    if (!m) return reply.code(404).send({ fout: 'Medewerker niet gevonden' });
    await db.insert(overzichtToegang).values({ employeeId: id, codewoordHash: hashWachtwoord(norm) })
      .onConflictDoUpdate({ target: overzichtToegang.employeeId, set: { codewoordHash: hashWachtwoord(norm), ingesteldOp: new Date() } });
    return { ok: true };
  });
  app.delete('/api/employees/:id/overzicht', async (req) => {
    await db.delete(overzichtToegang).where(eq(overzichtToegang.employeeId, uuid.parse((req.params as any).id)));
    return { ok: true };
  });
  registreerMcp(app, { db, config });
  // ── Jira: open punten als ticket ────────────────────────────────────────
  const jiraStatus = async () => {
    const i = await leesJira(db);
    return { site: i?.site ?? '', project: i?.project ?? '', issuetype: i?.issuetype ?? 'Task', teamId: i?.teamId ?? '', inloggegevens: !!jira?.beschikbaar(), geconfigureerd: !!(i && jira?.beschikbaar()) };
  };
  const jiraFoutAntwoord = (e: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (e instanceof JiraFout) return reply.code(e.status === 401 || e.status === 403 ? 502 : e.status === 429 ? 503 : e.status === 404 ? 422 : e.status).send({ fout: e.message });
    throw e;
  };
  app.get('/api/instellingen/jira', async () => jiraStatus());
  app.put('/api/instellingen/jira', async (req, reply) => {
    const b = z.object({ site: z.string().max(200), project: z.string().trim().toUpperCase().max(10), issuetype: nonEmpty.max(50), teamId: z.string().trim().max(40).default('') }).parse(req.body);
    const site = schoneSite(b.site);
    if (!site) return reply.code(400).send({ fout: 'Gebruik een Jira Cloud-site zoals naam.atlassian.net' });
    if (!geldigProject(b.project)) return reply.code(400).send({ fout: 'Een projectsleutel bestaat uit 2 tot 10 hoofdletters of cijfers, zoals PROJ' });
    if (b.teamId && !geldigTeamId(b.teamId)) return reply.code(400).send({ fout: 'Een team-id ziet eruit als a9249ebd-cccb-4d5e-be27-fc98fdc877be' });
    await bewaarJira(db, { site, project: b.project, issuetype: b.issuetype, ...(b.teamId ? { teamId: b.teamId } : {}) });
    return jiraStatus();
  });
  app.post('/api/instellingen/jira/test', async (_req, reply) => {
    const i = await leesJira(db);
    if (!jira?.beschikbaar()) return reply.code(409).send({ fout: 'JIRA_EMAIL en JIRA_API_TOKEN ontbreken op de web-service' });
    if (!i) return reply.code(409).send({ fout: 'Sla eerst de site, projectsleutel en het issuetype op' });
    try { return { ok: true, ...(await jira.test(i)) }; } catch (e) { return jiraFoutAntwoord(e, reply); }
  });
  // Maakt van open punten tickets. `voorbeeld` laat zien wat er zou gaan zonder iets aan te maken.
  app.post('/api/activiteiten/jira', async (req, reply) => {
    const b = z.object({ ids: z.array(uuid).min(1).max(50), voorbeeld: z.boolean().default(false), controleBevestigd: z.boolean().default(false) }).parse(req.body);
    const i = await leesJira(db);
    if (!i || !jira?.beschikbaar()) return reply.code(409).send({ fout: 'Jira is niet ingesteld (zie Instellingen)' });
    const ids = [...new Set(b.ids)];
    const rijen = await db.select({
      p: activiteiten, topicTitel: topics.titel, eigenaarNaam: employees.naam, eigenaarEmail: employees.email,
    }).from(activiteiten).leftJoin(topics, eq(activiteiten.topicId, topics.id)).leftJoin(employees, eq(activiteiten.eigenaarId, employees.id)).where(inArray(activiteiten.id, ids));
    const perId = new Map(rijen.map((r) => [r.p.id, r]));
    const uitkomst: Record<string, unknown>[] = [];
    for (const id of ids) {
      const r = perId.get(id);
      if (!r) { uitkomst.push({ id, status: 'overgeslagen', reden: 'niet_gevonden' }); continue; }
      const { p } = r;
      if (p.jiraSleutel) { uitkomst.push({ id, status: 'overgeslagen', reden: 'al_in_jira', sleutel: p.jiraSleutel, url: p.jiraUrl }); continue; }
      if (p.status === 'afgerond') { uitkomst.push({ id, status: 'overgeslagen', reden: 'afgerond' }); continue; }
      if (p.controleNodig && !b.controleBevestigd) { uitkomst.push({ id, status: 'overgeslagen', reden: 'controle_nodig' }); continue; }
      const punt: JiraPunt = {
        id, tekst: p.omschrijving, onderwerp: r.topicTitel ?? '', eigenaar: r.eigenaarNaam ?? p.eigenaarExtern, eigenaarEmail: r.eigenaarEmail ?? '',
        deadline: p.deadline, link: config.publiekeUrl ? (p.topicId ? `${config.publiekeUrl}/onderwerp/${p.topicId}` : p.klantId ? `${config.publiekeUrl}/klanten/${p.klantId}` : null) : null,
      };
      if (b.voorbeeld) { uitkomst.push({ id, status: 'voorbeeld', samenvatting: punt.tekst.slice(0, 255), onderwerp: punt.onderwerp, eigenaar: punt.eigenaar || null, deadline: punt.deadline, project: i.project }); continue; }
      try {
        const t = await jira.maakAan(i, punt);
        const [bijgewerkt] = await db.update(activiteiten).set({ jiraSleutel: t.sleutel, jiraUrl: t.url, jiraAangemaaktOp: new Date() })
          .where(and(eq(activiteiten.id, id), sql`${activiteiten.jiraSleutel} is null`)).returning({ id: activiteiten.id });
        log('info', 'jira.ticket', { punt: id, sleutel: t.sleutel, bestondAl: t.bestondAl });
        uitkomst.push({ id, status: bijgewerkt ? (t.bestondAl ? 'gekoppeld' : 'aangemaakt') : 'overgeslagen', sleutel: t.sleutel, url: t.url, ...(bijgewerkt ? {} : { reden: 'al_in_jira' }) });
      } catch (e) {
        if (!(e instanceof JiraFout)) throw e;
        log('warn', 'jira.mislukt', { punt: id, status: e.status });
        uitkomst.push({ id, status: 'fout', reden: e.message });
        // Bij ongeldige inloggegevens of een tijdelijke blokkade heeft doorgaan geen zin.
        if (e.status === 401 || e.status === 403 || e.status === 429) break;
      }
    }
    return { resultaat: uitkomst };
  });

  // Punten die nog gecontroleerd moeten worden tellen niet mee: ze zijn (nog) geen vastgestelde feiten.
  app.get('/api/dashboard', async () => berekenDashboard((await actieRijen(db)).filter((r) => !r.controleNodig), vandaagNL()));

  // ── Planning (terugkerende gesprekken) ──────────────────────────────────
  const planningen = async (alleenId?: string) => {
    const rijen = await db.select().from(schedules).where(alleenId ? eq(schedules.id, alleenId) : undefined).orderBy(asc(schedules.createdAt));
    const leden = rijen.length ? await db.select().from(scheduleEmployees).where(inArray(scheduleEmployees.scheduleId, rijen.map((r) => r.id))) : [];
    return rijen.map((r) => ({ ...r, employeeIds: leden.filter((l) => l.scheduleId === r.id).map((l) => l.employeeId) }));
  };
  const controleerMedewerkers = async (ids: string[]) => {
    const gevonden = await db.select({ id: employees.id }).from(employees).where(inArray(employees.id, ids));
    return gevonden.length === new Set(ids).size;
  };
  app.get('/api/plannings', async () => planningen());
  app.post('/api/plannings', async (req, reply) => {
    const { employeeIds, ...b } = scheduleBody.parse(req.body);
    if (b.gespreksinstructie === '') b.gespreksinstructie = null;
    const ids = [...new Set(employeeIds)];
    if (!(await controleerMedewerkers(ids))) return reply.code(400).send({ fout: 'Onbekende medewerker' });
    const id = await db.transaction(async (tx) => {
      const [rij] = await tx.insert(schedules).values({ ...b, tijden: [...new Set(b.tijden)].sort(), dagen: [...new Set(b.dagen)].sort() }).returning();
      await tx.insert(scheduleEmployees).values(ids.map((employeeId) => ({ scheduleId: rij.id, employeeId })));
      return rij.id;
    });
    return reply.code(201).send((await planningen(id))[0]);
  });
  app.patch('/api/plannings/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const { employeeIds, ...b } = deelwijziging(scheduleBody).parse(req.body);
    if (b.tijden) b.tijden = [...new Set(b.tijden)].sort();
    if (b.dagen) b.dagen = [...new Set(b.dagen)].sort();
    if (b.gespreksinstructie === '') b.gespreksinstructie = null;
    if (!Object.keys(b).length && !employeeIds) return reply.code(400).send({ fout: 'Niets te wijzigen' });
    const ids = employeeIds ? [...new Set(employeeIds)] : undefined;
    if (ids && !(await controleerMedewerkers(ids))) return reply.code(400).send({ fout: 'Onbekende medewerker' });
    const gevonden = await db.transaction(async (tx) => {
      const [bestaat] = await tx.select({ id: schedules.id }).from(schedules).where(eq(schedules.id, id));
      if (!bestaat) return false;
      if (Object.keys(b).length) await tx.update(schedules).set(b).where(eq(schedules.id, id));
      if (ids) {
        await tx.delete(scheduleEmployees).where(eq(scheduleEmployees.scheduleId, id));
        await tx.insert(scheduleEmployees).values(ids.map((employeeId) => ({ scheduleId: id, employeeId })));
      }
      return true;
    });
    return gevonden ? (await planningen(id))[0] : reply.code(404).send({ fout: 'Planning niet gevonden' });
  });
  app.delete('/api/plannings/:id', async (req, reply) => {
    const gewist = await db.delete(schedules).where(eq(schedules.id, uuid.parse((req.params as any).id))).returning({ id: schedules.id });
    return gewist.length ? { ok: true } : reply.code(404).send({ fout: 'Planning niet gevonden' });
  });
  app.get('/api/instellingen/gespreksinstructie', async () => leesInstructie(db));
  app.put('/api/instellingen/gespreksinstructie', async (req) => {
    const { waarde } = z.object({ waarde: z.string().max(4000) }).parse(req.body);
    await bewaarInstructie(db, waarde);
    return leesInstructie(db);
  });
  registreerVerkoop(app, db);
  registreerActiviteiten(app, db);

  // Suggesties voor een instructie. Worden nooit opgeslagen: de beheerder beslist of hij ze overneemt.
  const geefSuggestie = async (reply: any, onderwerpen: OnderwerpVoorSuggestie[], doel: 'planning' | 'onderwerp') => {
    try { return { tekst: await stelInstructieVoor(llm, onderwerpen, doel) }; } catch (e) {
      log('error', 'suggestie.mislukt', { foutcode: foutcode(e) });
      return reply.code(502).send({ fout: 'Een suggestie is nu niet beschikbaar. Probeer het later opnieuw of schrijf de instructie zelf.' });
    }
  };
  app.post('/api/plannings/suggestie', async (req, reply) => {
    const { employeeIds } = z.object({ employeeIds: z.array(uuid).min(1).max(50) }).parse(req.body);
    const rijen = await db.select({ t: topics, projectNaam: projects.naam }).from(topics).leftJoin(projects, eq(topics.projectId, projects.id))
      .where(and(inArray(topics.eigenaarId, employeeIds), eq(topics.status, 'actief'))).orderBy(asc(topics.createdAt));
    if (!rijen.length) return reply.code(400).send({ fout: 'De gekozen personen hebben nog geen actieve onderwerpen om een suggestie van te maken' });
    const vandaag = vandaagNL();
    const onderwerpen: OnderwerpVoorSuggestie[] = [];
    for (const { t, projectNaam } of rijen) {
      const acties = await db.select({ deadline: activiteiten.deadline }).from(activiteiten).where(and(eq(activiteiten.topicId, t.id), eq(activiteiten.status, 'open')));
      const [laatste] = await db.select({ d: updates.createdAt }).from(updates).where(eq(updates.topicId, t.id)).orderBy(desc(updates.createdAt)).limit(1);
      onderwerpen.push({
        titel: t.titel, soort: t.type, project: projectNaam, aanwijzingen: t.aanwijzingen || null, open: acties.length,
        teLaat: acties.filter((a) => a.deadline && a.deadline < vandaag).length, laatsteUpdate: laatste ? laatste.d.toISOString().slice(0, 10) : null,
      });
    }
    return geefSuggestie(reply, onderwerpen, 'planning');
  });
  app.post('/api/topics/suggestie', async (req, reply) => {
    const b = z.object({ titel: nonEmpty.max(200), soort: z.enum(['project', 'thema', 'taak']).default('thema'), projectId: uuid.nullable().optional() }).parse(req.body);
    const [p] = b.projectId ? await db.select({ naam: projects.naam }).from(projects).where(eq(projects.id, b.projectId)) : [];
    return geefSuggestie(reply, [{ titel: b.titel, soort: b.soort, project: p?.naam ?? null }], 'onderwerp');
  });
  app.get('/api/instellingen/automatisch-bellen', async () => ({ aan: await automatischBellenAan(db) }));
  app.put('/api/instellingen/automatisch-bellen', async (req) => {
    const { aan } = z.object({ aan: z.boolean() }).parse(req.body);
    await zetAutomatischBellen(db, aan);
    return { aan };
  });

  // ── Gesprekken ──────────────────────────────────────────────────────────
  app.get('/api/calls', async (req) => {
    const employeeId = (req.query as any).employee ? uuid.parse((req.query as any).employee) : undefined;
    return db.select({
      id: calls.id, status: calls.status, bron: calls.bron, fout: calls.fout, gestartOp: calls.gestartOp, afgerondOp: calls.afgerondOp,
      createdAt: calls.createdAt, employeeId: calls.employeeId, employeeNaam: employees.naam,
      samenvattingStatus: calls.samenvattingStatus, samenvattingFout: calls.samenvattingFout,
      engine: calls.engine, type: calls.type, beoordeling: calls.beoordeling, beoordelingOpmerking: calls.beoordelingOpmerking,
      heeftTranscript: sql<boolean>`${calls.transcript} is not null`, transcriptGewist: sql<boolean>`${calls.transcriptGewistOp} is not null`,
    }).from(calls).innerJoin(employees, eq(calls.employeeId, employees.id))
      .where(employeeId ? eq(calls.employeeId, employeeId) : undefined).orderBy(desc(calls.createdAt)).limit(100);
  });
  app.get('/api/calls/:id', async (req, reply) => {
    const [rij] = await db.select().from(calls).where(eq(calls.id, uuid.parse((req.params as any).id)));
    return rij ?? reply.code(404).send({ fout: 'Gesprek niet gevonden' });
  });

  app.put('/api/calls/:id/beoordeling', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const b = z.object({ beoordeling: z.number().int().min(1).max(5).nullable(), opmerking: z.string().trim().max(1000).default('') }).parse(req.body);
    const [rij] = await db.update(calls).set({ beoordeling: b.beoordeling, beoordelingOpmerking: b.beoordeling === null ? null : b.opmerking }).where(eq(calls.id, id)).returning({ id: calls.id });
    return rij ? { ok: true } : reply.code(404).send({ fout: 'Gesprek niet gevonden' });
  });
  app.post('/api/calls/:id/samenvatten', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const [rij] = await db.select({ status: calls.status, samenvattingStatus: calls.samenvattingStatus }).from(calls).where(eq(calls.id, id));
    if (!rij) return reply.code(404).send({ fout: 'Gesprek niet gevonden' });
    if (rij.status !== 'gesproken') return reply.code(409).send({ fout: 'Alleen een afgerond gesprek kan worden samengevat' });
    if (!['geen', 'mislukt', 'onduidelijk'].includes(rij.samenvattingStatus)) return reply.code(409).send({ fout: `De samenvatting staat op '${rij.samenvattingStatus}' en wordt niet opnieuw gemaakt` });
    return reply.code(202).send(await samenvattenGesprek({ db, llm }, id));
  });

  // Handmatig een agent-gesprek opnieuw bij ElevenLabs laten ophalen; het resultaat komt via de gewone callback (en start de samenvatting).
  app.post('/api/calls/:id/herstel', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const [rij] = await db.select({ engine: calls.engine, status: calls.status, heeftTranscript: sql<boolean>`${calls.transcript} is not null` }).from(calls).where(eq(calls.id, id));
    if (!rij) return reply.code(404).send({ fout: 'Gesprek niet gevonden' });
    if (rij.engine !== 'elevenlabs_agent') return reply.code(409).send({ fout: 'Alleen een gesprek van de ElevenLabs-agent kan opnieuw worden opgehaald' });
    if (rij.heeftTranscript) return reply.code(409).send({ fout: 'Dit gesprek heeft al een transcript' });
    if (!herstel) return reply.code(503).send({ fout: 'De voice-service is niet geconfigureerd' });
    const uitkomst = await vraagHerstel(db, herstel, id);
    if (uitkomst === 'voice_onbereikbaar') return reply.code(502).send({ fout: 'De voice-service is niet bereikbaar' });
    return { uitkomst };
  });

  app.post('/api/employees/:id/bel', async (req, reply) => {
    const { motor } = z.object({ motor: z.enum(MOTOREN).optional() }).parse(req.body ?? {});
    const r = await startGesprek({ db, voice }, uuid.parse((req.params as any).id), undefined, motor);
    if (!r.ok) return reply.code(r.status).send({ fout: r.fout, ...(r.callId ? { callId: r.callId } : {}) });
    return reply.code(202).send({ callId: r.callId, onderwerpen: r.onderwerpen });
  });

  // Het gespreksverloop (codes en tijden, geen inhoud) en wissen op verzoek.
  app.get('/api/calls/:id/verloop', async (req) => {
    const id = uuid.parse((req.params as any).id);
    return db.select({ tijd: callLog.tijd, bron: callLog.bron, gebeurtenis: callLog.gebeurtenis }).from(callLog).where(eq(callLog.callId, id)).orderBy(asc(callLog.tijd));
  });
  app.delete('/api/calls/:id/transcript', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const gewist = await db.update(calls).set({ transcript: null, samenvattingRuw: null, transcriptBewarenTot: null, transcriptGewistOp: new Date() }).where(eq(calls.id, id)).returning({ id: calls.id });
    if (!gewist.length) return reply.code(404).send({ fout: 'Gesprek niet gevonden' });
    await logGebeurtenis(db, id, 'beheer', 'transcript:gewist_op_verzoek');
    return { ok: true };
  });
  // Een gesprek dat niet meer op te halen is (geen transcript, niet gesproken, niet meer onderweg) mag worden verwijderd.
  app.delete('/api/calls/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const [rij] = await db.select({ status: calls.status, createdAt: calls.createdAt, transcriptGewistOp: calls.transcriptGewistOp, heeftTranscript: sql<boolean>`${calls.transcript} is not null` }).from(calls).where(eq(calls.id, id));
    if (!rij) return reply.code(404).send({ fout: 'Gesprek niet gevonden' });
    if (rij.heeftTranscript || rij.status === 'gesproken') return reply.code(409).send({ fout: 'Alleen een gesprek zonder transcript dat niet is gesproken kan worden verwijderd' });
    const onderweg = ['gepland', 'verzenden', 'belt', 'gesprek', 'onderbroken'].includes(rij.status);
    if (onderweg && Date.now() - rij.createdAt.getTime() < 15 * 60_000) return reply.code(409).send({ fout: 'Dit gesprek is mogelijk nog bezig; probeer het over een kwartier opnieuw' });
    await db.delete(calls).where(eq(calls.id, id));
    log('info', 'gesprek.verwijderd', { correlatieId: id });
    return { ok: true };
  });
  app.get('/api/systeem/status', async () => {
    const [hartslag] = await db.select().from(instellingen).where(eq(instellingen.sleutel, 'scheduler_hartslag'));
    const opschoning = await opschoningStatus(db, config.transcriptBewaarDagen);
    const laatsteTik = hartslag ? new Date(hartslag.waarde) : null;
    const planningVerouderd = (await automatischBellenAan(db)) && (!laatsteTik || Date.now() - laatsteTik.getTime() > 2 * 60_000);
    return { opschoning, scheduler: { laatsteTik, verouderd: planningVerouderd }, waarschuwingen: [...opschoning.waarschuwingen, ...(planningVerouderd ? ['De planning heeft de afgelopen 2 minuten niet gedraaid.'] : [])] };
  });

  // De voice-service meldt hier de uitkomst van een opschoonronde: alleen aantallen en een foutcode.
  app.post('/api/intern/opschoning', async (req) => {
    const b = z.object({ gewist: z.number().int().min(0).max(1_000_000), mislukt: z.number().int().min(0).max(1_000_000), foutcode: z.string().max(60).regex(/^[A-Za-z0-9_:.-]*$/).optional() }).parse(req.body);
    await db.insert(opschoningRuns).values({ bron: 'voice', klaarOp: new Date(), status: b.mislukt ? (b.gewist ? 'deels' : 'mislukt') : 'ok', gewist: b.gewist, mislukt: b.mislukt, foutcode: b.foutcode || null });
    return { ok: true };
  });

  // De voice-service vraagt hier de gesprekscontext op als een medewerker zelf belt (alleen met de servicesleutel).
  app.post('/api/intern/inkomend/start', async (req, reply) => {
    const b = z.object({ beller: z.string().max(40), motor: z.enum(MOTOREN).default('elevenlabs_agent') }).parse(req.body);
    if (!(await leesInkomend(db))) return reply.code(403).send({ fout: 'Inkomende gesprekken staan uit' });
    const r = await startInkomendGesprek(db, b.beller, b.motor);
    if (!r.ok) return reply.code(r.reden === 'te_vaak' ? 429 : 404).send({ fout: r.reden });
    return r;
  });

  // De voice-service meldt hier de uitkomst van een gesprek (alleen met de servicesleutel).
  app.post('/api/intern/calls/:id/resultaat', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const b = resultaatBody.parse(req.body);
    const eind = EINDSTATUSSEN.includes(b.status);
    const [bestaand] = await db.select({ id: calls.id }).from(calls).where(eq(calls.id, id));
    if (!bestaand) return reply.code(404).send({ fout: 'Gesprek niet gevonden' });
    // Eén voorwaardelijke UPDATE: een dubbele, te late of omgekeerde melding wordt genegeerd en kan een nieuwere status nooit overschrijven.
    const gewijzigd = await zetStatus(db, id, b.status, {
      twilioSid: b.twilioSid, fout: b.fout, ...(b.transcript !== undefined ? { transcript: b.transcript } : {}),
      ...(eind ? { afgerondOp: new Date() } : {}),
    }, 'voice');
    if (!gewijzigd) return { ok: true, genegeerd: true };
    if (b.transcript !== undefined && b.transcript !== null) await bepaalBewaartermijn(db, config, id, b.status);
    if (b.status === 'gesproken') achtergrond(samenvattenGesprek({ db, llm }, id));
    return { ok: true };
  });

  // ── Frontend (gebouwde SPA) ─────────────────────────────────────────────
  if (clientDir && existsSync(clientDir)) {
    app.register(fastifyStatic, { root: clientDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ fout: 'Niet gevonden' });
      return reply.sendFile('index.html', join(clientDir));
    });
  }
  return app;
}
