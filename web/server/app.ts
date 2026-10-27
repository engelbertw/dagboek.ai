import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { InlogBeperking, controleerWachtwoord, leesSessie, maakSessie } from './auth.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { calls, employees, openItems, projects, schedules, topics, updateHistorie, updates } from './schema.js';
import type { LlmClient } from './llm.js';
import { samenvattenGesprek } from './samenvatten.js';
import type { GespreksOnderwerp } from './schema.js';
import type { Onderwerp, VoiceClient } from './voice.js';

const COOKIE = 'dagboek_sessie';
const uuid = z.string().uuid();
const tijd = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Gebruik HH:MM');
const nonEmpty = z.string().trim().min(1);

const medewerkerBody = z.object({
  naam: nonEmpty.max(100), telefoon: nonEmpty.max(30), email: z.union([z.literal(''), z.string().trim().toLowerCase().email().max(200)]).default(''), taal: z.enum(['nl', 'en']).default('nl'),
  locgovGebruikersnaam: z.union([z.literal(''), z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{1,64}$/)]).default(''),
  actief: z.boolean().default(true), notitie: z.string().max(2000).default(''), toestemming: z.boolean().optional(),
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
  dagen: z.array(z.number().int().min(1).max(7)).min(1).max(7), tijden: z.array(tijd).max(6),
  actief: z.boolean().default(true), maxPogingen: z.number().int().min(1).max(5).default(2),
});
const resultaatBody = z.object({
  status: z.enum(['belt', 'gesprek', 'gesproken', 'niet_bereikt', 'voicemail', 'mislukt']),
  transcript: z.unknown().optional(), twilioSid: z.string().max(100).optional(), fout: z.string().max(500).optional(),
});

const gelijk = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export interface AppDeps {
  db: Db; config: Config; voice: VoiceClient; llm: LlmClient; clientDir?: string;
  /** Start werk dat na het antwoord doorloopt. Standaard fire-and-forget; tests wachten erop. */
  achtergrond?: (taak: Promise<unknown>) => void;
}

