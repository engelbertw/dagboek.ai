/**
 * Eén register voor alles wat gedaan of bijgehouden moet worden: acties, afspraken, interne acties, kansen, risico's, doelen en resultaten.
 * Een punt hoort bij een klant, bij een onderwerp uit het dagboek, bij allebei of bij geen van beide.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ActieRij } from './dashboard.js';
import type { Db } from './db.js';
import { activiteiten, employees, klanten, topics } from './schema.js';

const uuid = z.string().uuid();
const nonEmpty = z.string().trim().min(1);
const datum = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d, 'Ongeldige datum');

/** Soorten waar iemand iets mee moet doen; alleen deze tellen mee in het dashboard. */
export const ACTIE_SOORTEN = ['actie', 'afspraak', 'intern'] as const;

const kolommen = {
  id: activiteiten.id, soort: activiteiten.soort, omschrijving: activiteiten.omschrijving, status: activiteiten.status, bron: activiteiten.bron,
  klantId: activiteiten.klantId, klantNaam: klanten.naam, klantStatus: klanten.status, topicId: activiteiten.topicId, topicTitel: topics.titel,
  eigenaarId: activiteiten.eigenaarId, eigenaarNaam: employees.naam, eigenaarExtern: activiteiten.eigenaarExtern,
  deadline: activiteiten.deadline, deadlineOorspronkelijk: activiteiten.deadlineOorspronkelijk, deadlineGewijzigdAantal: activiteiten.deadlineGewijzigdAantal,
  details: activiteiten.details, citaat: activiteiten.citaat, jiraSleutel: activiteiten.jiraSleutel, jiraUrl: activiteiten.jiraUrl,
  controleNodig: activiteiten.controleNodig, controleReden: activiteiten.controleReden, callId: activiteiten.callId,
  createdAt: activiteiten.createdAt, afgerondOp: activiteiten.afgerondOp,
};

/** Alle punten, open eerst en dan op deadline. Het filteren gebeurt aan de clientkant. */
export const lijstActiviteiten = (db: Db, filter: { klantId?: string; topicId?: string } = {}) => db.select(kolommen).from(activiteiten)
  .leftJoin(klanten, eq(activiteiten.klantId, klanten.id)).leftJoin(topics, eq(activiteiten.topicId, topics.id)).leftJoin(employees, eq(activiteiten.eigenaarId, employees.id))
  .where(and(filter.klantId ? eq(activiteiten.klantId, filter.klantId) : undefined, filter.topicId ? eq(activiteiten.topicId, filter.topicId) : undefined))
  .orderBy(asc(activiteiten.status), sql`${activiteiten.deadline} asc nulls last`, desc(activiteiten.createdAt));

/** De rijen voor het dashboard: alleen wat iemand moet doen. */
export const actieRijen = async (db: Db): Promise<ActieRij[]> => (await db.select(kolommen).from(activiteiten)
  .leftJoin(klanten, eq(activiteiten.klantId, klanten.id)).leftJoin(topics, eq(activiteiten.topicId, topics.id)).leftJoin(employees, eq(activiteiten.eigenaarId, employees.id))
  .where(inArray(activiteiten.soort, [...ACTIE_SOORTEN])))
  .map((r) => ({ ...r, tekst: r.omschrijving }));

const velden = {
  omschrijving: nonEmpty.max(500), soort: z.enum(['doel', 'resultaat', 'afspraak', 'actie', 'kans', 'risico', 'intern']),
  klantId: uuid.nullable(), topicId: uuid.nullable(), eigenaarId: uuid.nullable(), eigenaarExtern: z.string().trim().max(100), deadline: datum.nullable(),
};

