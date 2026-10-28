import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { logGebeurtenis } from './call-log.js';
import type { Db } from './db.js';
import { foutcode, log } from './log.js';
import { calls, opschoningRuns } from './schema.js';

/**
 * Wist transcripten (en de ruwe uitvoer van het taalmodel) van gesprekken waarvan de bewaartermijn voorbij is: de uiterste datum bij
 * ontbrekende toestemming, anders de standaardtermijn. De samenvattingen in het dagboek blijven staan. Een gesprek waarvan de
 * samenvatting nog loopt wordt overgeslagen. Elk gewist transcript krijgt een tijdstip als bewijs.
 */
export async function ruimTranscriptenOp(db: Db, dagen: number, nu = new Date()): Promise<number> {
  if (!Number.isFinite(dagen) || dagen < 1) return 0;
  const grens = new Date(nu.getTime() - dagen * 86_400_000);
  const rijen = await db.update(calls)
    .set({ transcript: null, samenvattingRuw: null, transcriptGewistOp: nu })
    .where(and(
      // Een uiterste bewaardatum (zonder bevestigde toestemming) gaat voor; zonder datum geldt de standaard bewaartermijn.
      sql`(${calls.transcriptBewarenTot} < ${nu} or (${calls.transcriptBewarenTot} is null and coalesce(${calls.afgerondOp}, ${calls.createdAt}) < ${grens}))`,
      ne(calls.samenvattingStatus, 'bezig'),
      sql`(${calls.transcript} is not null or ${calls.samenvattingRuw} is not null)`,
    )).returning({ id: calls.id });
  for (const r of rijen) await logGebeurtenis(db, r.id, 'beheer', 'transcript:gewist_bewaartermijn');
  return rijen.length;
}

/** Eén opschoonronde, met een registratie van het resultaat. Een fout wordt vastgelegd als code (nooit de melding) en niet doorgegeven. */
export async function voerOpschoningUit(db: Db, dagen: number, nu = new Date()): Promise<{ status: 'ok' | 'mislukt'; gewist: number }> {
  try {
    const gewist = await ruimTranscriptenOp(db, dagen, nu);
    await db.insert(opschoningRuns).values({ bron: 'web', gestartOp: nu, klaarOp: new Date(), status: 'ok', gewist });
    if (gewist) log('info', 'opschoning.gewist', { gewist, dagen });
    return { status: 'ok', gewist };
  } catch (e) {
    log('error', 'opschoning.mislukt', { foutcode: foutcode(e) });
    try { await db.insert(opschoningRuns).values({ bron: 'web', gestartOp: nu, klaarOp: new Date(), status: 'mislukt', mislukt: 1, foutcode: foutcode(e) }); } catch { /* database onbereikbaar: de volgende ronde registreert weer */ }
    return { status: 'mislukt', gewist: 0 };
  }
}

export interface OpschoningStatus {
  laatsteWeb: { status: string; klaarOp: Date | null } | null;
  laatsteVoice: { status: string; klaarOp: Date | null; mislukt: number } | null;
  achterstand: number;
  waarschuwingen: string[];
}

const DAG = 86_400_000;

/** Wat de beheerder moet weten over de bewaartermijnen: draait de opschoning, mislukt er iets, en staat er nog iets dat al weg had gemoeten? */
export async function opschoningStatus(db: Db, dagen: number, nu = new Date()): Promise<OpschoningStatus> {
  const laatste = async (bron: 'web' | 'voice') => (await db.select().from(opschoningRuns).where(eq(opschoningRuns.bron, bron)).orderBy(desc(opschoningRuns.gestartOp)).limit(1))[0];
  const [web, voice] = [await laatste('web'), await laatste('voice')];
  const grens = new Date(nu.getTime() - dagen * DAG);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(calls).where(and(
    sql`(${calls.transcriptBewarenTot} < ${nu} or (${calls.transcriptBewarenTot} is null and coalesce(${calls.afgerondOp}, ${calls.createdAt}) < ${grens}))`,
    sql`(${calls.transcript} is not null or ${calls.samenvattingRuw} is not null)`,
    ne(calls.samenvattingStatus, 'bezig'),
    // Net verlopen transcripten krijgen de volgende ronde de kans; pas daarna is het een achterstand.
    sql`coalesce(${calls.transcriptBewarenTot}, ${calls.afgerondOp}, ${calls.createdAt}) < ${new Date(nu.getTime() - 7 * 3_600_000)}`,
  ));
  const w: string[] = [];
  if (!web || !web.klaarOp || nu.getTime() - web.klaarOp.getTime() > DAG) w.push('De opschoning van transcripten heeft de afgelopen 24 uur niet gedraaid.');
  else if (web.status !== 'ok') w.push('De laatste opschoning van transcripten is mislukt; er wordt automatisch opnieuw geprobeerd.');
  if (n > 0) w.push(`${n} transcript${n === 1 ? '' : 'en'} ${n === 1 ? 'staat' : 'staan'} nog bewaard terwijl de bewaartermijn voorbij is.`);
  if (voice && (voice.mislukt > 0 || voice.status === 'mislukt')) w.push('De opschoning van de voice-service meldt dat niet alles gewist kon worden.');
  if (voice?.klaarOp && nu.getTime() - voice.klaarOp.getTime() > DAG) w.push('De voice-service heeft de afgelopen 24 uur geen opschoning gemeld.');
  return {
    laatsteWeb: web ? { status: web.status, klaarOp: web.klaarOp } : null,
    laatsteVoice: voice ? { status: voice.status, klaarOp: voice.klaarOp, mislukt: voice.mislukt } : null,
    achterstand: n, waarschuwingen: w,
  };
}
