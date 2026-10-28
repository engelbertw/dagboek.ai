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
import { calls, employees, openItems, projects, scheduleEmployees, schedules, suggesties, topics, updateHistorie, updates } from './schema.js';
import type { LlmClient } from './llm.js';
import { startGesprek } from './gesprek-starten.js';
import { EINDSTATUSSEN, zetStatus } from './gesprek-status.js';
import { bewaarHouding, bewaarInstructie, leesHouding, leesInstructie } from './instellingen.js';
import { stelInstructieVoor, type OnderwerpVoorSuggestie } from './suggestie.js';
import { automatischBellenAan, zetAutomatischBellen } from './scheduler.js';
import { berekenDashboard, type ActieRij } from './dashboard.js';
import { samenvattenGesprek, vandaagNL } from './samenvatten.js';
import { bepaalBewaartermijn, leggToestemmingVast } from './toestemming.js';
import type { GespreksOnderwerp } from './schema.js';
import type { Onderwerp, VoiceClient } from './voice.js';

const COOKIE = 'dagboek_sessie';
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
    const rij = await db.transaction(async (tx) => {
      const [nieuw] = await tx.insert(employees).values({
        naam: b.naam, telefoon: b.telefoon, email: b.email, locgovGebruikersnaam: b.locgovGebruikersnaam, taal: b.taal, actief: b.actief, notitie: b.notitie,
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

  // ── Open punten ─────────────────────────────────────────────────────────
  app.post('/api/topics/:id/open-items', async (req, reply) => {
    const topicId = uuid.parse((req.params as any).id);
    const b = z.object({ tekst: nonEmpty.max(500), ...actieVelden }).parse(req.body);
    const [topic] = await db.select({ id: topics.id, eigenaarId: topics.eigenaarId }).from(topics).where(eq(topics.id, topicId));
    if (!topic) return reply.code(404).send({ fout: 'Onderwerp niet gevonden' });
    const eigenaarId = b.eigenaarId === undefined ? topic.eigenaarId : b.eigenaarId;
    return reply.code(201).send((await db.insert(openItems).values({ topicId, tekst: b.tekst, eigenaarId, eigenaarExtern: b.eigenaarExtern ?? '', deadline: b.deadline ?? null, deadlineOorspronkelijk: b.deadline ?? null }).returning())[0]);
  });
  app.patch('/api/open-items/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const b = z.object({ tekst: nonEmpty.max(500), status: z.enum(['open', 'afgerond']), ...actieVelden }).partial().parse(req.body);
    const waarden: Record<string, unknown> = { ...b };
    if (b.status) waarden.afgerondOp = b.status === 'afgerond' ? new Date() : null;
    if (!Object.keys(waarden).length) return reply.code(400).send({ fout: 'Niets te wijzigen' });
    const rij = await db.transaction(async (tx) => {
      const [huidig] = await tx.select({ deadline: openItems.deadline, oorspronkelijk: openItems.deadlineOorspronkelijk }).from(openItems).where(eq(openItems.id, id)).for('update');
      if (!huidig) return undefined;
      // Een verschoven of verwijderde deadline wordt bijgehouden; het eerste instellen telt niet als wijziging.
      if (b.deadline !== undefined && (b.deadline ?? null) !== huidig.deadline) {
        if (huidig.deadline) waarden.deadlineGewijzigdAantal = sql`${openItems.deadlineGewijzigdAantal} + 1`;
        if (!huidig.oorspronkelijk) waarden.deadlineOorspronkelijk = huidig.deadline ?? b.deadline ?? null;
      }
      return (await tx.update(openItems).set(waarden).where(eq(openItems.id, id)).returning())[0];
    });
    return rij ?? reply.code(404).send({ fout: 'Punt niet gevonden' });
  });
  // Een actie die het taalmodel heeft voorgesteld maar die niet te onderbouwen was, wacht op een besluit van de beheerder.
  app.post('/api/open-items/:id/controle', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const { besluit } = z.object({ besluit: z.enum(['goedkeuren', 'afwijzen']) }).parse(req.body);
    const [punt] = await db.select().from(openItems).where(eq(openItems.id, id));
    if (!punt) return reply.code(404).send({ fout: 'Punt niet gevonden' });
    if (!punt.controleNodig) return reply.code(409).send({ fout: 'Dit punt hoeft niet gecontroleerd te worden' });
    const afrondingVoorgesteld = punt.controleReden === 'mogelijk_afgerond';
    if (besluit === 'afwijzen' && !afrondingVoorgesteld) {
      await db.delete(openItems).where(eq(openItems.id, id));
      return { ok: true, verwijderd: true };
    }
    const sluit = besluit === 'goedkeuren' && afrondingVoorgesteld;
    const [rij] = await db.update(openItems).set({ controleNodig: false, controleReden: null, ...(sluit ? { status: 'afgerond' as const, afgerondOp: new Date() } : {}) }).where(eq(openItems.id, id)).returning();
    return rij;
  });
  const actieRijen = async (): Promise<ActieRij[]> => (await db.select({
    id: openItems.id, tekst: openItems.tekst, topicId: openItems.topicId, topicTitel: topics.titel,
    eigenaarId: openItems.eigenaarId, eigenaarNaam: employees.naam, eigenaarExtern: openItems.eigenaarExtern,
    deadline: openItems.deadline, status: openItems.status, createdAt: openItems.createdAt, afgerondOp: openItems.afgerondOp,
    controleNodig: openItems.controleNodig, controleReden: openItems.controleReden, deadlineOorspronkelijk: openItems.deadlineOorspronkelijk, deadlineGewijzigdAantal: openItems.deadlineGewijzigdAantal,
  }).from(openItems).innerJoin(topics, eq(openItems.topicId, topics.id)).leftJoin(employees, eq(openItems.eigenaarId, employees.id))
    .orderBy(asc(openItems.status), sql`${openItems.deadline} asc nulls last`, asc(openItems.createdAt)));
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
  app.get('/api/acties', async () => actieRijen());
  // Punten die nog gecontroleerd moeten worden tellen niet mee: ze zijn (nog) geen vastgestelde feiten.
  app.get('/api/dashboard', async () => berekenDashboard((await actieRijen()).filter((r) => !r.controleNodig), vandaagNL()));

  app.delete('/api/open-items/:id', async (req, reply) => {
    const gewist = await db.delete(openItems).where(eq(openItems.id, uuid.parse((req.params as any).id))).returning({ id: openItems.id });
    return gewist.length ? { ok: true } : reply.code(404).send({ fout: 'Punt niet gevonden' });
  });

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

  // Suggesties voor een instructie. Worden nooit opgeslagen: de beheerder beslist of hij ze overneemt.
  const geefSuggestie = async (reply: any, onderwerpen: OnderwerpVoorSuggestie[], doel: 'planning' | 'onderwerp') => {
    try { return { tekst: await stelInstructieVoor(llm, onderwerpen, doel) }; } catch (e) {
      console.error('Suggestie mislukt:', (e as Error).message);
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
      const acties = await db.select({ deadline: openItems.deadline }).from(openItems).where(and(eq(openItems.topicId, t.id), eq(openItems.status, 'open')));
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
    const r = await startGesprek({ db, voice }, uuid.parse((req.params as any).id));
    if (!r.ok) return reply.code(r.status).send({ fout: r.fout, ...(r.callId ? { callId: r.callId } : {}) });
    return reply.code(202).send({ callId: r.callId, onderwerpen: r.onderwerpen });
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
    });
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