export function registreerActiviteiten(app: FastifyInstance, db: Db) {
  app.get('/api/activiteiten', async (req) => {
    const q = z.object({ klantId: uuid.optional(), topicId: uuid.optional() }).parse(req.query);
    return lijstActiviteiten(db, q);
  });

  // Handmatig toevoegen: een punt zonder klant en zonder onderwerp is toegestaan. Zonder eigenaar krijgt het de eigenaar van het onderwerp.
  app.post('/api/activiteiten', async (req, reply) => {
    const b = z.object({ ...velden, soort: velden.soort.default('intern') }).partial({ klantId: true, topicId: true, eigenaarId: true, eigenaarExtern: true, deadline: true }).parse(req.body);
    let eigenaarId = b.eigenaarId;
    if (b.klantId) {
      const [klant] = await db.select({ id: klanten.id }).from(klanten).where(eq(klanten.id, b.klantId));
      if (!klant) return reply.code(404).send({ fout: 'Klant niet gevonden' });
    }
    if (b.topicId) {
      const [topic] = await db.select({ id: topics.id, eigenaarId: topics.eigenaarId, klantId: topics.klantId }).from(topics).where(eq(topics.id, b.topicId));
      if (!topic) return reply.code(404).send({ fout: 'Onderwerp niet gevonden' });
      if (eigenaarId === undefined) eigenaarId = topic.eigenaarId;
      if (b.klantId === undefined) b.klantId = topic.klantId;
    }
    const [rij] = await db.insert(activiteiten).values({
      soort: b.soort, omschrijving: b.omschrijving, klantId: b.klantId ?? null, topicId: b.topicId ?? null, eigenaarId: eigenaarId ?? null,
      eigenaarExtern: b.eigenaarExtern ?? '', deadline: b.deadline ?? null, deadlineOorspronkelijk: b.deadline ?? null, bron: 'handmatig',
    }).returning();
    return reply.code(201).send(rij);
  });

  app.patch('/api/activiteiten/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const b = z.object({ ...velden, status: z.enum(['open', 'afgerond']), details: z.record(z.string(), z.unknown()) }).partial().parse(req.body);
    const waarden: Record<string, unknown> = { ...b };
    if (b.status) waarden.afgerondOp = b.status === 'afgerond' ? new Date() : null;
    if (!Object.keys(waarden).length) return reply.code(400).send({ fout: 'Niets te wijzigen' });
    const rij = await db.transaction(async (tx) => {
      const [huidig] = await tx.select({ deadline: activiteiten.deadline, oorspronkelijk: activiteiten.deadlineOorspronkelijk }).from(activiteiten).where(eq(activiteiten.id, id)).for('update');
      if (!huidig) return undefined;
      // Een verschoven of verwijderde deadline wordt bijgehouden; het eerste instellen telt niet als wijziging.
      if (b.deadline !== undefined && (b.deadline ?? null) !== huidig.deadline) {
        if (huidig.deadline) waarden.deadlineGewijzigdAantal = sql`${activiteiten.deadlineGewijzigdAantal} + 1`;
        if (!huidig.oorspronkelijk) waarden.deadlineOorspronkelijk = huidig.deadline ?? b.deadline ?? null;
      }
      return (await tx.update(activiteiten).set(waarden).where(eq(activiteiten.id, id)).returning())[0];
    });
    return rij ?? reply.code(404).send({ fout: 'Punt niet gevonden' });
  });

  // Een punt dat niet te onderbouwen was wacht op een besluit: goedkeuren houdt het, afwijzen verwijdert het.
  app.post('/api/activiteiten/:id/controle', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const { besluit } = z.object({ besluit: z.enum(['goedkeuren', 'afwijzen']) }).parse(req.body);
    const [punt] = await db.select().from(activiteiten).where(eq(activiteiten.id, id));
    if (!punt) return reply.code(404).send({ fout: 'Punt niet gevonden' });
    if (!punt.controleNodig) return reply.code(409).send({ fout: 'Dit punt hoeft niet gecontroleerd te worden' });
    // Een bestaand punt dat mogelijk is afgerond: goedkeuren sluit het, afwijzen houdt het open. Het wordt nooit verwijderd.
    if (punt.controleReden === 'mogelijk_afgerond') {
      const [rij] = await db.update(activiteiten).set({
        controleNodig: false, controleReden: null, ...(besluit === 'goedkeuren' ? { status: 'afgerond' as const, afgerondOp: new Date() } : {}),
      }).where(eq(activiteiten.id, id)).returning();
      return rij;
    }
    if (besluit === 'afwijzen') {
      await db.delete(activiteiten).where(eq(activiteiten.id, id));
      return { ok: true, verwijderd: true };
    }
    const [rij] = await db.update(activiteiten).set({ controleNodig: false, controleReden: null }).where(eq(activiteiten.id, id)).returning();
    return rij;
  });

  app.delete('/api/activiteiten/:id', async (req, reply) => {
    const gewist = await db.delete(activiteiten).where(eq(activiteiten.id, uuid.parse((req.params as any).id))).returning({ id: activiteiten.id });
    return gewist.length ? { ok: true } : reply.code(404).send({ fout: 'Punt niet gevonden' });
  });
}
