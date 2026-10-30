/**
 * API voor het verkoopregister: klanten, bezoeken en activiteiten uit verkoop-debriefs. Alles is voor de ingelogde beheerder zichtbaar
 * (geen filter per klant of accountmanager); de agent leest hieruit nooit voor aan de telefoon.
 */
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.js';
import { beoordeelKlantenLijst } from './klanten-import.js';
import { normaliseer } from './vertrouwen.js';
import { bewaarDebriefVragen, leesDebriefVragen, leesVorigeDebriefVragen } from './instellingen.js';
import { bezoeken, employees, activiteiten, klantContacten, klanten, topics } from './schema.js';

const uuid = z.string().uuid();
const nonEmpty = z.string().trim().min(1);
const datum = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d, 'Ongeldige datum');

const klantBody = z.object({
  naam: nonEmpty.max(200), status: z.enum(['prospect', 'klant', 'voorgesteld', 'inactief']),
  accountmanagerId: uuid.nullable(), omschrijving: z.string().max(2000), contractEinde: datum.nullable(),
  samenwerkingsverband: z.string().trim().max(200), inwoners: z.number().int().min(0).max(20_000_000).nullable(), salesAm: z.string().trim().max(100),
});
const contactBody = z.object({
  naam: nonEmpty.max(100), functie: z.string().trim().max(100).default(''), rol: z.string().trim().max(100).default(''),
  email: z.string().trim().max(200).refine((e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e), 'Ongeldig e-mailadres').default(''), telefoon: z.string().trim().max(30).default(''),
});

