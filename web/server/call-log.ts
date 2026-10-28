import type { Db } from './db.js';
import { callLog } from './schema.js';

/** Eén regel in het verloop van een gesprek: alleen een code en tijd, nooit inhoud of foutmeldingen. */
export async function logGebeurtenis(db: Db, callId: string, bron: 'web' | 'voice' | 'scheduler' | 'herstel' | 'beheer', gebeurtenis: string): Promise<void> {
  try {
    await db.insert(callLog).values({ callId, bron, gebeurtenis: gebeurtenis.slice(0, 80) });
  } catch {
    // Het verloop is hulpmiddel: een mislukte logregel mag het gesprek nooit blokkeren.
  }
}
