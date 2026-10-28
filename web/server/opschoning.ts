import { and, ne, sql } from 'drizzle-orm';
import type { Db } from './db.js';
import { calls } from './schema.js';

/**
 * Wist transcripten (en de ruwe uitvoer van het taalmodel) van gesprekken die ouder zijn dan de bewaartermijn.
 * De samenvattingen in het dagboek blijven staan. Een gesprek waarvan de samenvatting nog loopt wordt overgeslagen.
 */
export async function ruimTranscriptenOp(db: Db, dagen: number, nu = new Date()): Promise<number> {
  if (!Number.isFinite(dagen) || dagen < 1) return 0;
  const grens = new Date(nu.getTime() - dagen * 86_400_000);
  const rijen = await db.update(calls)
    .set({ transcript: null, samenvattingRuw: null })
    .where(and(
      // Een uiterste bewaardatum (zonder bevestigde toestemming) gaat voor; zonder datum geldt de standaard bewaartermijn.
      sql`(${calls.transcriptBewarenTot} < ${nu} or (${calls.transcriptBewarenTot} is null and coalesce(${calls.afgerondOp}, ${calls.createdAt}) < ${grens}))`,
      ne(calls.samenvattingStatus, 'bezig'),
      sql`(${calls.transcript} is not null or ${calls.samenvattingRuw} is not null)`,
    )).returning({ id: calls.id });
  return rijen.length;
}
