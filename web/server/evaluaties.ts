import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { klantSleutel } from './debrief-gedeeld.js';
import type { Db } from './db.js';
import { lijktOpBestaandeKlant } from './datakwaliteit.js';
import {
  beoordeelEvaluaties, evaluatieInhoudHash, evaluatieSleutel, GeenFeedbackRapport, leesFeedbackRapport, leesPdfPaginas, MAX_PDF_BYTES, samenvatting, type Evaluatie,
} from './ithermometer-import.js';
import { klanten, klantContacten, klantEvaluaties } from './schema.js';
import { normaliseer } from './vertrouwen.js';

/**
 * Routes voor evaluaties uit iThermometer: voorbeeld (leest een PDF, slaat niets op), bevestigen (slaat op, zonder dubbelen) en lezen per klant.
 * Voorbeeld en bevestigen zijn alleen voor de beheerder (niet in rollen.ts, dus default-deny); lezen per klant ook voor de accountmanager.
 */

const tekst = (max: number) => z.string().max(max);
const evaluatieSchema = z.object({
  gemeente: tekst(200).min(1), datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), aangemaakt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  contact: z.object({ naam: tekst(200), functie: tekst(300), email: tekst(200), telefoon: tekst(60) }),
  businessUnit: tekst(100),
  scores: z.array(z.object({ label: tekst(200), waarde: z.number().int().min(0).max(10).nullable() })).min(1).max(30),
  toelichting: z.array(z.object({ vraag: tekst(300), antwoord: tekst(20_000) })).max(30),
  themas: tekst(20_000), domeinfeedback: tekst(40_000),
});
const bevestigSchema = z.object({
  evaluaties: z.array(z.object({
    evaluatie: evaluatieSchema,
    /** Een bestaande klant kiezen, of 'nieuw' (een nieuwe gemeente als voorstel aanmaken). Zonder keuze geldt de herkende gemeente. */
    klant: z.union([z.string().uuid(), z.literal('nieuw')]).optional(),
    bijwerken: z.boolean().default(false),
    contactToevoegen: z.boolean().default(true),
  })).min(1).max(500),
});

interface Sessie { email: string }

