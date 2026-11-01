/**
 * Implementaties: de levenscyclus van een module-implementatie bij een gemeente, bovenop een onderwerp (topics). Alleen voor beheerders.
 * Een gesprek werkt fase, teststatus en geplande livegang bij (consultant-implementatie.ts); werkelijke livegang, acceptatie en einde nazorg
 * komen als voorstel uit een debrief en worden pas overgenomen als een beheerder dat hier bevestigt.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.js';
import { consultantDebriefs, implementaties, IMPLEMENTATIE_FASEN, klanten, klantContacten, TEST_STATUSSEN, topics } from './schema.js';

const uuid = z.string().uuid();
const datum = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d, 'Ongeldige datum');

const body = z.object({
  module: z.string().trim().min(1).max(100),
  fase: z.enum(IMPLEMENTATIE_FASEN).default('voorbereiding'),
  testStatus: z.enum(TEST_STATUSSEN).default('niet_gestart'),
  geplandeLivegang: datum.nullable().default(null),
  werkelijkeLivegang: datum.nullable().default(null),
  acceptatieOp: datum.nullable().default(null),
  acceptatieCitaat: z.string().trim().max(300).default(''),
  nazorgTot: datum.nullable().default(null),
  bovenliggendTopicId: uuid.nullable().default(null),
  contactpersoonId: uuid.nullable().default(null),
});

export type Voorstel = { veld: 'werkelijkeLivegang' | 'acceptatieOp' | 'nazorgTot'; waarde: string; citaat: string; debriefId: string; datum: string };
const VOORSTEL_VELDEN = [
  { veld: 'werkelijkeLivegang', sleutel: 'werkelijke_livegang', citaat: 'werkelijke_livegang_citaat' },
  { veld: 'acceptatieOp', sleutel: 'acceptatie_op', citaat: 'acceptatie_citaat' },
  { veld: 'nazorgTot', sleutel: 'nazorg_tot', citaat: 'nazorg_citaat' },
] as const;

/** De nieuwste bewezen voorstellen uit de debriefs van dit onderwerp, voor zover ze afwijken van wat er nu staat. */
export async function voorstellenVoor(db: Db, topicId: string, huidig: Record<string, string | null> | null): Promise<Voorstel[]> {
  const rijen = await db.select({ id: consultantDebriefs.id, variantdata: consultantDebriefs.variantdata, createdAt: consultantDebriefs.createdAt }).from(consultantDebriefs)
    .where(and(eq(consultantDebriefs.topicId, topicId), eq(consultantDebriefs.variant, 'implementatie'), eq(consultantDebriefs.controleNodig, false))).orderBy(desc(consultantDebriefs.createdAt)).limit(10);
  const uit: Voorstel[] = [];
  for (const v of VOORSTEL_VELDEN) {
    for (const r of rijen) {
      const data = r.variantdata as Record<string, unknown>;
      const waarde = data[v.sleutel];
      if (typeof waarde !== 'string' || !waarde) continue;
      if (waarde !== (huidig?.[v.veld] ?? null)) uit.push({ veld: v.veld, waarde, citaat: String(data[v.citaat] ?? ''), debriefId: r.id, datum: r.createdAt.toISOString() });
      break;
    }
  }
  return uit;
}

export function registreerImplementaties(app: FastifyInstance, db: Db) {
  app.get('/api/implementaties', async () => (await db.select({
    topicId: implementaties.topicId, titel: topics.titel, status: topics.status, klantId: topics.klantId, klantNaam: klanten.naam, module: implementaties.module,
    fase: implementaties.fase, testStatus: implementaties.testStatus, geplandeLivegang: implementaties.geplandeLivegang, werkelijkeLivegang: implementaties.werkelijkeLivegang,
  }).from(implementaties).innerJoin(topics, eq(implementaties.topicId, topics.id)).leftJoin(klanten, eq(topics.klantId, klanten.id)).orderBy(desc(topics.updatedAt))));

  app.get('/api/implementaties/:topicId', async (req, reply) => {
    const topicId = uuid.safeParse((req.params as { topicId: string }).topicId);
    if (!topicId.success) return reply.code(404).send({ fout: 'Onderwerp niet gevonden' });
    const [topic] = await db.select({ id: topics.id }).from(topics).where(eq(topics.id, topicId.data));
    if (!topic) return reply.code(404).send({ fout: 'Onderwerp niet gevonden' });
    const [rij] = await db.select().from(implementaties).where(eq(implementaties.topicId, topicId.data));
    return { implementatie: rij ?? null, voorstellen: rij ? await voorstellenVoor(db, topicId.data, rij as unknown as Record<string, string | null>) : [] };
  });

  app.put('/api/implementaties/:topicId', async (req, reply) => {
    const topicId = uuid.safeParse((req.params as { topicId: string }).topicId);
    if (!topicId.success) return reply.code(404).send({ fout: 'Onderwerp niet gevonden' });
    const b = body.parse(req.body);
    const [topic] = await db.select({ id: topics.id, klantId: topics.klantId }).from(topics).where(eq(topics.id, topicId.data));
    if (!topic) return reply.code(404).send({ fout: 'Onderwerp niet gevonden' });
    // Alles bij één implementatie hoort bij dezelfde gemeente als het onderwerp.
    if (b.bovenliggendTopicId) {
      const [boven] = await db.select({ id: topics.id, klantId: topics.klantId }).from(topics).where(eq(topics.id, b.bovenliggendTopicId));
      if (!boven || boven.id === topic.id) return reply.code(400).send({ fout: 'Bovenliggend project niet gevonden' });
      if (!topic.klantId || boven.klantId !== topic.klantId) return reply.code(400).send({ fout: 'Het bovenliggende project hoort niet bij dezelfde gemeente' });
    }
    if (b.contactpersoonId) {
      const [c] = await db.select({ klantId: klantContacten.klantId }).from(klantContacten).where(eq(klantContacten.id, b.contactpersoonId));
      if (!c || !topic.klantId || c.klantId !== topic.klantId) return reply.code(400).send({ fout: 'De contactpersoon hoort niet bij dezelfde gemeente' });
    }
    const waarden = { ...b, bijgewerktOp: new Date() };
    const [rij] = await db.insert(implementaties).values({ topicId: topic.id, ...waarden }).onConflictDoUpdate({ target: implementaties.topicId, set: waarden }).returning();
    return { implementatie: rij, voorstellen: await voorstellenVoor(db, topic.id, rij as unknown as Record<string, string | null>) };
  });

  // Haalt alleen de markering weg: het onderwerp en zijn dagboek, punten en debriefs blijven bestaan.
  app.delete('/api/implementaties/:topicId', async (req, reply) => {
    const topicId = uuid.safeParse((req.params as { topicId: string }).topicId);
    if (!topicId.success) return reply.code(404).send({ fout: 'Implementatie niet gevonden' });
    const gewist = await db.delete(implementaties).where(eq(implementaties.topicId, topicId.data)).returning({ id: implementaties.topicId });
    return gewist.length ? { ok: true } : reply.code(404).send({ fout: 'Implementatie niet gevonden' });
  });
}
