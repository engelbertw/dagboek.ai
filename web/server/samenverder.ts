/**
 * SamenVerder: programma's per gemeente en periode, met hun sessies (dagen), consultants en onderwerpen. Alleen administratie en planning;
 * het dagenbudget volgt later. Schrijven mag alleen een beheerder (zie rollen.ts); een accountmanager kan lezen.
 * Een sessie is pas `uitgevoerd` als een beheerder dat bevestigt: een gesprek zet nooit een sessie op uitgevoerd en wijzigt nooit een omvang of datum.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.js';
import {
  activiteiten, consultantDebriefs, employees, klantContacten, klanten, samenverderProgrammas, samenverderSessieConsultants, samenverderSessieOnderwerpen, samenverderSessies,
  SESSIE_SOORTEN, ONDERWERP_STATUSSEN, topics,
} from './schema.js';
import { vandaagNL } from './samenvatten.js';

const uuid = z.string().uuid();
const datum = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d, 'Ongeldige datum');
const tekst = (max: number) => z.string().trim().max(max);

// Let op: `.partial()` op velden met `.default()` vult die standaardwaarden bij een wijziging toch in. Daarom hebben de velden hier geen standaardwaarde;
// bij aanmaken worden ze apart ingevuld.
const programmaVelden = {
  pakket: tekst(200), periodeTot: datum.nullable(), status: z.enum(['actief', 'afgerond']), accountmanagerId: uuid.nullable(), opmerking: tekst(2000),
};
const programmaBody = z.object({ klantId: uuid, periodeVan: datum, ...programmaVelden }).partial({ pakket: true, periodeTot: true, status: true, accountmanagerId: true, opmerking: true })
  .transform((v) => ({ pakket: '', periodeTot: null, status: 'actief' as const, accountmanagerId: null, opmerking: '', ...v }));
const programmaWijziging = z.object({ periodeVan: datum, ...programmaVelden }).partial();

const sessieVelden = {
  soort: z.enum(SESSIE_SOORTEN), dagnummer: z.number().int().min(1).max(100).nullable(), onderwerp: tekst(300), doel: tekst(1000).nullable(), datum: datum.nullable(),
  omvangDagen: z.number().gt(0).max(20).multipleOf(0.01), extra: z.boolean(), contactpersoonId: uuid.nullable(), consultantIds: z.array(uuid).max(10),
};
const sessieWijziging = z.object(sessieVelden).partial();
const sessieBody = sessieWijziging.transform((v) => ({
  soort: 'uitvoering' as const, dagnummer: null, onderwerp: '', doel: null, datum: null, omvangDagen: 1, extra: false, contactpersoonId: null, consultantIds: [] as string[], ...v,
}));

const onderwerpVelden = { titel: tekst(300).min(1), topicId: uuid.nullable(), status: z.enum(ONDERWERP_STATUSSEN), voorgesteldInSessieId: uuid.nullable() };
const onderwerpWijziging = z.object(onderwerpVelden).partial();
const onderwerpBody = z.object(onderwerpVelden).partial({ topicId: true, status: true, voorgesteldInSessieId: true }).transform((v) => ({ topicId: null, status: 'gepland' as const, voorgesteldInSessieId: null, ...v }));

type Fout = { code: 400 | 404 | 409; fout: string };
const naarNum = (n: unknown) => Number(n);

export function registreerSamenverder(app: FastifyInstance, db: Db, wie: (req: FastifyRequest) => string | null) {
  const programmaVan = async (id: string) => (await db.select().from(samenverderProgrammas).where(eq(samenverderProgrammas.id, id)))[0];
  const sessieVan = async (id: string) => (await db.select().from(samenverderSessies).where(eq(samenverderSessies.id, id)))[0];
  const idParam = (req: FastifyRequest, naam = 'id') => uuid.safeParse((req.params as Record<string, string>)[naam]);

  // Alles bij een programma hoort bij dezelfde gemeente: contactpersoon, onderwerpen. Consultants moeten bestaande, actieve medewerkers zijn.
  async function controleerSessie(klantId: string, w: { contactpersoonId?: string | null; consultantIds?: string[] }): Promise<Fout | null> {
    if (w.contactpersoonId) {
      const [c] = await db.select({ klantId: klantContacten.klantId }).from(klantContacten).where(eq(klantContacten.id, w.contactpersoonId));
      if (!c || c.klantId !== klantId) return { code: 400, fout: 'De contactpersoon hoort niet bij dezelfde gemeente' };
    }
    if (w.consultantIds?.length) {
      const unieke = [...new Set(w.consultantIds)];
      const gevonden = await db.select({ id: employees.id }).from(employees).where(and(inArray(employees.id, unieke), eq(employees.actief, true)));
      if (gevonden.length !== unieke.length) return { code: 400, fout: 'Een consultant is niet gevonden of niet actief' };
    }
    return null;
  }

  // ── Programma's ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  app.get('/api/samenverder/programmas', async (req) => {
    const q = z.object({ klantId: uuid.optional(), status: z.enum(['actief', 'afgerond']).optional() }).parse(req.query);
    const rijen = await db.select({ p: samenverderProgrammas, klantNaam: klanten.naam, accountmanagerNaam: employees.naam }).from(samenverderProgrammas)
      .innerJoin(klanten, eq(samenverderProgrammas.klantId, klanten.id)).leftJoin(employees, eq(samenverderProgrammas.accountmanagerId, employees.id))
      .where(and(q.klantId ? eq(samenverderProgrammas.klantId, q.klantId) : undefined, q.status ? eq(samenverderProgrammas.status, q.status) : undefined))
      .orderBy(desc(samenverderProgrammas.periodeVan), asc(klanten.naam));
    const sessies = rijen.length ? await db.select({ programmaId: samenverderSessies.programmaId, status: samenverderSessies.status, datum: samenverderSessies.datum })
      .from(samenverderSessies).where(inArray(samenverderSessies.programmaId, rijen.map((r) => r.p.id))) : [];
    const vandaag = vandaagNL();
    return rijen.map(({ p, klantNaam, accountmanagerNaam }) => {
      const eigen = sessies.filter((s) => s.programmaId === p.id);
      const gepland = eigen.filter((s) => s.status === 'gepland' && s.datum).map((s) => s.datum!).sort();
      const uitgevoerd = eigen.filter((s) => s.status === 'uitgevoerd' && s.datum).map((s) => s.datum!).sort();
      return {
        ...p, klantNaam, accountmanagerNaam, aantalSessies: eigen.filter((s) => s.status !== 'geannuleerd' && s.status !== 'verplaatst').length,
        aantalGepland: gepland.length, aantalUitgevoerd: uitgevoerd.length, volgendeSessie: gepland.find((d) => d >= vandaag) ?? null, laatsteSessie: uitgevoerd.at(-1) ?? null,
      };
    });
  });

  app.post('/api/samenverder/programmas', async (req, reply) => {
    const b = programmaBody.parse(req.body);
    if (b.periodeTot && b.periodeTot < b.periodeVan) return reply.code(400).send({ fout: 'Het einde ligt voor het begin van de periode' });
    if (!(await db.select({ id: klanten.id }).from(klanten).where(eq(klanten.id, b.klantId))).length) return reply.code(400).send({ fout: 'Klant niet gevonden' });
    if (b.accountmanagerId && !(await db.select({ id: employees.id }).from(employees).where(eq(employees.id, b.accountmanagerId))).length) return reply.code(400).send({ fout: 'Accountmanager niet gevonden' });
    const [rij] = await db.insert(samenverderProgrammas).values(b).returning();
    return reply.code(201).send(rij);
  });

  app.get('/api/samenverder/programmas/:id', async (req, reply) => {
    const id = idParam(req);
    const p = id.success ? await programmaVan(id.data) : undefined;
    if (!p) return reply.code(404).send({ fout: 'Programma niet gevonden' });
    const [klant] = await db.select({ id: klanten.id, naam: klanten.naam }).from(klanten).where(eq(klanten.id, p.klantId));
    const rijen = await db.select({ s: samenverderSessies, contactNaam: klantContacten.naam }).from(samenverderSessies)
      .leftJoin(klantContacten, eq(samenverderSessies.contactpersoonId, klantContacten.id)).where(eq(samenverderSessies.programmaId, p.id))
      .orderBy(sql`${samenverderSessies.datum} asc nulls last`, asc(samenverderSessies.dagnummer), asc(samenverderSessies.createdAt));
    const ids = rijen.map((r) => r.s.id);
    const [consultants, onderwerpen, debriefs, punten] = ids.length ? await Promise.all([
      db.select({ sessieId: samenverderSessieConsultants.sessieId, id: employees.id, naam: employees.naam }).from(samenverderSessieConsultants).innerJoin(employees, eq(samenverderSessieConsultants.employeeId, employees.id)).where(inArray(samenverderSessieConsultants.sessieId, ids)).orderBy(asc(employees.naam)),
      db.select().from(samenverderSessieOnderwerpen).where(inArray(samenverderSessieOnderwerpen.sessieId, ids)).orderBy(asc(samenverderSessieOnderwerpen.createdAt)),
      db.select({ sessieId: consultantDebriefs.sessieId, id: consultantDebriefs.id, samenvatting: consultantDebriefs.samenvatting, createdAt: consultantDebriefs.createdAt, door: employees.naam })
        .from(consultantDebriefs).leftJoin(employees, eq(consultantDebriefs.employeeId, employees.id)).where(and(inArray(consultantDebriefs.sessieId, ids), eq(consultantDebriefs.controleNodig, false))).orderBy(asc(consultantDebriefs.createdAt)),
      db.select({ sessieId: activiteiten.samenverderSessieId, id: activiteiten.id, soort: activiteiten.soort, omschrijving: activiteiten.omschrijving, status: activiteiten.status, deadline: activiteiten.deadline, eigenaarNaam: employees.naam, eigenaarExtern: activiteiten.eigenaarExtern })
        .from(activiteiten).leftJoin(employees, eq(activiteiten.eigenaarId, employees.id)).where(and(inArray(activiteiten.samenverderSessieId, ids), eq(activiteiten.controleNodig, false))).orderBy(asc(activiteiten.createdAt)),
    ]) : [[], [], [], []] as const;
    return {
      programma: p, klant,
      sessies: rijen.map(({ s, contactNaam }) => ({
        ...s, omvangDagen: naarNum(s.omvangDagen), contactpersoonNaam: contactNaam,
        consultants: consultants.filter((c) => c.sessieId === s.id).map(({ id, naam }) => ({ id, naam })),
        onderwerpen: onderwerpen.filter((o) => o.sessieId === s.id),
        debriefs: debriefs.filter((d) => d.sessieId === s.id).map(({ id, samenvatting, createdAt, door }) => ({ id, samenvatting, createdAt, door })),
        activiteiten: punten.filter((a) => a.sessieId === s.id).map(({ sessieId: _s, eigenaarNaam, eigenaarExtern, ...rest }) => ({ ...rest, eigenaar: eigenaarNaam ?? eigenaarExtern })),
      })),
    };
  });

  app.patch('/api/samenverder/programmas/:id', async (req, reply) => {
    const id = idParam(req);
    const p = id.success ? await programmaVan(id.data) : undefined;
    if (!p) return reply.code(404).send({ fout: 'Programma niet gevonden' });
    const b = programmaWijziging.parse(req.body);
    const van = b.periodeVan ?? p.periodeVan;
    const tot = b.periodeTot === undefined ? p.periodeTot : b.periodeTot;
    if (tot && tot < van) return reply.code(400).send({ fout: 'Het einde ligt voor het begin van de periode' });
    if (b.accountmanagerId && !(await db.select({ id: employees.id }).from(employees).where(eq(employees.id, b.accountmanagerId))).length) return reply.code(400).send({ fout: 'Accountmanager niet gevonden' });
    const [rij] = await db.update(samenverderProgrammas).set({ ...b, bijgewerktOp: new Date() }).where(eq(samenverderProgrammas.id, p.id)).returning();
    return rij;
  });

  app.delete('/api/samenverder/programmas/:id', async (req, reply) => {
    const id = idParam(req);
    const p = id.success ? await programmaVan(id.data) : undefined;
    if (!p) return reply.code(404).send({ fout: 'Programma niet gevonden' });
    const [uitgevoerd] = await db.select({ id: samenverderSessies.id }).from(samenverderSessies).where(and(eq(samenverderSessies.programmaId, p.id), eq(samenverderSessies.status, 'uitgevoerd'))).limit(1);
    if (uitgevoerd) return reply.code(409).send({ fout: 'Dit programma heeft uitgevoerde sessies en kan niet worden verwijderd; zet het op afgerond' });
    await db.delete(samenverderProgrammas).where(eq(samenverderProgrammas.id, p.id));
    return { ok: true };
  });

  // ── Sessies ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  app.post('/api/samenverder/programmas/:id/sessies', async (req, reply) => {
    const id = idParam(req);
    const p = id.success ? await programmaVan(id.data) : undefined;
    if (!p) return reply.code(404).send({ fout: 'Programma niet gevonden' });
    const { consultantIds, omvangDagen, ...b } = sessieBody.parse(req.body);
    if (!b.datum) return reply.code(400).send({ fout: 'Een geplande sessie heeft een datum' });
    const fout = await controleerSessie(p.klantId, { contactpersoonId: b.contactpersoonId, consultantIds });
    if (fout) return reply.code(fout.code).send({ fout: fout.fout });
    const sessie = await db.transaction(async (tx) => {
      const [s] = await tx.insert(samenverderSessies).values({ ...b, omvangDagen: String(omvangDagen), programmaId: p.id }).returning();
      for (const employeeId of new Set(consultantIds)) await tx.insert(samenverderSessieConsultants).values({ sessieId: s.id, employeeId });
      return s;
    });
    return reply.code(201).send({ ...sessie, omvangDagen: naarNum(sessie.omvangDagen) });
  });

  app.patch('/api/samenverder/sessies/:id', async (req, reply) => {
    const id = idParam(req);
    const s = id.success ? await sessieVan(id.data) : undefined;
    if (!s) return reply.code(404).send({ fout: 'Sessie niet gevonden' });
    const { consultantIds, omvangDagen, ...b } = sessieWijziging.parse(req.body);
    if (s.status === 'verplaatst') return reply.code(409).send({ fout: 'Een verplaatste sessie kan niet worden gewijzigd; wijzig de nieuwe sessie' });
    const nieuweDatum = b.datum === undefined ? s.datum : b.datum;
    if ((s.status === 'gepland' || s.status === 'uitgevoerd') && !nieuweDatum) return reply.code(400).send({ fout: 'Een geplande of uitgevoerde sessie heeft een datum' });
    const [p] = await db.select({ klantId: samenverderProgrammas.klantId }).from(samenverderProgrammas).where(eq(samenverderProgrammas.id, s.programmaId));
    const fout = await controleerSessie(p.klantId, { contactpersoonId: b.contactpersoonId, consultantIds });
    if (fout) return reply.code(fout.code).send({ fout: fout.fout });
    const bijgewerkt = await db.transaction(async (tx) => {
      const [rij] = await tx.update(samenverderSessies).set({ ...b, ...(omvangDagen === undefined ? {} : { omvangDagen: String(omvangDagen) }), bijgewerktOp: new Date() }).where(eq(samenverderSessies.id, s.id)).returning();
      if (consultantIds) {
        await tx.delete(samenverderSessieConsultants).where(eq(samenverderSessieConsultants.sessieId, s.id));
        for (const employeeId of new Set(consultantIds)) await tx.insert(samenverderSessieConsultants).values({ sessieId: s.id, employeeId });
      }
      return rij;
    });
    return { ...bijgewerkt, omvangDagen: naarNum(bijgewerkt.omvangDagen) };
  });

  app.delete('/api/samenverder/sessies/:id', async (req, reply) => {
    const id = idParam(req);
    const s = id.success ? await sessieVan(id.data) : undefined;
    if (!s) return reply.code(404).send({ fout: 'Sessie niet gevonden' });
    if (s.status === 'uitgevoerd') return reply.code(409).send({ fout: 'Een uitgevoerde sessie kan niet worden verwijderd' });
    const [verwezen] = await db.select({ id: samenverderSessies.id }).from(samenverderSessies).where(eq(samenverderSessies.verplaatstNaarId, s.id)).limit(1);
    if (verwezen) return reply.code(409).send({ fout: 'Een sessie waarnaar een verplaatste sessie verwijst kan niet worden verwijderd' });
    await db.delete(samenverderSessies).where(eq(samenverderSessies.id, s.id));
    return { ok: true };
  });

  // Statusovergangen: elk een eigen handeling, voorwaardelijk op de huidige status zodat twee gelijktijdige verzoeken niet allebei slagen.
  const overgang = (pad: string, van: readonly string[], nodigDatum: boolean, zet: (s: typeof samenverderSessies.$inferSelect, req: FastifyRequest, datum: string | null) => Partial<typeof samenverderSessies.$inferInsert>) =>
    app.post(`/api/samenverder/sessies/:id/${pad}`, async (req, reply) => {
      const id = idParam(req);
      const s = id.success ? await sessieVan(id.data) : undefined;
      if (!s) return reply.code(404).send({ fout: 'Sessie niet gevonden' });
      const { datum: d } = z.object({ datum: datum.nullable().default(null) }).parse(req.body ?? {});
      const nieuweDatum = d ?? s.datum;
      if (nodigDatum && !nieuweDatum) return reply.code(400).send({ fout: 'Geef een datum op' });
      if (!van.includes(s.status)) return reply.code(409).send({ fout: `Dit kan niet bij een sessie met status ${s.status}` });
      const [rij] = await db.update(samenverderSessies).set({ ...zet(s, req, nieuweDatum), bijgewerktOp: new Date() })
        .where(and(eq(samenverderSessies.id, s.id), eq(samenverderSessies.status, s.status))).returning();
      return rij ? { ...rij, omvangDagen: naarNum(rij.omvangDagen) } : reply.code(409).send({ fout: 'De sessie is intussen gewijzigd' });
    });
  overgang('uitgevoerd', ['gepland'], true, (_s, req, d) => ({ status: 'uitgevoerd', datum: d, bevestigdDoor: wie(req) ?? 'beheerder', bevestigdOp: new Date() }));
  overgang('annuleer', ['gepland'], false, () => ({ status: 'geannuleerd' }));
  overgang('heropen', ['geannuleerd', 'uitgevoerd'], true, (_s, _req, d) => ({ status: 'gepland', datum: d, bevestigdDoor: null, bevestigdOp: null }));

  // Verplaatsen: de nieuwe sessie telt, de oude blijft als verplaatst bewaard en wijst naar de nieuwe.
  app.post('/api/samenverder/sessies/:id/verplaats', async (req, reply) => {
    const id = idParam(req);
    const s = id.success ? await sessieVan(id.data) : undefined;
    if (!s) return reply.code(404).send({ fout: 'Sessie niet gevonden' });
    const { datum: nieuweDatum } = z.object({ datum }).parse(req.body);
    if (s.status !== 'gepland') return reply.code(409).send({ fout: `Dit kan niet bij een sessie met status ${s.status}` });
    const nieuw = await db.transaction(async (tx) => {
      const [vergrendeld] = await tx.update(samenverderSessies).set({ bijgewerktOp: new Date() }).where(and(eq(samenverderSessies.id, s.id), eq(samenverderSessies.status, 'gepland'))).returning({ id: samenverderSessies.id });
      if (!vergrendeld) return null;
      const { id: _i, createdAt: _c, bijgewerktOp: _b, verplaatstNaarId: _v, bevestigdDoor: _d, bevestigdOp: _o, status: _s, datum: _da, ...kopie } = s;
      const [n] = await tx.insert(samenverderSessies).values({ ...kopie, datum: nieuweDatum, status: 'gepland' }).returning();
      const mensen = await tx.select({ employeeId: samenverderSessieConsultants.employeeId }).from(samenverderSessieConsultants).where(eq(samenverderSessieConsultants.sessieId, s.id));
      for (const m of mensen) await tx.insert(samenverderSessieConsultants).values({ sessieId: n.id, employeeId: m.employeeId });
      // Onderwerpen die nog niet zijn afgehandeld of afgewezen gaan mee.
      const open = await tx.select().from(samenverderSessieOnderwerpen).where(and(eq(samenverderSessieOnderwerpen.sessieId, s.id), inArray(samenverderSessieOnderwerpen.status, ['voorgesteld', 'gepland'])));
      for (const o of open) await tx.insert(samenverderSessieOnderwerpen).values({ sessieId: n.id, titel: o.titel, topicId: o.topicId, status: o.status, voorgesteldInSessieId: o.voorgesteldInSessieId });
      await tx.update(samenverderSessies).set({ status: 'verplaatst', verplaatstNaarId: n.id }).where(eq(samenverderSessies.id, s.id));
      return n;
    });
    return nieuw ? reply.code(201).send({ ...nieuw, omvangDagen: naarNum(nieuw.omvangDagen) }) : reply.code(409).send({ fout: 'De sessie is intussen gewijzigd' });
  });

  // ── Onderwerpen van een sessie ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  async function controleerOnderwerp(sessie: typeof samenverderSessies.$inferSelect, b: { topicId?: string | null; voorgesteldInSessieId?: string | null }): Promise<Fout | null> {
    if (b.topicId) {
      const [p] = await db.select({ klantId: samenverderProgrammas.klantId }).from(samenverderProgrammas).where(eq(samenverderProgrammas.id, sessie.programmaId));
      const [t] = await db.select({ klantId: topics.klantId }).from(topics).where(eq(topics.id, b.topicId));
      if (!t || t.klantId !== p.klantId) return { code: 400, fout: 'Het onderwerp hoort niet bij dezelfde gemeente' };
    }
    if (b.voorgesteldInSessieId) {
      const [v] = await db.select({ programmaId: samenverderSessies.programmaId }).from(samenverderSessies).where(eq(samenverderSessies.id, b.voorgesteldInSessieId));
      if (!v || v.programmaId !== sessie.programmaId) return { code: 400, fout: 'De sessie waarin dit onderwerp is voorgesteld hoort niet bij dit programma' };
    }
    return null;
  }

  app.post('/api/samenverder/sessies/:id/onderwerpen', async (req, reply) => {
    const id = idParam(req);
    const s = id.success ? await sessieVan(id.data) : undefined;
    if (!s) return reply.code(404).send({ fout: 'Sessie niet gevonden' });
    const b = onderwerpBody.parse(req.body);
    const fout = await controleerOnderwerp(s, b);
    if (fout) return reply.code(fout.code).send({ fout: fout.fout });
    const [rij] = await db.insert(samenverderSessieOnderwerpen).values({ ...b, sessieId: s.id }).returning();
    return reply.code(201).send(rij);
  });

  app.patch('/api/samenverder/onderwerpen/:id', async (req, reply) => {
    const id = idParam(req);
    const [o] = id.success ? await db.select().from(samenverderSessieOnderwerpen).where(eq(samenverderSessieOnderwerpen.id, id.data)) : [];
    if (!o) return reply.code(404).send({ fout: 'Onderwerp niet gevonden' });
    const b = onderwerpWijziging.parse(req.body);
    const s = (await sessieVan(o.sessieId))!;
    const fout = await controleerOnderwerp(s, b);
    if (fout) return reply.code(fout.code).send({ fout: fout.fout });
    const [rij] = await db.update(samenverderSessieOnderwerpen).set(b).where(eq(samenverderSessieOnderwerpen.id, o.id)).returning();
    return rij;
  });

  app.delete('/api/samenverder/onderwerpen/:id', async (req, reply) => {
    const id = idParam(req);
    const gewist = id.success ? await db.delete(samenverderSessieOnderwerpen).where(eq(samenverderSessieOnderwerpen.id, id.data)).returning({ id: samenverderSessieOnderwerpen.id }) : [];
    return gewist.length ? { ok: true } : reply.code(404).send({ fout: 'Onderwerp niet gevonden' });
  });
}
