/**
 * Bezoekvoorbereiding per gemeente: één samengestelde, alleen-lezen weergave van wat er al over een klant is vastgelegd.
 * Volledig deterministisch uit bevestigde records (geen taalmodel, dus niets verzonnen), met datum en bron bij elk onderdeel.
 * Punten die nog gecontroleerd moeten worden staan apart onder `nietBevestigd` en tellen nergens mee. Geen transcripten en geen citaten.
 */
import { and, asc, desc, eq, inArray, max, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.js';
import { activiteiten, bezoeken, consultantDebriefContacten, consultantDebriefs, employees, implementaties, klantContacten, klanten, samenverderBudgetmutaties, samenverderProgrammas, samenverderSessies, topics, updates } from './schema.js';
import { berekenBudget, type Budget } from './samenverder-budget.js';
import { vandaagNL } from './samenvatten.js';

const uuid = z.string().uuid();

export type Bron = 'dagboek' | 'verkoop-debrief' | 'consultant-debrief' | 'werkregister';
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export interface Voorbereiding {
  klant: { id: string; naam: string; status: string; samenwerkingsverband: string; inwoners: number | null; contractEinde: string | null; accountmanagerNaam: string | null; omschrijving: string };
  contacten: { id: string; naam: string; functie: string; rol: string; laatstGesproken: string | null }[];
  onderwerpen: { id: string; titel: string; type: string; status: string; eigenaarNaam: string | null; laatsteUpdate: { datum: string; samenvatting: string; besluiten: string } | null; bron: Bron }[];
  samenverder: { id: string; pakket: string; periodeVan: string; periodeTot: string | null; status: string; aantalGepland: number; aantalUitgevoerd: number; volgendeSessie: string | null; laatsteSessie: string | null; budget: Budget; laatsteSamenvatting: { datum: string; tekst: string } | null; bron: Bron }[];
  implementaties: { topicId: string; titel: string; module: string; fase: string; testStatus: string; status: string; geplandeLivegang: string | null; werkelijkeLivegang: string | null; bron: Bron }[];
  gesprekken: { soort: 'bezoek' | 'project' | 'implementatie' | 'samenverder' | 'consultant'; datum: string | null; samenvatting: string; door: string | null; bron: Bron }[];
  openPunten: { id: string; soort: string; omschrijving: string; eigenaar: string; deadline: string | null; teLaat: boolean; onderwerp: string | null; datum: string; bron: Bron }[];
  nietBevestigd: { soort: 'punt' | 'debrief'; omschrijving: string; reden: string | null; datum: string; bron: Bron }[];
}

const MAX_GESPREKKEN = 10;
const MAX_ONDERWERPEN = 30;
const MAX_PUNTEN = 200;

export async function bouwVoorbereiding(db: Db, klantId: string): Promise<Voorbereiding | null> {
  const [klant] = await db.select({
    id: klanten.id, naam: klanten.naam, status: klanten.status, samenwerkingsverband: klanten.samenwerkingsverband, inwoners: klanten.inwoners,
    contractEinde: klanten.contractEinde, omschrijving: klanten.omschrijving, accountmanagerNaam: employees.naam,
  }).from(klanten).leftJoin(employees, eq(klanten.accountmanagerId, employees.id)).where(eq(klanten.id, klantId));
  if (!klant) return null;

  const [implementatieRijen, contactRijen, laatstRijen, topicRijen, bezoekRijen, debriefRijen, puntRijen] = await Promise.all([
    db.select({ topicId: implementaties.topicId, titel: topics.titel, module: implementaties.module, fase: implementaties.fase, testStatus: implementaties.testStatus, status: topics.status, geplandeLivegang: implementaties.geplandeLivegang, werkelijkeLivegang: implementaties.werkelijkeLivegang })
      .from(implementaties).innerJoin(topics, eq(implementaties.topicId, topics.id)).where(eq(topics.klantId, klantId)).orderBy(desc(topics.updatedAt)),
    db.select({ id: klantContacten.id, naam: klantContacten.naam, functie: klantContacten.functie, rol: klantContacten.rol }).from(klantContacten).where(eq(klantContacten.klantId, klantId)).orderBy(asc(klantContacten.naam)),
    // "Laatst gesproken" wordt berekend uit de debriefs waarin de persoon genoemd werd; het wordt nergens opgeslagen.
    db.select({ contactId: consultantDebriefContacten.contactId, laatst: max(consultantDebriefs.createdAt) }).from(consultantDebriefContacten)
      .innerJoin(consultantDebriefs, eq(consultantDebriefContacten.debriefId, consultantDebriefs.id)).where(and(eq(consultantDebriefs.klantId, klantId), eq(consultantDebriefs.controleNodig, false)))
      .groupBy(consultantDebriefContacten.contactId),
    db.select({ id: topics.id, titel: topics.titel, type: topics.type, status: topics.status, eigenaarNaam: employees.naam }).from(topics)
      .leftJoin(employees, eq(topics.eigenaarId, employees.id)).where(eq(topics.klantId, klantId)).orderBy(desc(topics.updatedAt)).limit(MAX_ONDERWERPEN),
    db.select({ datum: bezoeken.datum, createdAt: bezoeken.createdAt, soort: bezoeken.soort, samenvatting: bezoeken.samenvatting, door: employees.naam })
      .from(bezoeken).leftJoin(employees, eq(bezoeken.accountmanagerId, employees.id)).where(eq(bezoeken.klantId, klantId)).orderBy(sql`${bezoeken.datum} desc nulls last`, desc(bezoeken.createdAt)).limit(MAX_GESPREKKEN),
    db.select({ variant: consultantDebriefs.variant, samenvatting: consultantDebriefs.samenvatting, createdAt: consultantDebriefs.createdAt, controleNodig: consultantDebriefs.controleNodig, controleReden: consultantDebriefs.controleReden, door: employees.naam })
      .from(consultantDebriefs).leftJoin(employees, eq(consultantDebriefs.employeeId, employees.id)).where(eq(consultantDebriefs.klantId, klantId)).orderBy(desc(consultantDebriefs.createdAt)).limit(MAX_GESPREKKEN * 2),
    db.select({
      id: activiteiten.id, soort: activiteiten.soort, omschrijving: activiteiten.omschrijving, eigenaarNaam: employees.naam, eigenaarExtern: activiteiten.eigenaarExtern,
      deadline: activiteiten.deadline, createdAt: activiteiten.createdAt, controleNodig: activiteiten.controleNodig, controleReden: activiteiten.controleReden, onderwerp: topics.titel,
    }).from(activiteiten).leftJoin(employees, eq(activiteiten.eigenaarId, employees.id)).leftJoin(topics, eq(activiteiten.topicId, topics.id))
      .where(and(eq(activiteiten.klantId, klantId), eq(activiteiten.status, 'open'))).orderBy(sql`${activiteiten.deadline} asc nulls last`, desc(activiteiten.createdAt)).limit(MAX_PUNTEN),
  ]);

  // SamenVerder-programma's van deze gemeente: wat gepland en uitgevoerd is (bevestigd), en de laatste samenvatting van een debrief bij het programma.
  const programmaRijen = await db.select().from(samenverderProgrammas).where(eq(samenverderProgrammas.klantId, klantId)).orderBy(desc(samenverderProgrammas.periodeVan));
  const programmaIds = programmaRijen.map((p) => p.id);
  const [sessieRijen, programmaDebriefs, mutatieRijen] = programmaIds.length ? await Promise.all([
    db.select({ programmaId: samenverderSessies.programmaId, status: samenverderSessies.status, datum: samenverderSessies.datum, omvangDagen: samenverderSessies.omvangDagen, bevestigdOp: samenverderSessies.bevestigdOp }).from(samenverderSessies).where(inArray(samenverderSessies.programmaId, programmaIds)),
    db.select({ programmaId: consultantDebriefs.programmaId, samenvatting: consultantDebriefs.samenvatting, createdAt: consultantDebriefs.createdAt }).from(consultantDebriefs)
      .where(and(inArray(consultantDebriefs.programmaId, programmaIds), eq(consultantDebriefs.controleNodig, false))).orderBy(desc(consultantDebriefs.createdAt)),
    db.select({ programmaId: samenverderBudgetmutaties.programmaId, dagen: samenverderBudgetmutaties.dagen }).from(samenverderBudgetmutaties).where(inArray(samenverderBudgetmutaties.programmaId, programmaIds)),
  ]) : [[], [], []] as const;
  const vandaagDatum = vandaagNL();

  // Laatste update per onderwerp uit het dagboek.
  const topicIds = topicRijen.map((t) => t.id);
  const updateRijen = topicIds.length
    ? await db.select({ topicId: updates.topicId, samenvatting: updates.samenvatting, besluiten: updates.besluiten, createdAt: updates.createdAt }).from(updates).where(inArray(updates.topicId, topicIds)).orderBy(desc(updates.createdAt))
    : [];
  const laatsteUpdate = new Map<string, (typeof updateRijen)[number]>();
  for (const u of updateRijen) if (!laatsteUpdate.has(u.topicId)) laatsteUpdate.set(u.topicId, u);

  const laatst = new Map(laatstRijen.map((r) => [r.contactId, iso(r.laatst)]));
  const vandaag = new Date().toISOString().slice(0, 10);

  const gesprekken: Voorbereiding['gesprekken'] = [
    ...bezoekRijen.map((b) => ({ soort: 'bezoek' as const, datum: b.datum ?? iso(b.createdAt), samenvatting: b.samenvatting, door: b.door, bron: 'verkoop-debrief' as const })),
    ...debriefRijen.filter((d) => !d.controleNodig).map((d) => ({ soort: (d.variant ?? 'consultant') as 'project' | 'implementatie' | 'samenverder' | 'consultant', datum: iso(d.createdAt), samenvatting: d.samenvatting, door: d.door, bron: 'consultant-debrief' as const })),
  ].sort((a, b) => (b.datum ?? '').localeCompare(a.datum ?? '')).slice(0, MAX_GESPREKKEN);

  const bevestigd = puntRijen.filter((p) => !p.controleNodig);
  return {
    klant: { id: klant.id, naam: klant.naam, status: klant.status, samenwerkingsverband: klant.samenwerkingsverband, inwoners: klant.inwoners, contractEinde: klant.contractEinde, accountmanagerNaam: klant.accountmanagerNaam, omschrijving: klant.omschrijving },
    contacten: contactRijen.map((c) => ({ ...c, laatstGesproken: laatst.get(c.id) ?? null })),
    onderwerpen: topicRijen.map((t) => {
      const u = laatsteUpdate.get(t.id);
      return { ...t, laatsteUpdate: u ? { datum: iso(u.createdAt)!, samenvatting: u.samenvatting, besluiten: u.besluiten } : null, bron: 'dagboek' as const };
    }),
    samenverder: programmaRijen.map((p) => {
      const eigen = sessieRijen.filter((s) => s.programmaId === p.id);
      const gepland = eigen.filter((s) => s.status === 'gepland' && s.datum).map((s) => s.datum!).sort();
      const uitgevoerd = eigen.filter((s) => s.status === 'uitgevoerd' && s.datum).map((s) => s.datum!).sort();
      const laatste = programmaDebriefs.find((d) => d.programmaId === p.id);
      return {
        id: p.id, pakket: p.pakket, periodeVan: p.periodeVan, periodeTot: p.periodeTot, status: p.status, aantalGepland: gepland.length, aantalUitgevoerd: uitgevoerd.length,
        volgendeSessie: gepland.find((d) => d >= vandaagDatum) ?? null, laatsteSessie: uitgevoerd.at(-1) ?? null,
        budget: berekenBudget(mutatieRijen.filter((m) => m.programmaId === p.id), eigen),
        laatsteSamenvatting: laatste ? { datum: iso(laatste.createdAt)!, tekst: laatste.samenvatting } : null, bron: 'werkregister' as const,
      };
    }),
    implementaties: implementatieRijen.map((i) => ({ ...i, bron: 'werkregister' as const })),
    gesprekken,
    openPunten: bevestigd.map((p) => ({
      id: p.id, soort: p.soort, omschrijving: p.omschrijving, eigenaar: p.eigenaarNaam ?? p.eigenaarExtern, deadline: p.deadline, teLaat: !!p.deadline && p.deadline < vandaag,
      onderwerp: p.onderwerp, datum: iso(p.createdAt)!, bron: 'werkregister' as const,
    })),
    nietBevestigd: [
      ...puntRijen.filter((p) => p.controleNodig).map((p) => ({ soort: 'punt' as const, omschrijving: p.omschrijving, reden: p.controleReden, datum: iso(p.createdAt)!, bron: 'werkregister' as const })),
      ...debriefRijen.filter((d) => d.controleNodig).map((d) => ({ soort: 'debrief' as const, omschrijving: d.samenvatting, reden: d.controleReden, datum: iso(d.createdAt)!, bron: 'consultant-debrief' as const })),
    ].sort((a, b) => b.datum.localeCompare(a.datum)),
  };
}

export function registreerVoorbereiding(app: FastifyInstance, db: Db) {
  app.get('/api/klanten/:id/voorbereiding', async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(404).send({ fout: 'Klant niet gevonden' });
    const v = await bouwVoorbereiding(db, id.data);
    return v ?? reply.code(404).send({ fout: 'Klant niet gevonden' });
  });
}
