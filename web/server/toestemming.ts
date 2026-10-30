import { eq } from 'drizzle-orm';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { calls, employees, toestemmingen } from './schema.js';

/** Versie van de toestemmingsvraag die in de begroeting wordt gesteld (voice/prompts.py: greeting_text). Bij een andere formulering ophogen. */
export const TOESTEMMING_VERSIE = 'dagboek-v1';
export const TOESTEMMING_DOEL = 'samenvatting_dagboek';
/** De verkoop-debrief legt zijn toestemming onder een eigen doel en versie vast (voice/prompts.py: greeting_text met soort 'verkoop_debrief'). */
export const TOESTEMMING_DEBRIEF = { doel: 'verkoop_debrief', versie: 'debrief-v1' } as const;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface Besluit {
  employeeId: string;
  besluit: 'gegeven' | 'geweigerd' | 'ingetrokken';
  bron: 'gesprek' | 'beheerder';
  callId?: string;
  citaat?: string;
  /** Standaard het dagboek; zie TOESTEMMING_DEBRIEF. */
  doel?: string;
  versie?: string;
}

/**
 * Legt een toestemmingsbesluit vast in het register en past de afgeleide stand (employees.toestemming_op) aan.
 * Een besluit voor hetzelfde gesprek wordt niet dubbel vastgelegd.
 */
export async function leggToestemmingVast(tx: Db | Tx, b: Besluit, nu = new Date()): Promise<void> {
  const ingevoegd = await tx.insert(toestemmingen).values({
    employeeId: b.employeeId, besluit: b.besluit, bron: b.bron, callId: b.callId ?? null, versie: b.versie ?? TOESTEMMING_VERSIE, doel: b.doel ?? TOESTEMMING_DOEL,
    citaat: b.besluit === 'gegeven' ? (b.citaat ?? '').slice(0, 300) || null : null, vastgelegdOp: nu,
  }).onConflictDoNothing().returning({ id: toestemmingen.id });
  if (!ingevoegd.length) return;
  if (b.besluit === 'gegeven') {
    const [m] = await tx.select({ op: employees.toestemmingOp }).from(employees).where(eq(employees.id, b.employeeId));
    if (m && !m.op) await tx.update(employees).set({ toestemmingOp: nu }).where(eq(employees.id, b.employeeId));
  } else if (b.besluit === 'ingetrokken') {
    await tx.update(employees).set({ toestemmingOp: null }).where(eq(employees.id, b.employeeId));
  }
}

/**
 * Bepaalt bij de binnenkomst van een gesprek hoe lang het transcript mag blijven. Is er (nog) geen toestemming bekend, of is het gesprek
 * niet normaal afgerond, dan bewaren we het hooguit `transcriptOnbevestigdUren`; de samenvatting kan dat daarna opheffen.
 * null betekent: de standaard bewaartermijn.
 */
export async function bepaalBewaartermijn(db: Db, config: Pick<Config, 'transcriptOnbevestigdUren'>, callId: string, status: string, nu = new Date()): Promise<void> {
  const [rij] = await db.select({ op: employees.toestemmingOp }).from(calls).innerJoin(employees, eq(employees.id, calls.employeeId)).where(eq(calls.id, callId));
  const bekend = !!rij?.op && status === 'gesproken';
  await db.update(calls).set({
    toestemmingStatus: rij?.op ? 'niet_nodig' : 'onbekend',
    transcriptBewarenTot: bekend ? null : new Date(nu.getTime() + config.transcriptOnbevestigdUren * 3_600_000),
  }).where(eq(calls.id, callId));
}
