/**
 * Overzicht Consultancy: de lopende projecten en module-implementaties met hun stand, alleen uit vastgelegde records (geen taalmodel, geen schattingen).
 * Het zijn feiten en tellingen; er worden bewust geen scores, rangschikkingen of oordelen over tevredenheid of behoud afgeleid.
 * De SamenVerder-programma's staan in `/api/samenverder/programmas` (met dezelfde soort feiten) en worden in het scherm naast dit overzicht getoond.
 * Alleen punten die zijn gecontroleerd tellen mee; wat nog onder Controle nodig staat blijft erbuiten.
 */
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from './db.js';
import { activiteiten, consultantDebriefs, employees, implementaties, klanten, samenverderProgrammas, topics } from './schema.js';

const OPEN_BLOKKADE_SOORTEN = ['blokkade', 'afhankelijkheid'] as const;
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export interface ConsultancyOverzicht {
  tellingen: { projecten: number; implementaties: number; programmas: number; openBlokkades: number; openVervolgsignalen: number };
  projecten: { topicId: string; titel: string; klantId: string | null; klantNaam: string | null; eigenaarNaam: string | null; status: string; openBlokkades: number; openRisicos: number; laatsteDebrief: string | null }[];
  implementaties: { topicId: string; titel: string; klantId: string | null; klantNaam: string | null; module: string; fase: string; testStatus: string; status: string; geplandeLivegang: string | null; werkelijkeLivegang: string | null; openBlokkades: number; laatsteDebrief: string | null }[];
}

export async function bouwConsultancy(db: Db): Promise<ConsultancyOverzicht> {
  const rijen = await db.select({
    topicId: topics.id, titel: topics.titel, type: topics.type, status: topics.status, klantId: topics.klantId, klantNaam: klanten.naam, eigenaarNaam: employees.naam,
    module: implementaties.module, fase: implementaties.fase, testStatus: implementaties.testStatus, geplandeLivegang: implementaties.geplandeLivegang, werkelijkeLivegang: implementaties.werkelijkeLivegang,
  }).from(topics).leftJoin(klanten, eq(topics.klantId, klanten.id)).leftJoin(employees, eq(topics.eigenaarId, employees.id)).leftJoin(implementaties, eq(implementaties.topicId, topics.id))
    .where(ne(topics.status, 'afgerond')).orderBy(klanten.naam, topics.titel);
  // Een onderwerp met een rij in `implementaties` is een implementatie; de overige projecten zijn projecten.
  const lopend = rijen.filter((r) => r.module !== null || r.type === 'project');
  const ids = lopend.map((r) => r.topicId);
  const [punten, debriefs] = ids.length ? await Promise.all([
    db.select({ topicId: activiteiten.topicId, soort: activiteiten.soort }).from(activiteiten)
      .where(and(inArray(activiteiten.topicId, ids), eq(activiteiten.status, 'open'), eq(activiteiten.controleNodig, false), inArray(activiteiten.soort, [...OPEN_BLOKKADE_SOORTEN, 'risico']))),
    db.select({ topicId: consultantDebriefs.topicId, createdAt: consultantDebriefs.createdAt }).from(consultantDebriefs)
      .where(and(inArray(consultantDebriefs.topicId, ids), eq(consultantDebriefs.controleNodig, false))).orderBy(desc(consultantDebriefs.createdAt)),
  ]) : [[], []] as const;
  const blokkades = (id: string) => punten.filter((p) => p.topicId === id && (OPEN_BLOKKADE_SOORTEN as readonly string[]).includes(p.soort)).length;
  const laatste = (id: string) => iso(debriefs.find((d) => d.topicId === id)?.createdAt);

  const projecten = lopend.filter((r) => r.module === null).map((r) => ({
    topicId: r.topicId, titel: r.titel, klantId: r.klantId, klantNaam: r.klantNaam, eigenaarNaam: r.eigenaarNaam, status: r.status,
    openBlokkades: blokkades(r.topicId), openRisicos: punten.filter((p) => p.topicId === r.topicId && p.soort === 'risico').length, laatsteDebrief: laatste(r.topicId),
  }));
  const lopendeImplementaties = lopend.filter((r) => r.module !== null).map((r) => ({
    topicId: r.topicId, titel: r.titel, klantId: r.klantId, klantNaam: r.klantNaam, module: r.module!, fase: r.fase!, testStatus: r.testStatus!, status: r.status,
    geplandeLivegang: r.geplandeLivegang, werkelijkeLivegang: r.werkelijkeLivegang, openBlokkades: blokkades(r.topicId), laatsteDebrief: laatste(r.topicId),
  }));

  const [programmas, signalen, blokkadeRijen] = await Promise.all([
    db.select({ id: samenverderProgrammas.id }).from(samenverderProgrammas).where(eq(samenverderProgrammas.status, 'actief')),
    db.select({ id: activiteiten.id }).from(activiteiten).where(and(eq(activiteiten.soort, 'vervolgsignaal'), eq(activiteiten.status, 'open'), eq(activiteiten.controleNodig, false))),
    db.select({ id: activiteiten.id }).from(activiteiten)
      .where(and(inArray(activiteiten.soort, [...OPEN_BLOKKADE_SOORTEN]), eq(activiteiten.status, 'open'), eq(activiteiten.controleNodig, false))),
  ]);
  return {
    tellingen: { projecten: projecten.length, implementaties: lopendeImplementaties.length, programmas: programmas.length, openBlokkades: blokkadeRijen.length, openVervolgsignalen: signalen.length },
    projecten, implementaties: lopendeImplementaties,
  };
}

export function registreerConsultancy(app: FastifyInstance, db: Db) {
  app.get('/api/consultancy', async () => bouwConsultancy(db));
}
