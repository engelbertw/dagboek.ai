import { eq } from 'drizzle-orm';
import type { Db } from './db.js';
import { instellingen } from './schema.js';

/** Dezelfde tekst als de terugvalwaarde van de voice-service (voice/prompts.py), zodat de beheerder hem kan zien en aanpassen. */
export const STANDAARD_HOUDING = 'Je bent meedenkend, vooruitstrevend en ondersteunend. Je denkt mee over oplossingen en kijkt vooruit. '
  + 'Je stelt kritische vragen als een deadline niet is gehaald: wat is er gebeurd, wat is er nodig en wanneer wordt het wel afgerond. '
  + 'Je vraagt door naar weerstanden, bij mensen, klanten of in de organisatie, en je vraagt hoe we dit de volgende keer kunnen voorkomen. '
  + 'Je blijft respectvol: kritisch op de zaak, nooit op de persoon.';

export async function leesHouding(db: Db): Promise<{ waarde: string; standaard: boolean }> {
  const [rij] = await db.select().from(instellingen).where(eq(instellingen.sleutel, 'houding'));
  return rij?.waarde.trim() ? { waarde: rij.waarde, standaard: false } : { waarde: STANDAARD_HOUDING, standaard: true };
}

/** Een lege tekst zet de standaard terug. */
export async function bewaarHouding(db: Db, waarde: string): Promise<void> {
  if (!waarde.trim()) { await db.delete(instellingen).where(eq(instellingen.sleutel, 'houding')); return; }
  await db.insert(instellingen).values({ sleutel: 'houding', waarde: waarde.trim() })
    .onConflictDoUpdate({ target: instellingen.sleutel, set: { waarde: waarde.trim(), bijgewerktOp: new Date() } });
}
