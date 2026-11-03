/** Businessunits (beheer) en het profiel (functie + businessunit) van gebruikers en medewerkers, gekoppeld via het e-mailadres. */
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.js';
import { businessUnits, employees, gebruikersprofielen } from './schema.js';

const unitBody = z.object({
  naam: z.string().trim().min(1).max(100), afkorting: z.string().trim().min(1).max(20),
  volgorde: z.number().int().min(0).max(999).default(100), actief: z.boolean().default(true),
});

const unitWijziging = z.object({
  naam: z.string().trim().min(1).max(100).optional(), afkorting: z.string().trim().min(1).max(20).optional(),
  volgorde: z.number().int().min(0).max(999).optional(), actief: z.boolean().optional(),
});

export const profielBody = z.object({
  functie: z.string().trim().max(100).default(''),
  businessUnitId: z.string().uuid().nullable().default(null),
});
export type Profiel = z.infer<typeof profielBody>;

/** Een businessunit moet bestaan voordat je hem aan iemand koppelt. */
export async function unitBestaat(db: Db, id: string | null | undefined): Promise<boolean> {
  if (!id) return true;
  return (await db.select({ id: businessUnits.id }).from(businessUnits).where(eq(businessUnits.id, id))).length > 0;
}

const sleutel = (email: string) => email.trim().toLowerCase();

/** Het profiel per e-mailadres: eigen profiel eerst, anders de gegevens van de medewerker met hetzelfde adres. */
export async function leesProfielen(db: Db): Promise<Map<string, Profiel>> {
  const kaart = new Map<string, Profiel>();
  for (const m of await db.select({ email: employees.email, functie: employees.functie, businessUnitId: employees.businessUnitId }).from(employees)) {
    if (sleutel(m.email) && (m.functie || m.businessUnitId)) kaart.set(sleutel(m.email), { functie: m.functie, businessUnitId: m.businessUnitId });
  }
  for (const p of await db.select().from(gebruikersprofielen)) kaart.set(p.email, { functie: p.functie, businessUnitId: p.businessUnitId });
  return kaart;
}

/** Bewaart het profiel van een gebruiker en werkt de medewerker met hetzelfde e-mailadres bij, zodat beide schermen hetzelfde tonen. */
export async function bewaarProfiel(db: Db, email: string, p: Profiel): Promise<void> {
  const e = sleutel(email);
  if (!e) return;
  await db.insert(gebruikersprofielen).values({ email: e, ...p }).onConflictDoUpdate({ target: gebruikersprofielen.email, set: { ...p, bijgewerktOp: new Date() } });
  await db.update(employees).set(p).where(sql`lower(${employees.email}) = ${e}`);
}

/** Na het wijzigen van een medewerker: bestaat er een gebruikersprofiel met hetzelfde e-mailadres, dan blijft dat gelijk. */
export async function synchroniseerNaarProfiel(db: Db, email: string, p: Profiel): Promise<void> {
  const e = sleutel(email);
  if (!e) return;
  await db.update(gebruikersprofielen).set({ ...p, bijgewerktOp: new Date() }).where(eq(gebruikersprofielen.email, e));
}

export async function wisProfiel(db: Db, email: string): Promise<void> {
  await db.delete(gebruikersprofielen).where(eq(gebruikersprofielen.email, sleutel(email)));
}

export function registreerBusinessunits(app: FastifyInstance, db: Db) {
  const uuid = z.string().uuid();
  const dubbel = async (naam: string, afkorting: string, behalve?: string) => {
    const rijen = await db.select().from(businessUnits);
    return rijen.some((r) => r.id !== behalve && (r.naam.toLowerCase() === naam.toLowerCase() || r.afkorting.toLowerCase() === afkorting.toLowerCase()));
  };

  app.get('/api/business-units', async () => db.select().from(businessUnits).orderBy(asc(businessUnits.volgorde), asc(businessUnits.naam)));

  app.post('/api/business-units', async (req, reply) => {
    const b = unitBody.parse(req.body);
    if (await dubbel(b.naam, b.afkorting)) return reply.code(409).send({ fout: 'Er bestaat al een businessunit met deze naam of afkorting' });
    return reply.code(201).send((await db.insert(businessUnits).values(b).returning())[0]);
  });

  app.patch('/api/business-units/:id', async (req, reply) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const [huidig] = await db.select().from(businessUnits).where(eq(businessUnits.id, id));
    if (!huidig) return reply.code(404).send({ fout: 'Businessunit niet gevonden' });
    const b = unitWijziging.parse(req.body);
    if (await dubbel(b.naam ?? huidig.naam, b.afkorting ?? huidig.afkorting, id)) return reply.code(409).send({ fout: 'Er bestaat al een businessunit met deze naam of afkorting' });
    return (await db.update(businessUnits).set(b).where(eq(businessUnits.id, id)).returning())[0];
  });

  // Een unit in gebruik verwijderen zou iemands unit stilletjes leegmaken; verberg hem dan door hem op niet-actief te zetten.
  app.delete('/api/business-units/:id', async (req, reply) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const [bij, profielen] = await Promise.all([
      db.select({ id: employees.id }).from(employees).where(eq(employees.businessUnitId, id)).limit(1),
      db.select({ email: gebruikersprofielen.email }).from(gebruikersprofielen).where(eq(gebruikersprofielen.businessUnitId, id)).limit(1),
    ]);
    if (bij.length || profielen.length) return reply.code(409).send({ fout: 'Deze businessunit is nog in gebruik; zet hem op niet-actief om hem te verbergen' });
    const gewist = await db.delete(businessUnits).where(eq(businessUnits.id, id)).returning({ id: businessUnits.id });
    return gewist.length ? { ok: true } : reply.code(404).send({ fout: 'Businessunit niet gevonden' });
  });
}