export function registreerEvaluaties(app: FastifyInstance, db: Db, sessie: (req: unknown) => Sessie | null) {
  // Alleen voor dit content-type; verder blijft alles JSON. De limiet geldt voor het hele verzoek.
  app.addContentTypeParser('application/pdf', { parseAs: 'buffer', bodyLimit: MAX_PDF_BYTES }, (_req, body, done) => done(null, body));

  app.post('/api/evaluaties/import/voorbeeld', async (req, reply) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) return reply.code(400).send({ fout: 'Kies een PDF-bestand' });
    try {
      const uitgelezen = leesFeedbackRapport(await leesPdfPaginas(body));
      const [alle, contacten, bestaand] = await Promise.all([
        db.select({ id: klanten.id, naam: klanten.naam }).from(klanten),
        db.select({ klantId: klantContacten.klantId, naam: klantContacten.naam }).from(klantContacten),
        db.select({ sleutel: klantEvaluaties.sleutel, inhoudHash: klantEvaluaties.inhoudHash }).from(klantEvaluaties),
      ]);
      const beoordeeld = beoordeelEvaluaties(uitgelezen.evaluaties, bestaand, alle, contacten);
      const naamVan = new Map(alle.map((k) => [k.id, k.naam]));
      return {
        samenvatting: samenvatting(beoordeeld, uitgelezen.nietLeesbaar.length),
        nietLeesbaar: uitgelezen.nietLeesbaar,
        evaluaties: beoordeeld.map((b) => ({
          ...b, klantNaam: b.klantId ? naamVan.get(b.klantId) ?? null : null,
          // Bij een onbekende gemeente: welke bestaande klanten lijken erop (bijvoorbeeld een andere schrijfwijze).
          suggesties: b.klantId ? [] : lijktOpBestaandeKlant(b.evaluatie.gemeente, alle).map((k) => alle.find((x) => x.naam === k.naam)!).filter(Boolean).slice(0, 3),
        })),
        klanten: alle.sort((a, b) => a.naam.localeCompare(b.naam, 'nl')),
      };
    } catch (e) {
      if (e instanceof GeenFeedbackRapport) return reply.code(422).send({ fout: e.message });
      throw e;
    }
  });

  app.post('/api/evaluaties/import/bevestig', async (req) => {
    const b = bevestigSchema.parse(req.body);
    const door = sessie(req)?.email ?? '';
    return db.transaction(async (tx) => {
      // Zelfde slot als de klantenimport: twee gelijktijdige imports maken niet dezelfde nieuwe gemeente aan.
      await tx.execute(sql`lock table klanten in share row exclusive mode`);
      const klantRijen = await tx.select({ id: klanten.id, naam: klanten.naam }).from(klanten);
      const perNaam = new Map(klantRijen.map((k) => [klantSleutel(k.naam), k.id]));
      const bekend = new Set(klantRijen.map((k) => k.id));
      const klaar = new Set<string>();
      const uit = { aangemaakt: 0, bijgewerkt: 0, klantenAangemaakt: 0, contactenAangemaakt: 0, overgeslagen: { al_aanwezig: 0, gewijzigd: 0, dubbel: 0, gemeente_onbekend: 0 } };

      for (const r of b.evaluaties) {
        const e: Evaluatie = r.evaluatie;
        const sleutel = evaluatieSleutel(e), inhoud = evaluatieInhoudHash(e);
        if (klaar.has(sleutel)) { uit.overgeslagen.dubbel++; continue; }
        klaar.add(sleutel);

        let klantId: string | null = r.klant && r.klant !== 'nieuw' ? (bekend.has(r.klant) ? r.klant : null) : (perNaam.get(klantSleutel(e.gemeente)) ?? null);
        if (!klantId && r.klant === 'nieuw') {
          klantId = (await tx.insert(klanten).values({ naam: e.gemeente.slice(0, 200), status: 'voorgesteld', bron: 'handmatig' }).returning({ id: klanten.id }))[0].id;
          perNaam.set(klantSleutel(e.gemeente), klantId); bekend.add(klantId); uit.klantenAangemaakt++;
        }
        if (!klantId) { uit.overgeslagen.gemeente_onbekend++; continue; }

        const [bestaand] = await tx.select({ id: klantEvaluaties.id, inhoudHash: klantEvaluaties.inhoudHash }).from(klantEvaluaties).where(eq(klantEvaluaties.sleutel, sleutel));
        if (bestaand && (bestaand.inhoudHash === inhoud || !r.bijwerken)) { uit.overgeslagen[bestaand.inhoudHash === inhoud ? 'al_aanwezig' : 'gewijzigd']++; continue; }

        // De contactpersoon: bestaande koppelen, een nieuwe alleen aanmaken als de beheerder dat wil en de naam nog niet bij de gemeente staat.
        let contactId: string | null = null;
        if (e.contact.naam) {
          const contacten = await tx.select({ id: klantContacten.id, naam: klantContacten.naam }).from(klantContacten).where(eq(klantContacten.klantId, klantId));
          contactId = contacten.find((c) => normaliseer(c.naam) === normaliseer(e.contact.naam))?.id ?? null;
          if (!contactId && r.contactToevoegen) {
            contactId = (await tx.insert(klantContacten).values({ klantId, naam: e.contact.naam, functie: e.contact.functie, rol: '', email: e.contact.email, telefoon: e.contact.telefoon }).returning({ id: klantContacten.id }))[0].id;
            uit.contactenAangemaakt++;
          }
        }
        const velden = {
          klantId, contactId, gemeenteNaam: e.gemeente, datum: e.datum, aangemaaktInBron: e.aangemaakt, contactNaam: e.contact.naam, contactFunctie: e.contact.functie,
          contactEmail: e.contact.email, contactTelefoon: e.contact.telefoon, businessUnit: e.businessUnit, scores: e.scores, toelichting: e.toelichting, themas: e.themas,
          domeinfeedback: e.domeinfeedback, inhoudHash: inhoud,
        };
        if (bestaand) { await tx.update(klantEvaluaties).set({ ...velden, bijgewerktOp: new Date() }).where(eq(klantEvaluaties.id, bestaand.id)); uit.bijgewerkt++; continue; }
        const ingevoegd = await tx.insert(klantEvaluaties).values({ ...velden, sleutel, geimporteerdDoor: door }).onConflictDoNothing({ target: klantEvaluaties.sleutel }).returning({ id: klantEvaluaties.id });
        if (ingevoegd.length) uit.aangemaakt++; else uit.overgeslagen.al_aanwezig++;
      }
      return uit;
    });
  });

  app.get('/api/klanten/:id/evaluaties', async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(404).send({ fout: 'Klant niet gevonden' });
    const rijen = await db.select().from(klantEvaluaties).where(eq(klantEvaluaties.klantId, id.data)).orderBy(desc(klantEvaluaties.datum), desc(klantEvaluaties.geimporteerdOp));
    return rijen.map(({ sleutel: _s, inhoudHash: _h, ...r }) => r);
  });
}

export const telEvaluaties = async (db: Db, van: string, tot: string): Promise<number> =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(klantEvaluaties).where(and(sql`${klantEvaluaties.datum} >= ${van}::date`, sql`${klantEvaluaties.datum} <= ${tot}::date`)))[0].n;
