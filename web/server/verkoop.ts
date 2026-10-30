/**
 * API voor het verkoopregister: klanten, bezoeken en activiteiten uit verkoop-debriefs. Alles is voor de ingelogde beheerder zichtbaar
 * (geen filter per klant of accountmanager); de agent leest hieruit nooit voor aan de telefoon.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.js';
import { beoordeelKlantenLijst } from './klanten-import.js';
import { bewaarDebriefVragen, leesDebriefVragen, leesVorigeDebriefVragen } from './instellingen.js';
import { bezoeken, employees, klantActiviteiten, klantContacten, klanten } from './schema.js';

const uuid = z.string().uuid();
const nonEmpty = z.string().trim().min(1);
const datum = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d, 'Ongeldige datum');

const klantBody = z.object({
  naam: nonEmpty.max(200), status: z.enum(['prospect', 'klant', 'voorgesteld', 'inactief']),
  accountmanagerId: uuid.nullable(), omschrijving: z.string().max(2000), contractEinde: datum.nullable(),
});
const contactBody = z.object({ naam: nonEmpty.max(100), functie: z.string().trim().max(100).default(''), rol: z.string().trim().max(100).default('') });

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
    openActiviteiten: sql<number>`(select count(*)::int from ${klantActiviteiten} where ${klantActiviteiten.klantId} = ${klanten.id} and ${klantActiviteiten.status} = 'open')`,
    laatsteBezoek: sql<string | null>`(select max(${bezoeken.datum})::text from ${bezoeken} where ${bezoeken.klantId} = ${klanten.id})`,
  }).from(klanten).leftJoin(employees, eq(klanten.accountmanagerId, employees.id)).orderBy(asc(klanten.naam)));

  // Een geplakte lijst gemeenten met contactpersonen. Met `voorbeeld` gebeurt er niets; zonder worden nieuwe gemeenten en nieuwe contactpersonen toegevoegd.
  app.post('/api/klanten/import', async (req) => {
    const b = z.object({ tekst: z.string().max(50_000), status: z.enum(['klant', 'prospect']).default('klant'), voorbeeld: z.boolean().default(false) }).parse(req.body);
    return db.transaction(async (tx) => {
      await tx.execute(sql`lock table klanten in share row exclusive mode`);
      const uitkomst = beoordeelKlantenLijst(b.tekst, await tx.select({ id: klanten.id, naam: klanten.naam }).from(klanten), await tx.select({ klantId: klantContacten.klantId, naam: klantContacten.naam }).from(klantContacten));
      let gemeenten = 0, contacten = 0;
      if (!b.voorbeeld) {
        for (const g of uitkomst.gemeenten) {
          let klantId = g.klantId;
          if (!klantId) {
            klantId = (await tx.insert(klanten).values({ naam: g.naam, status: b.status, bron: 'handmatig' }).returning({ id: klanten.id }))[0].id;
            gemeenten++;
          }
          for (const c of g.contacten.filter((x) => x.status === 'nieuw')) {
            await tx.insert(klantContacten).values({ klantId, naam: c.naam, functie: c.functie, rol: c.rol });
            contacten++;
          }
        }
      }
      return { ...uitkomst, toegevoegd: { gemeenten, contacten } };
    });
  });

  app.post('/api/klanten', async (req, reply) => {
    const b = klantBody.partial({ status: true, accountmanagerId: true, omschrijving: true, contractEinde: true }).parse(req.body);
    const [rij] = await db.insert(klanten).values({
      naam: b.naam, status: b.status ?? 'klant', accountmanagerId: b.accountmanagerId ?? null, omschrijving: b.omschrijving ?? '', contractEinde: b.contractEinde ?? null, bron: 'handmatig',
    }).returning();
    return reply.code(201).send(rij);
  });

  app.get('/api/klanten/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const [klant] = await db.select().from(klanten).where(eq(klanten.id, id));
    if (!klant) return reply.code(404).send({ fout: 'Klant niet gevonden' });
    const [contacten, bezoekRijen, activiteiten] = await Promise.all([
      db.select().from(klantContacten).where(eq(klantContacten.klantId, id)).orderBy(asc(klantContacten.naam)),
      db.select({
        id: bezoeken.id, datum: bezoeken.datum, soort: bezoeken.soort, tevredenheid: bezoeken.tevredenheid, samenvatting: bezoeken.samenvatting,
        callId: bezoeken.callId, accountmanagerNaam: employees.naam, createdAt: bezoeken.createdAt,
      }).from(bezoeken).leftJoin(employees, eq(bezoeken.accountmanagerId, employees.id)).where(eq(bezoeken.klantId, id)).orderBy(sql`${bezoeken.datum} desc nulls last`, desc(bezoeken.createdAt)),
      db.select().from(klantActiviteiten).where(eq(klantActiviteiten.klantId, id)).orderBy(desc(klantActiviteiten.createdAt)),
    ]);
    return { klant, contacten, bezoeken: bezoekRijen, activiteiten };
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
      await db.update(klantActiviteiten).set({ controleNodig: false, controleReden: null }).where(and(eq(klantActiviteiten.klantId, id), eq(klantActiviteiten.controleReden, 'klant_niet_herkend')));
      return rij;
    }
    if (b.met === id) return reply.code(400).send({ fout: 'Kies een andere klant' });
    return db.transaction(async (tx) => {
      const [doel] = await tx.select({ id: klanten.id }).from(klanten).where(eq(klanten.id, b.met));
      if (!doel) return reply.code(404).send({ fout: 'Doelklant niet gevonden' });
      await tx.update(bezoeken).set({ klantId: b.met }).where(eq(bezoeken.klantId, id));
      await tx.update(klantActiviteiten).set({ klantId: b.met }).where(eq(klantActiviteiten.klantId, id));
      await tx.update(klantContacten).set({ klantId: b.met }).where(eq(klantContacten.klantId, id));
      await tx.delete(klanten).where(eq(klanten.id, id));
      return { ok: true, samengevoegdMet: b.met };
    });
  });

  // Wissen van een klant met alles wat eraan hangt (AVG art. 17 / einde relatie). Bezoeksamenvattingen gaan mee.
  app.delete('/api/klanten/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const gewist = await db.transaction(async (tx) => {
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
  app.delete('/api/klant-contacten/:id', async (req, reply) => {
    const gewist = await db.delete(klantContacten).where(eq(klantContacten.id, uuid.parse((req.params as any).id))).returning({ id: klantContacten.id });
    return gewist.length ? { ok: true } : reply.code(404).send({ fout: 'Contactpersoon niet gevonden' });
  });

  // ── Verkoopregister: alle activiteiten, met filters aan de clientkant ──
  app.get('/api/verkoopregister', async () => db.select({
    id: klantActiviteiten.id, soort: klantActiviteiten.soort, omschrijving: klantActiviteiten.omschrijving, status: klantActiviteiten.status,
    klantId: klantActiviteiten.klantId, klantNaam: klanten.naam, klantStatus: klanten.status,
    eigenaarId: klantActiviteiten.eigenaarId, eigenaarNaam: employees.naam, eigenaarExtern: klantActiviteiten.eigenaarExtern,
    deadline: klantActiviteiten.deadline, details: klantActiviteiten.details, citaat: klantActiviteiten.citaat,
    controleNodig: klantActiviteiten.controleNodig, controleReden: klantActiviteiten.controleReden, createdAt: klantActiviteiten.createdAt, afgerondOp: klantActiviteiten.afgerondOp,
  }).from(klantActiviteiten).leftJoin(klanten, eq(klantActiviteiten.klantId, klanten.id)).leftJoin(employees, eq(klantActiviteiten.eigenaarId, employees.id))
    .orderBy(asc(klantActiviteiten.status), sql`${klantActiviteiten.deadline} asc nulls last`, desc(klantActiviteiten.createdAt)));

  app.patch('/api/activiteiten/:id', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const b = z.object({
      omschrijving: nonEmpty.max(400), status: z.enum(['open', 'afgerond']), klantId: uuid.nullable(), eigenaarId: uuid.nullable(),
      eigenaarExtern: z.string().trim().max(100), deadline: datum.nullable(), details: z.record(z.string(), z.unknown()),
    }).partial().parse(req.body);
    const waarden: Record<string, unknown> = { ...b };
    if (b.status) waarden.afgerondOp = b.status === 'afgerond' ? new Date() : null;
    if (!Object.keys(waarden).length) return reply.code(400).send({ fout: 'Niets te wijzigen' });
    const [rij] = await db.update(klantActiviteiten).set(waarden).where(eq(klantActiviteiten.id, id)).returning();
    return rij ?? reply.code(404).send({ fout: 'Activiteit niet gevonden' });
  });

  // Een activiteit die niet te onderbouwen was wacht op een besluit: goedkeuren houdt hem, afwijzen verwijdert hem.
  app.post('/api/activiteiten/:id/controle', async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const { besluit } = z.object({ besluit: z.enum(['goedkeuren', 'afwijzen']) }).parse(req.body);
    const [punt] = await db.select().from(klantActiviteiten).where(eq(klantActiviteiten.id, id));
    if (!punt) return reply.code(404).send({ fout: 'Activiteit niet gevonden' });
    if (!punt.controleNodig) return reply.code(409).send({ fout: 'Deze activiteit hoeft niet gecontroleerd te worden' });
    // Een bestaand punt dat mogelijk is afgerond: goedkeuren sluit het, afwijzen houdt het open. Het wordt nooit verwijderd.
    if (punt.controleReden === 'mogelijk_afgerond') {
      const [rij] = await db.update(klantActiviteiten).set({
        controleNodig: false, controleReden: null, ...(besluit === 'goedkeuren' ? { status: 'afgerond' as const, afgerondOp: new Date() } : {}),
      }).where(eq(klantActiviteiten.id, id)).returning();
      return rij;
    }
    if (besluit === 'afwijzen') {
      await db.delete(klantActiviteiten).where(eq(klantActiviteiten.id, id));
      return { ok: true, verwijderd: true };
    }
    const [rij] = await db.update(klantActiviteiten).set({ controleNodig: false, controleReden: null }).where(eq(klantActiviteiten.id, id)).returning();
    return rij;
  });
  app.delete('/api/activiteiten/:id', async (req, reply) => {
    const gewist = await db.delete(klantActiviteiten).where(eq(klantActiviteiten.id, uuid.parse((req.params as any).id))).returning({ id: klantActiviteiten.id });
    return gewist.length ? { ok: true } : reply.code(404).send({ fout: 'Activiteit niet gevonden' });
  });
}