export function buildApp({ db, config, voice, llm, clientDir, achtergrond = (t) => void t.catch((e) => console.error('Achtergrondtaak mislukt', e)) }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const beperking = new InlogBeperking();
  app.register(cookie);

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ fout: 'Ongeldige invoer', details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ fout: err.message });
    console.error(err);
    return reply.code(500).send({ fout: 'Interne fout' });
  });

  app.addHook('onRequest', async (req, reply) => {
    const pad = req.url.split('?')[0];
    if (!pad.startsWith('/api/') || pad === '/api/login' || pad === '/api/health' || pad === '/api/me') return;
    if (pad.startsWith('/api/intern/')) {
      const sleutel = String(req.headers['x-service-key'] ?? '');
      if (!config.serviceKey || !gelijk(sleutel, config.serviceKey)) return reply.code(401).send({ fout: 'Niet toegestaan' });
      return;
    }
    if (!leesSessie(req.cookies[COOKIE], config.sessionSecret)) return reply.code(401).send({ fout: 'Niet ingelogd' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  // ── Inloggen ────────────────────────────────────────────────────────────
  app.post('/api/login', async (req, reply) => {
    const { email, wachtwoord } = z.object({ email: z.string(), wachtwoord: z.string() }).parse(req.body);
    if (beperking.geblokkeerd(req.ip)) return reply.code(429).send({ fout: 'Te veel pogingen, probeer het later opnieuw' });
    const ok = email.trim().toLowerCase() === config.adminEmail && controleerWachtwoord(wachtwoord, config.adminPasswordHash);
    if (!ok) { beperking.mislukt(req.ip); return reply.code(401).send({ fout: 'E-mailadres of wachtwoord klopt niet' }); }
    reply.setCookie(COOKIE, maakSessie(config.adminEmail, config.sessionSecret), {
      httpOnly: true, sameSite: 'strict', secure: config.secureCookies, path: '/', maxAge: 12 * 60 * 60,
    });
    return { email: config.adminEmail };
  });
  app.post('/api/logout', async (_req, reply) => { reply.clearCookie(COOKIE, { path: '/' }); return { ok: true }; });
  app.get('/api/me', async (req) => {
    const sessie = leesSessie(req.cookies[COOKIE], config.sessionSecret);
    return sessie ? { ingelogd: true, email: sessie.email } : { ingelogd: false };
  });

  // ── Medewerkers ─────────────────────────────────────────────────────────
  app.get('/api/employees', async () => db.select().from(employees).orderBy(asc(employees.naam)));
  app.post('/api/employees', async (req, reply) => {
    const b = medewerkerBody.parse(req.body);
    const [rij] = await db.insert(employees).values({
      naam: b.naam, telefoon: b.telefoon, email: b.email, locgovGebruikersnaam: b.locgovGebruikersnaam, taal: b.taal, actief: b.actief, notitie: b.notitie, toestemmingOp: b.toestemming ? new Date() : null,
    }).returning();
    return reply.code(201).send(rij);
  });
  app.patch('/api/employees/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const b = medewerkerBody.partial().parse(req.body);
    const { toestemming, ...rest } = b;
    const waarden: Record<string, unknown> = { ...rest };
    if (toestemming !== undefined) waarden.toestemmingOp = toestemming ? new Date() : null;
    if (!Object.keys(waarden).length) return reply.code(400).send({ fout: 'Niets te wijzigen' });
    const [rij] = await db.update(employees).set(waarden).where(eq(employees.id, id)).returning();
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
    const [rij] = await db.update(projects).set(projectBody.partial().parse(req.body)).where(eq(projects.id, id)).returning();
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
    const open = await db.select({ topicId: openItems.topicId, aantal: sql<number>`count(*)::int` }).from(openItems)
      .where(and(inArray(openItems.topicId, ids), eq(openItems.status, 'open'))).groupBy(openItems.topicId);
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
      db.select().from(openItems).where(eq(openItems.topicId, id)).orderBy(asc(openItems.status), asc(openItems.createdAt)),
    ]);
    return { ...topic, updates: lijstUpdates, openItems: items };
  });
  app.patch('/api/topics/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const b = topicBody.partial().parse(req.body);
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

  // ── Open punten ─────────────────────────────────────────────────────────
  app.post('/api/topics/:id/open-items', async (req, reply) => {
    const topicId = uuid.parse((req.params as any).id);
    const { tekst } = z.object({ tekst: nonEmpty.max(500) }).parse(req.body);
    const [topic] = await db.select({ id: topics.id }).from(topics).where(eq(topics.id, topicId));
    if (!topic) return reply.code(404).send({ fout: 'Onderwerp niet gevonden' });
    return reply.code(201).send((await db.insert(openItems).values({ topicId, tekst }).returning())[0]);
  });
  app.patch('/api/open-items/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const b = z.object({ tekst: nonEmpty.max(500), status: z.enum(['open', 'afgerond']) }).partial().parse(req.body);
    const waarden: Record<string, unknown> = { ...b };
    if (b.status) waarden.afgerondOp = b.status === 'afgerond' ? new Date() : null;
    if (!Object.keys(waarden).length) return reply.code(400).send({ fout: 'Niets te wijzigen' });
    const [rij] = await db.update(openItems).set(waarden).where(eq(openItems.id, id)).returning();
    return rij ?? reply.code(404).send({ fout: 'Punt niet gevonden' });
  });
  app.delete('/api/open-items/:id', async (req, reply) => {
    const gewist = await db.delete(openItems).where(eq(openItems.id, uuid.parse((req.params as any).id))).returning({ id: openItems.id });
    return gewist.length ? { ok: true } : reply.code(404).send({ fout: 'Punt niet gevonden' });
  });

  // ── Schema's ────────────────────────────────────────────────────────────
  app.get('/api/employees/:id/schedules', async (req) =>
    db.select().from(schedules).where(eq(schedules.employeeId, uuid.parse((req.params as any).id))).orderBy(asc(schedules.createdAt)));
  app.post('/api/employees/:id/schedules', async (req, reply) => {
    const employeeId = uuid.parse((req.params as any).id);
    const [m] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId));
    if (!m) return reply.code(404).send({ fout: 'Medewerker niet gevonden' });
    const b = scheduleBody.parse(req.body);
    return reply.code(201).send((await db.insert(schedules).values({ ...b, tijden: [...new Set(b.tijden)].sort(), dagen: [...new Set(b.dagen)].sort(), employeeId }).returning())[0]);
  });
  app.patch('/api/schedules/:id', async (req, reply) => {
    const b = scheduleBody.partial().parse(req.body);
    if (b.tijden) b.tijden = [...new Set(b.tijden)].sort();
    if (b.dagen) b.dagen = [...new Set(b.dagen)].sort();
    if (!Object.keys(b).length) return reply.code(400).send({ fout: 'Niets te wijzigen' });
    const [rij] = await db.update(schedules).set(b).where(eq(schedules.id, uuid.parse((req.params as any).id))).returning();
    return rij ?? reply.code(404).send({ fout: 'Schema niet gevonden' });
  });
  app.delete('/api/schedules/:id', async (req, reply) => {
    const gewist = await db.delete(schedules).where(eq(schedules.id, uuid.parse((req.params as any).id))).returning({ id: schedules.id });
    return gewist.length ? { ok: true } : reply.code(404).send({ fout: 'Schema niet gevonden' });
  });

  // ── Gesprekken ──────────────────────────────────────────────────────────
  app.get('/api/calls', async (req) => {
    const employeeId = (req.query as any).employee ? uuid.parse((req.query as any).employee) : undefined;
    return db.select({
      id: calls.id, status: calls.status, bron: calls.bron, fout: calls.fout, gestartOp: calls.gestartOp, afgerondOp: calls.afgerondOp,
      createdAt: calls.createdAt, employeeId: calls.employeeId, employeeNaam: employees.naam,
      samenvattingStatus: calls.samenvattingStatus, samenvattingFout: calls.samenvattingFout,
    }).from(calls).innerJoin(employees, eq(calls.employeeId, employees.id))
      .where(employeeId ? eq(calls.employeeId, employeeId) : undefined).orderBy(desc(calls.createdAt)).limit(100);
  });
  app.get('/api/calls/:id', async (req, reply) => {
    const [rij] = await db.select().from(calls).where(eq(calls.id, uuid.parse((req.params as any).id)));
    return rij ?? reply.code(404).send({ fout: 'Gesprek niet gevonden' });
  });

  app.post('/api/calls/:id/samenvatten', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const [rij] = await db.select({ status: calls.status, samenvattingStatus: calls.samenvattingStatus }).from(calls).where(eq(calls.id, id));
    if (!rij) return reply.code(404).send({ fout: 'Gesprek niet gevonden' });
    if (rij.status !== 'gesproken') return reply.code(409).send({ fout: 'Alleen een afgerond gesprek kan worden samengevat' });
    if (!['geen', 'mislukt', 'onduidelijk'].includes(rij.samenvattingStatus)) return reply.code(409).send({ fout: `De samenvatting staat op '${rij.samenvattingStatus}' en wordt niet opnieuw gemaakt` });
    return reply.code(202).send(await samenvattenGesprek({ db, llm }, id));
  });

  app.post('/api/employees/:id/bel', async (req, reply) => {
    const employeeId = uuid.parse((req.params as any).id);
    const [m] = await db.select().from(employees).where(eq(employees.id, employeeId));
    if (!m) return reply.code(404).send({ fout: 'Medewerker niet gevonden' });
    if (!m.actief) return reply.code(409).send({ fout: 'Deze medewerker is niet actief' });
    const mijnTopics = await db.select({ t: topics, projectNaam: projects.naam }).from(topics)
      .leftJoin(projects, eq(topics.projectId, projects.id)).where(and(eq(topics.eigenaarId, employeeId), eq(topics.status, 'actief'))).orderBy(asc(topics.createdAt));
    const onderwerpen: Onderwerp[] = [];
    const momentopname: GespreksOnderwerp[] = [];
    for (const { t, projectNaam } of mijnTopics) {
      const [laatste] = await db.select().from(updates).where(eq(updates.topicId, t.id)).orderBy(desc(updates.createdAt)).limit(1);
      const open = await db.select({ id: openItems.id, tekst: openItems.tekst }).from(openItems).where(and(eq(openItems.topicId, t.id), eq(openItems.status, 'open'))).orderBy(asc(openItems.createdAt));
      onderwerpen.push({
        titel: t.titel, project: projectNaam ?? undefined, aanwijzingen: t.aanwijzingen || undefined,
        laatste_update: laatste?.samenvatting, laatste_update_datum: laatste?.createdAt.toISOString().slice(0, 10), open_punten: open.map((o) => o.tekst),
      });
      momentopname.push({ id: t.id, titel: t.titel, openPunten: open });
    }
    const [call] = await db.insert(calls).values({ employeeId, status: 'gepland', bron: 'handmatig', onderwerpen: momentopname }).returning();
    const resultaat = await voice({
      telefoonnummer: m.telefoon, medewerker: m.naam, onderwerpen, toestemming_nodig: !m.toestemmingOp, web_call_id: call.id,
    });
    if (!resultaat.gebeld) {
      await db.update(calls).set({ status: 'mislukt', fout: resultaat.reden, afgerondOp: new Date() }).where(eq(calls.id, call.id));
      return reply.code(502).send({ fout: resultaat.reden, callId: call.id });
    }
    await db.update(calls).set({ status: 'belt', voiceCallId: resultaat.call_id, gestartOp: new Date() }).where(eq(calls.id, call.id));
    return reply.code(202).send({ callId: call.id, onderwerpen: onderwerpen.length });
  });

  // De voice-service meldt hier de uitkomst van een gesprek (alleen met de servicesleutel).
  app.post('/api/intern/calls/:id/resultaat', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const b = resultaatBody.parse(req.body);
    const eind = ['gesproken', 'niet_bereikt', 'voicemail', 'mislukt'].includes(b.status);
    const [bestaand] = await db.select({ status: calls.status }).from(calls).where(eq(calls.id, id));
    if (!bestaand) return reply.code(404).send({ fout: 'Gesprek niet gevonden' });
    // Een eindstatus wordt niet meer overschreven door een late, tragere melding.
    if (['gesproken', 'niet_bereikt', 'voicemail', 'mislukt'].includes(bestaand.status) && !(b.status === 'gesproken' && bestaand.status !== 'gesproken')) return { ok: true, genegeerd: true };
    await db.update(calls).set({
      status: b.status, twilioSid: b.twilioSid, fout: b.fout, ...(b.transcript !== undefined ? { transcript: b.transcript } : {}),
      ...(eind ? { afgerondOp: new Date() } : {}),
    }).where(eq(calls.id, id));
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
