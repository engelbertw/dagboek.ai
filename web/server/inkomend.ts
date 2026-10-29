import { and, eq, gt, sql } from 'drizzle-orm';
import type { Db } from './db.js';
import { logGebeurtenis } from './call-log.js';
import { leesHouding, leesInstructie, type Motor } from './instellingen.js';
import { stelOnderwerpenSamen } from './gesprek-starten.js';
import { log } from './log.js';
import { calls, employees } from './schema.js';
import type { Onderwerp } from './voice.js';

/** Zoveel inkomende gesprekken per medewerker per uur; daarboven weigeren we, tegen misbruik van een vervalst nummer en tegen kosten. */
export const INKOMEND_MAX_PER_UUR = 5;

/** Nederlands nummer naar +31…, dezelfde regels als de voice-service. Onbekende vormen blijven leeg, zodat ze nooit met een medewerker overeenkomen. */
export function normaliseerNummer(ruw: string): string {
  const cijfers = (ruw ?? '').replace(/[\s\-().]/g, '');
  const m = /^(?:\+31|0031|0)(6\d{8}|[1-9]\d{7,8})$/.exec(cijfers);
  return m ? `+31${m[1]}` : '';
}

export type InkomendUitkomst =
  | { ok: true; callId: string; medewerker: string; onderwerpen: Onderwerp[]; toestemmingNodig: boolean; houding: string; instructie: string }
  | { ok: false; reden: 'onbekend_nummer' | 'te_vaak' };

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
  const { onderwerpen, momentopname } = await stelOnderwerpenSamen(db, m.id);
  const instructie = (await leesInstructie(db)).waarde;
  const [call] = await db.insert(calls).values({
    employeeId: m.id, status: 'gesprek', bron: 'inkomend', onderwerpen: momentopname, instructie, engine: motor, gestartOp: new Date(),
  }).returning();
  await logGebeurtenis(db, call.id, 'voice', 'claim:inkomend');
  log('info', 'gesprek.inkomend', { correlatieId: call.id });
  return { ok: true, callId: call.id, medewerker: m.naam, onderwerpen, toestemmingNodig: !m.toestemmingOp, houding: (await leesHouding(db)).waarde, instructie };
}
