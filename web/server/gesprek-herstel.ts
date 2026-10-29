import { and, eq, gt, inArray, isNotNull, isNull, like, lt, or, sql } from 'drizzle-orm';
import type { Db } from './db.js';
import type { LlmClient } from './llm.js';
import { logGebeurtenis } from './call-log.js';
import { zetStatus } from './gesprek-status.js';
import { calls } from './schema.js';
import { samenvattenGesprek } from './samenvatten.js';
import type { VoiceHerstel, VoiceOpzoeker } from './voice.js';

const MINUUT = 60_000;
/** Zo lang mag een gesprek in 'gepland'/'verzenden' staan voordat we bij voice navragen wat er is gebeurd. */
export const VERZENDEN_NA_MIN = 2;
/** Als voice zo lang onbereikbaar blijft, is niet meer te achterhalen of er gebeld is; dan bepaalt de beheerder of er opnieuw gebeld wordt. */
export const VERZENDEN_OPGEVEN_MIN = 30;
/** Een gesprek dat zo lang in 'belt'/'gesprek' staat zonder uitkomst, is onderbroken (een gesprek duurt hooguit enkele minuten). */
export const GEEN_UITKOMST_MIN = 45;
export const MAX_SAMENVATTING_POGINGEN = 3;
const ONDERBROKEN_PREFIX = 'Onderbroken';

/** Een agent-gesprek zonder transcript vragen we bij voice na vanaf zoveel minuten, hooguit zo vaak en niet vaker dan dit interval, tot zoveel uur na het begin. */
export const HERSTEL_VANAF_MIN = 15;
export const HERSTEL_INTERVAL_MIN = 10;
export const HERSTEL_MAX_POGINGEN = 5;
export const HERSTEL_TOT_UUR = 48;

export interface HerstelUitkomst { opgelost: number; onderbroken: number; samenvattingen: number; opgevraagd: number }

/**
 * Ruimt gesprekken op die door een crash of deploy halverwege zijn blijven staan. Veilig om op meerdere instanties tegelijk te draaien:
 * elke wijziging is een voorwaardelijke UPDATE. Het belt nooit zelf; een nieuwe poging loopt altijd via de scheduler en alleen na 'mislukt'.
 */
