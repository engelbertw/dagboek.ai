import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from './db.js';
import { leesHouding, leesInstructie } from './instellingen.js';
import { calls, employees, openItems, projects, schedules, topics, updates, type GespreksOnderwerp } from './schema.js';
import { vandaagNL } from './samenvatten.js';
import { puntenVoorGesprek } from './voor-gesprek.js';
import { zetStatus } from './gesprek-status.js';
import type { Onderwerp, VoiceClient } from './voice.js';

export interface PlanningInfo { scheduleId: string; slotStart: Date; poging: number }
export type StartUitkomst =
  | { ok: true; callId: string; onderwerpen: number }
  | { ok: false; status: 404 | 409 | 502; fout: string; callId?: string };

/** Stelt de onderwerpen van een medewerker samen en start het gesprek. Gebruikt door 'Bel nu' en door de scheduler. */
export async function startGesprek({ db, voice }: { db: Db; voice: VoiceClient }, employeeId: string, planning?: PlanningInfo): Promise<StartUitkomst> {
  const [m] = await db.select().from(employees).where(eq(employees.id, employeeId));
  if (!m) return { ok: false, status: 404, fout: 'Medewerker niet gevonden' };
  if (!m.actief) return { ok: false, status: 409, fout: 'Deze medewerker is niet actief' };
  const mijnTopics = await db.select({ t: topics, projectNaam: projects.naam }).from(topics)
    .leftJoin(projects, eq(topics.projectId, projects.id)).where(and(eq(topics.eigenaarId, employeeId), eq(topics.status, 'actief'))).orderBy(asc(topics.createdAt));
  const onderwerpen: Onderwerp[] = [];
  const momentopname: GespreksOnderwerp[] = [];
  for (const { t, projectNaam } of mijnTopics) {
    const [laatste] = await db.select().from(updates).where(eq(updates.topicId, t.id)).orderBy(desc(updates.createdAt)).limit(1);
    const open = await db.select({
      id: openItems.id, tekst: openItems.tekst, deadline: openItems.deadline, eigenaarId: openItems.eigenaarId,
      eigenaarNaam: employees.naam, eigenaarExtern: openItems.eigenaarExtern,
    }).from(openItems).leftJoin(employees, eq(openItems.eigenaarId, employees.id))
      .where(and(eq(openItems.topicId, t.id), eq(openItems.status, 'open'))).orderBy(asc(openItems.createdAt));
    const punten = puntenVoorGesprek(open, vandaagNL(), employeeId);
    onderwerpen.push({
      titel: t.titel, project: projectNaam ?? undefined, aanwijzingen: t.aanwijzingen || undefined,
      laatste_update: laatste?.samenvatting, laatste_update_datum: laatste?.createdAt.toISOString().slice(0, 10),
      open_punten: punten.open, te_laat_punten: punten.teLaat,
    });
    momentopname.push({ id: t.id, titel: t.titel, openPunten: open.map((o) => ({ id: o.id, tekst: o.tekst })) });
  }
  // De planning bepaalt de instructie; heeft die er geen (of 'Bel nu'), dan geldt de algemene instructie uit Instellingen.
  const [pl] = planning ? await db.select({ i: schedules.gespreksinstructie }).from(schedules).where(eq(schedules.id, planning.scheduleId)) : [];
  const instructie = pl?.i?.trim() || (await leesInstructie(db)).waarde;
  // Bij een geplande poging is de unieke index de claim: zo start een herstart of tweede proces nooit hetzelfde gesprek dubbel.
  const [call] = await db.insert(calls).values({
    employeeId, status: 'gepland', bron: planning ? 'schema' : 'handmatig', onderwerpen: momentopname, instructie,
    ...(planning ? { scheduleId: planning.scheduleId, slotStart: planning.slotStart, poging: planning.poging } : {}),
  }).onConflictDoNothing().returning();
  if (!call) return { ok: false, status: 409, fout: 'Dit gesprek is al gestart' };

  // Vlak vóór de aanroep naar 'verzenden': vanaf hier is niet meer zeker of er gebeld is, ook als het antwoord uitblijft.
  if (!(await zetStatus(db, call.id, 'verzenden'))) return { ok: false, status: 409, fout: 'Dit gesprek is al gestart', callId: call.id };
  const resultaat = await voice({
    telefoonnummer: m.telefoon, medewerker: m.naam, onderwerpen, toestemming_nodig: !m.toestemmingOp, web_call_id: call.id, houding: (await leesHouding(db)).waarde, instructie,
  });
  if (!resultaat.gebeld) {
    // Bij een onzekere uitkomst (time-out) blijft de status 'verzenden': het herstel vraagt voice later wat er echt is gebeurd en belt nooit blind opnieuw.
    if (!resultaat.onzeker) await zetStatus(db, call.id, 'mislukt', { fout: resultaat.reden, afgerondOp: new Date() });
    return { ok: false, status: 502, fout: resultaat.reden, callId: call.id };
  }
  // Een snellere melding van voice ('gesprek', 'gesproken') wordt hierdoor niet teruggedraaid.
  await zetStatus(db, call.id, 'belt', { voiceCallId: resultaat.call_id, gestartOp: new Date() });
  return { ok: true, callId: call.id, onderwerpen: onderwerpen.length };
}
