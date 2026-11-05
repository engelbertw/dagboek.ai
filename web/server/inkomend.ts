import { and, eq, gt, sql } from 'drizzle-orm';
import type { Db } from './db.js';
import { logGebeurtenis } from './call-log.js';
import { begroetingVoor, leesHouding, type Motor } from './instellingen.js';
import { beschikbareVarianten, gespreksOpzet, routeVoor, type Voorstel } from './gespreks-opzet.js';
import { stelOnderwerpenSamen } from './gesprek-starten.js';
import { log } from './log.js';
import { calls, employees, type DebriefVariant, type GesprekType } from './schema.js';
import type { Onderwerp } from './voice.js';

/** Zoveel inkomende gesprekken per medewerker per uur; daarboven weigeren we, tegen misbruik van een vervalst nummer en tegen kosten. */
export const INKOMEND_MAX_PER_UUR = Number(process.env.INKOMEND_MAX_PER_UUR ?? 5) || 5;

/** Nederlands nummer naar +31…, dezelfde regels als de voice-service. Onbekende vormen blijven leeg, zodat ze nooit met een medewerker overeenkomen. */
export function normaliseerNummer(ruw: string): string {
  const cijfers = (ruw ?? '').replace(/[\s\-().]/g, '');
  const m = /^(?:\+31|0031|0)(6\d{8}|[1-9]\d{7,8})$/.exec(cijfers);
  return m ? `+31${m[1]}` : '';
}

export type { GesprekType };

export type InkomendUitkomst =
  | { ok: true; callId: string; medewerker: string; onderwerpen: Onderwerp[]; toestemmingNodig: boolean; houding: string; instructie: string; type: GesprekType; varianten: DebriefVariant[]; voorstel: Voorstel | null; begroeting: Partial<Record<string, string>> }
  | { ok: false; reden: 'onbekend_nummer' | 'te_vaak' };

export type { Voorstel };

/** Start de administratie van een gesprek waarbij de medewerker zelf belt. De beller wordt alleen herkend aan het nummer; er wordt geen nummer bewaard. */
export async function startInkomendGesprek(db: Db, beller: string, motor: Motor): Promise<InkomendUitkomst> {
  const nummer = normaliseerNummer(beller);
  const actieven = nummer ? await db.select().from(employees).where(eq(employees.actief, true)) : [];
  const treffers = actieven.filter((m) => normaliseerNummer(m.telefoon) === nummer);
  // Twee medewerkers op één nummer (bijvoorbeeld een gedeeld toestel): niet raden wie er belt.
  if (treffers.length !== 1) return { ok: false, reden: 'onbekend_nummer' };
  const m = treffers[0];
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(calls)
    .where(and(eq(calls.employeeId, m.id), eq(calls.bron, 'inkomend'), gt(calls.createdAt, new Date(Date.now() - 3600_000))));
  if (n >= INKOMEND_MAX_PER_UUR) return { ok: false, reden: 'te_vaak' };
  // Een accountmanager belt voor een verkoop-debrief, een consultant voor een consultantdebrief; wie beide is kiest in het gesprek (en dat wordt achteraf bewezen).
  // Voor ieder ander, en zolang de consultantroute uit staat of nog geen variant heeft, blijft alles zoals het was.
  const varianten = await beschikbareVarianten(db);
  const type = routeVoor(m, varianten);
  const debrief = type !== 'dagboek';
  const { onderwerpen, momentopname } = debrief ? { onderwerpen: [], momentopname: [] } : await stelOnderwerpenSamen(db, m.id);
  const { instructie, toestemmingNodig, voorstel, context } = await gespreksOpzet(db, m, type, varianten);
  const [call] = await db.insert(calls).values({
    employeeId: m.id, status: 'gesprek', bron: 'inkomend', type, onderwerpen: momentopname, instructie, engine: motor, gestartOp: new Date(), ...(context ? { context } : {}),
  }).returning();
  await logGebeurtenis(db, call.id, 'voice', 'claim:inkomend');
  log('info', 'gesprek.inkomend', { correlatieId: call.id, type });
  return { ok: true, callId: call.id, medewerker: m.naam, onderwerpen, toestemmingNodig, houding: (await leesHouding(db)).waarde, instructie, type, varianten: varianten.map((v) => v.id), voorstel, begroeting: await begroetingVoor(db, type) };
}