export async function herstelGesprekken(
  { db, llm, opzoeken, herstel, achtergrond = (t) => t }: { db: Db; llm: LlmClient; opzoeken: VoiceOpzoeker; herstel?: VoiceHerstel; achtergrond?: (t: Promise<unknown>) => Promise<unknown> | unknown },
  nu = new Date(),
): Promise<HerstelUitkomst> {
  const uitkomst: HerstelUitkomst = { opgelost: 0, onderbroken: 0, samenvattingen: 0, opgevraagd: 0 };

  // 1. Geclaimd of verzonden, maar nooit bevestigd: vraag voice wat er echt is gebeurd.
  const onbevestigd = await db.select().from(calls)
    .where(and(inArray(calls.status, ['gepland', 'verzenden']), lt(calls.statusGewijzigdOp, new Date(nu.getTime() - VERZENDEN_NA_MIN * MINUUT))));
  for (const c of onbevestigd) {
    const r = await opzoeken(c.id);
    // Onzeker (voice weet niet of de aanroep naar Twilio is gelukt) behandelen we als onbereikbaar: wachten, en uiteindelijk aan de beheerder laten.
    const zeker = r.bereikt && (!r.bekend || r.gebeld || !r.onzeker);
    if (!zeker) {
      if (c.statusGewijzigdOp.getTime() < nu.getTime() - VERZENDEN_OPGEVEN_MIN * MINUUT && await zetStatus(db, c.id, 'onderbroken', { fout: 'onzeker_of_gebeld', afgerondOp: nu }, 'herstel')) uitkomst.onderbroken++;
    } else if (!r.bekend) {
      // Voice heeft het verzoek nooit ontvangen: zeker niet gebeld, dus veilig opnieuw te proberen.
      if (await zetStatus(db, c.id, 'mislukt', { fout: 'niet_verzonden', afgerondOp: nu }, 'herstel')) uitkomst.opgelost++;
    } else if (r.gebeld) {
      if (await zetStatus(db, c.id, 'belt', { voiceCallId: r.call_id, gestartOp: c.gestartOp ?? nu }, 'herstel')) uitkomst.opgelost++;
    } else if (await zetStatus(db, c.id, 'mislukt', { fout: 'Bellen mislukt bij voice', afgerondOp: nu }, 'herstel')) uitkomst.opgelost++;
  }

  // 2. Gebeld of in gesprek, maar nooit een uitkomst ontvangen. Een late melding van voice kan dit later nog verbeteren.
  const verlopen = await db.update(calls).set({ status: 'onderbroken', fout: 'geen_uitkomst_ontvangen', afgerondOp: nu })
    .where(and(inArray(calls.status, ['belt', 'gesprek']), lt(calls.statusGewijzigdOp, new Date(nu.getTime() - GEEN_UITKOMST_MIN * MINUUT)))).returning({ id: calls.id });
  uitkomst.onderbroken += verlopen.length;
  for (const v of verlopen) await logGebeurtenis(db, v.id, 'herstel', 'status:onderbroken');

  // 3. Gesproken, maar de samenvatting is nooit gestart (proces gestopt vóór de achtergrondtaak) of eerder onderbroken.
  const kandidaten = await db.select({ id: calls.id }).from(calls).where(and(
    eq(calls.status, 'gesproken'), lt(calls.samenvattingPogingen, MAX_SAMENVATTING_POGINGEN),
    lt(calls.afgerondOp, new Date(nu.getTime() - VERZENDEN_NA_MIN * MINUUT)),
    sql`(${calls.samenvattingStatus} = 'geen' OR (${calls.samenvattingStatus} = 'mislukt' AND ${like(calls.samenvattingFout, `${ONDERBROKEN_PREFIX}%`)}))`,
  ));
  for (const k of kandidaten) {
    // Eerst de poging tellen, voorwaardelijk: een tweede instantie die hetzelfde wil, krijgt hier niets terug.
    const geteld = await db.update(calls).set({ samenvattingPogingen: sql`${calls.samenvattingPogingen} + 1` })
      .where(and(eq(calls.id, k.id), lt(calls.samenvattingPogingen, MAX_SAMENVATTING_POGINGEN))).returning({ id: calls.id });
    if (!geteld.length) continue;
    uitkomst.samenvattingen++;
    await achtergrond(samenvattenGesprek({ db, llm }, k.id));
  }

  // 4. Een agent-gesprek zonder transcript: het kan bij ElevenLabs wel bestaan (webhook te vroeg, leeg of nooit aangekomen). Voice haalt het op en
  //    meldt het via de gewone callback als 'gesproken'; die start de samenvatting en daarmee de acties en het dashboard.
  if (herstel) {
    const aandacht = and(
      eq(calls.engine, 'elevenlabs_agent'), isNull(calls.transcript), isNull(calls.transcriptGewistOp), isNotNull(calls.voiceCallId),
      inArray(calls.status, ['belt', 'gesprek', 'onderbroken', 'niet_bereikt', 'mislukt']),
      lt(calls.statusGewijzigdOp, new Date(nu.getTime() - HERSTEL_VANAF_MIN * MINUUT)),
      gt(calls.createdAt, new Date(nu.getTime() - HERSTEL_TOT_UUR * 60 * MINUUT)),
      lt(calls.herstelPogingen, HERSTEL_MAX_POGINGEN),
      or(isNull(calls.herstelLaatst), lt(calls.herstelLaatst, new Date(nu.getTime() - HERSTEL_INTERVAL_MIN * MINUUT))),
    );
    for (const k of await db.select({ id: calls.id }).from(calls).where(aandacht)) {
      // Eerst de poging tellen, voorwaardelijk: een tweede instantie die hetzelfde wil, krijgt hier niets terug.
      const geteld = await db.update(calls).set({ herstelPogingen: sql`${calls.herstelPogingen} + 1`, herstelLaatst: nu }).where(and(eq(calls.id, k.id), aandacht)).returning({ id: calls.id });
      if (!geteld.length) continue;
      uitkomst.opgevraagd++;
      await vraagHerstel(db, herstel, k.id);
    }
  }
  return uitkomst;
}

/** Vraagt voice een agent-gesprek alsnog op te halen. De uitkomst zelf komt via de callback; hier alleen een code in het verloop. */
export async function vraagHerstel(db: Db, herstel: VoiceHerstel, callId: string): Promise<string> {
  const r = await herstel(callId);
  const code = r.bereikt ? r.uitkomst : 'voice_onbereikbaar';
  await logGebeurtenis(db, callId, 'herstel', `agent_opgevraagd:${code}`);
  return code;
}
