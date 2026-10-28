import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './db.js';
import { calls } from './schema.js';

export type GesprekStatus = (typeof calls.$inferSelect)['status'];

export const EINDSTATUSSEN: GesprekStatus[] = ['gesproken', 'niet_bereikt', 'voicemail', 'mislukt', 'onderbroken'];
/** Statussen waarin een gesprek nog loopt of onderweg is; wie hierin zit, wordt niet nogmaals gebeld. */
export const LOPENDE_STATUSSEN: GesprekStatus[] = ['gepland', 'verzenden', 'belt', 'gesprek'];

const UITKOMSTEN: GesprekStatus[] = ['gesproken', 'niet_bereikt', 'voicemail', 'mislukt', 'onderbroken'];

/**
 * Toegestane overgangen (van → naar). Dezelfde regels dwingt de database af met de trigger in migratie 010.
 * Een late 'gesproken' mag een eerdere mislukte uitkomst vervangen (voicemailherkenning kan zich vergissen), maar niets overschrijft 'gesproken'.
 */
export const OVERGANGEN: Record<GesprekStatus, GesprekStatus[]> = {
  gepland: ['verzenden', 'belt', 'gesprek', ...UITKOMSTEN],
  verzenden: ['belt', 'gesprek', ...UITKOMSTEN],
  belt: ['gesprek', ...UITKOMSTEN],
  gesprek: UITKOMSTEN,
  gesproken: [],
  niet_bereikt: ['gesproken'],
  voicemail: ['gesproken'],
  mislukt: ['gesproken'],
  onderbroken: ['gesproken'],
};

export const toegestaan = (van: GesprekStatus, naar: GesprekStatus) => OVERGANGEN[van].includes(naar);

const VORIGE = (naar: GesprekStatus) => (Object.keys(OVERGANGEN) as GesprekStatus[]).filter((van) => toegestaan(van, naar));

type Velden = Partial<Omit<typeof calls.$inferInsert, 'id' | 'status'>>;

/**
 * Compare-and-set: de status verandert alleen als de huidige status een geldige voorganger is, in één UPDATE
 * (geen lees-dan-schrijf). Geeft false terug als de overgang niet (meer) mag, bijvoorbeeld bij een dubbele of te late melding.
 */
export async function zetStatus(db: Db, id: string, naar: GesprekStatus, velden: Velden = {}): Promise<boolean> {
  const rijen = await db.update(calls).set({ ...velden, status: naar })
    .where(and(eq(calls.id, id), inArray(calls.status, VORIGE(naar)))).returning({ id: calls.id });
  return rijen.length > 0;
}