export function registreerVerkoop(app: FastifyInstance, db: Db) {
  // ── Vragen van de debrief (bewerkbaar; de grenzen staan vast in de voice-service) ──
  app.get('/api/instellingen/debrief-vragen', async () => ({ ...(await leesDebriefVragen(db)), vorige: await leesVorigeDebriefVragen(db) }));
  app.put('/api/instellingen/debrief-vragen', async (req) => {
    const { waarde } = z.object({ waarde: z.string().max(8000) }).parse(req.body);
    await bewaarDebriefVragen(db, waarde);
    return { ...(await leesDebriefVragen(db)), vorige: await leesVorigeDebriefVragen(db) };
  });

  // ── Klanten ──
  app.get('/api/klanten', async () => db.select({
    id: klanten.id, naam: klanten.naam, status: klanten.status, bron: klanten.bron, accountmanagerId: klanten.accountmanagerId, accountmanagerNaam: employees.naam,
    contractEinde: klanten.contractEinde, bijgewerktOp: klanten.bijgewerktOp,
    samenwerkingsverband: klanten.samenwerkingsverband, inwoners: klanten.inwoners, salesAm: klanten.salesAm,
    openActiviteiten: sql<number>`(select count(*)::int from ${activiteiten} where ${activiteiten.klantId} = ${klanten.id} and ${activiteiten.status} = 'open')`,
    laatsteBezoek: sql<string | null>`(select max(${bezoeken.datum})::text from ${bezoeken} where ${bezoeken.klantId} = ${klanten.id})`,
  }).from(klanten).leftJoin(employees, eq(klanten.accountmanagerId, employees.id)).orderBy(asc(klanten.naam)));

  // Een geplakte lijst gemeenten met contactpersonen. Met `voorbeeld` gebeurt er niets; zonder worden nieuwe gemeenten en nieuwe contactpersonen toegevoegd.
  app.post('/api/klanten/import', async (req) => {
    const b = z.object({ tekst: z.string().max(50_000), status: z.enum(['klant', 'prospect']).default('klant'), voorbeeld: z.boolean().default(false) }).parse(req.body);
    return db.transaction(async (tx) => {
      await tx.execute(sql`lock table klanten in share row exclusive mode`);
      const bestaandeKlanten = await tx.select().from(klanten);
      const bestaandeContacten = await tx.select().from(klantContacten);
      const uitkomst = beoordeelKlantenLijst(b.tekst, bestaandeKlanten.map((k) => ({ id: k.id, naam: k.naam })), bestaandeContacten.map((c) => ({ id: c.id, klantId: c.klantId, naam: c.naam })));
      let gemeenten = 0, contacten = 0, bijgewerkt = 0;
      if (!b.voorbeeld) {
        for (const g of uitkomst.gemeenten) {
          let klantId = g.klantId;
          const v = g.velden;
          if (!klantId) {
            klantId = (await tx.insert(klanten).values({ naam: g.naam, status: b.status, bron: 'handmatig', samenwerkingsverband: v.samenwerkingsverband, inwoners: v.inwoners, salesAm: v.salesAm, contractEinde: v.contractEinde }).returning({ id: klanten.id }))[0].id;
            gemeenten++;
          } else {
            // Een bestaande klant krijgt alleen aangevuld wat nog leeg is; ingevulde gegevens worden nooit overschreven.
            const k = bestaandeKlanten.find((x) => x.id === klantId)!;
            const aanvulling = {
              ...(!k.samenwerkingsverband && v.samenwerkingsverband ? { samenwerkingsverband: v.samenwerkingsverband } : {}),
              ...(k.inwoners === null && v.inwoners !== null ? { inwoners: v.inwoners } : {}),
              ...(!k.salesAm && v.salesAm ? { salesAm: v.salesAm } : {}),
              ...(!k.contractEinde && v.contractEinde ? { contractEinde: v.contractEinde } : {}),
            };
            if (Object.keys(aanvulling).length) { await tx.update(klanten).set({ ...aanvulling, bijgewerktOp: new Date() }).where(eq(klanten.id, klantId)); bijgewerkt++; }
          }
          for (const c of g.contacten) {
            if (c.status === 'nieuw') {
              await tx.insert(klantContacten).values({ klantId, naam: c.naam, functie: c.functie, rol: c.rol, email: c.email, telefoon: c.telefoon });
              contacten++;
              continue;
            }
            const bestaand = bestaandeContacten.find((x) => x.klantId === klantId && normaliseer(x.naam) === normaliseer(c.naam));
            const aanvulling = { ...(bestaand && !bestaand.email && c.email ? { email: c.email } : {}), ...(bestaand && !bestaand.telefoon && c.telefoon ? { telefoon: c.telefoon } : {}) };
            if (bestaand && Object.keys(aanvulling).length) { await tx.update(klantContacten).set(aanvulling).where(eq(klantContacten.id, bestaand.id)); bijgewerkt++; }
          }
        }
      }
      return { ...uitkomst, toegevoegd: { gemeenten, contacten, bijgewerkt } };
    });
  });

  app.post('/api/klanten', async (req, reply) => {
    const b = klantBody.partial({ status: true, accountmanagerId: true, omschrijving: true, contractEinde: true, samenwerkingsverband: true, inwoners: true, salesAm: true }).parse(req.body);
    const [rij] = await db.insert(klanten).values({
      naam: b.naam, status: b.status ?? 'klant', accountmanagerId: b.accountmanagerId ?? null, omschrijving: b.omschrijving ?? '', contractEinde: b.contractEinde ?? null, bron: 'handmatig',
      samenwerkingsverband: b.samenwerkingsverband ?? '', inwoners: b.inwoners ?? null, salesAm: b.salesAm ?? '',
    }).returning();
    return reply.code(201).send(rij);
  });

  app.get('/api/klanten/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const [klant] = await db.select().from(klanten).where(eq(klanten.id, id));
    if (!klant) return reply.code(404).send({ fout: 'Klant niet gevonden' });
    const [contacten, bezoekRijen, punten] = await Promise.all([
      db.select().from(klantContacten).where(eq(klantContacten.klantId, id)).orderBy(asc(klantContacten.naam)),
      db.select({
        id: bezoeken.id, datum: bezoeken.datum, soort: bezoeken.soort, tevredenheid: bezoeken.tevredenheid, samenvatting: bezoeken.samenvatting,
        callId: bezoeken.callId, accountmanagerNaam: employees.naam, createdAt: bezoeken.createdAt,
      }).from(bezoeken).leftJoin(employees, eq(bezoeken.accountmanagerId, employees.id)).where(eq(bezoeken.klantId, id)).orderBy(sql`${bezoeken.datum} desc nulls last`, desc(bezoeken.createdAt)),
      db.select().from(activiteiten).where(eq(activiteiten.klantId, id)).orderBy(desc(activiteiten.createdAt)),
    ]);
    return { klant, contacten, bezoeken: bezoekRijen, activiteiten: punten };
  });

  app.patch('/api/klanten/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const b = klantBody.partial().parse(req.body);
    if (!Object.keys(b).length) return reply.code(400).send({ fout: 'Niets te wijzigen' });
    // Een beheerder die iets wijzigt wordt de bron van die klantgegevens.
    const [rij] = await db.update(klanten).set({ ...b, bron: 'handmatig', bijgewerktOp: new Date() }).where(eq(klanten.id, id)).returning();
    return rij ?? reply.code(404).send({ fout: 'Klant niet gevonden' });
  });

  // Een klant die uit een gesprek is voorgesteld: goedkeuren, of samenvoegen met een bestaande klant om dubbelen te voorkomen.
  app.post('/api/klanten/:id/controle', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const b = z.discriminatedUnion('besluit', [
      z.object({ besluit: z.literal('goedkeuren'), status: z.enum(['prospect', 'klant']).default('klant') }),
      z.object({ besluit: z.literal('samenvoegen'), met: uuid }),
    ]).parse(req.body);
    const [klant] = await db.select().from(klanten).where(eq(klanten.id, id));
    if (!klant) return reply.code(404).send({ fout: 'Klant niet gevonden' });
    if (klant.status !== 'voorgesteld') return reply.code(409).send({ fout: 'Deze klant hoeft niet gecontroleerd te worden' });
    if (b.besluit === 'goedkeuren') {
      const [rij] = await db.update(klanten).set({ status: b.status, bijgewerktOp: new Date() }).where(eq(klanten.id, id)).returning();
      // Activiteiten waarvan alleen de klant onzeker was, zijn nu ook gecontroleerd.
      await db.update(activiteiten).set({ controleNodig: false, controleReden: null }).where(and(eq(activiteiten.klantId, id), eq(activiteiten.controleReden, 'klant_niet_herkend')));
      return rij;
    }
    if (b.met === id) return reply.code(400).send({ fout: 'Kies een andere klant' });
    return db.transaction(async (tx) => {
      const [doel] = await tx.select({ id: klanten.id }).from(klanten).where(eq(klanten.id, b.met));
      if (!doel) return reply.code(404).send({ fout: 'Doelklant niet gevonden' });
      await tx.update(bezoeken).set({ klantId: b.met }).where(eq(bezoeken.klantId, id));
      await tx.update(activiteiten).set({ klantId: b.met }).where(eq(activiteiten.klantId, id));
      await tx.update(topics).set({ klantId: b.met }).where(eq(topics.klantId, id));
      await tx.update(klantContacten).set({ klantId: b.met }).where(eq(klantContacten.klantId, id));
      await tx.delete(klanten).where(eq(klanten.id, id));
      return { ok: true, samengevoegdMet: b.met };
    });
  });

  // Wissen van een klant met alles wat eraan hangt (AVG art. 17 / einde relatie). Bezoeksamenvattingen gaan mee.
  app.delete('/api/klanten/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const gewist = await db.transaction(async (tx) => {
      // De punten van dagboekonderwerpen blijven bestaan, ook zonder klant.
      await tx.update(activiteiten).set({ klantId: null }).where(and(eq(activiteiten.klantId, id), isNotNull(activiteiten.topicId)));
      await tx.delete(bezoeken).where(eq(bezoeken.klantId, id)); // activiteiten van die bezoeken gaan mee (cascade)
      return tx.delete(klanten).where(eq(klanten.id, id)).returning({ id: klanten.id });
    });
    return gewist.length ? { ok: true } : reply.code(404).send({ fout: 'Klant niet gevonden' });
  });

  app.post('/api/klanten/:id/contacten', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const b = contactBody.parse(req.body);
    const [klant] = await db.select({ id: klanten.id }).from(klanten).where(eq(klanten.id, id));
    if (!klant) return reply.code(404).send({ fout: 'Klant niet gevonden' });
    return reply.code(201).send((await db.insert(klantContacten).values({ klantId: id, ...b }).returning())[0]);
  });
  // Alle contactpersonen op één plek, om te zoeken, bij te werken, te verplaatsen naar een andere klant of te verwijderen.
  app.get('/api/klant-contacten', async () => db.select({
    id: klantContacten.id, klantId: klantContacten.klantId, klantNaam: klanten.naam, naam: klantContacten.naam, functie: klantContacten.functie,
    rol: klantContacten.rol, email: klantContacten.email, telefoon: klantContacten.telefoon,
  }).from(klantContacten).innerJoin(klanten, eq(klantContacten.klantId, klanten.id)).orderBy(asc(klanten.naam), asc(klantContacten.naam)));
  app.post('/api/klant-contacten', async (req, reply) => {
    const b = contactBody.extend({ klantId: uuid }).parse(req.body);
    const [klant] = await db.select({ id: klanten.id }).from(klanten).where(eq(klanten.id, b.klantId));
    if (!klant) return reply.code(404).send({ fout: 'Klant niet gevonden' });
    return reply.code(201).send((await db.insert(klantContacten).values(b).returning())[0]);
  });
  app.patch('/api/klant-contacten/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const b = z.object({ naam: nonEmpty.max(100), functie: z.string().trim().max(100), rol: z.string().trim().max(100), email: contactBody.shape.email.unwrap(), telefoon: z.string().trim().max(30), klantId: uuid }).partial().parse(req.body);
    if (!Object.keys(b).length) return reply.code(400).send({ fout: 'Niets te wijzigen' });
    if (b.klantId) {
      const [klant] = await db.select({ id: klanten.id }).from(klanten).where(eq(klanten.id, b.klantId));
      if (!klant) return reply.code(404).send({ fout: 'Klant niet gevonden' });
    }
    const [rij] = await db.update(klantContacten).set(b).where(eq(klantContacten.id, id)).returning();
    return rij ?? reply.code(404).send({ fout: 'Contactpersoon niet gevonden' });
  });
  app.delete('/api/klant-contacten/:id', async (req, reply) => {
    const gewist = await db.delete(klantContacten).where(eq(klantContacten.id, uuid.parse((req.params as any).id))).returning({ id: klantContacten.id });
    return gewist.length ? { ok: true } : reply.code(404).send({ fout: 'Contactpersoon niet gevonden' });
  });
}
