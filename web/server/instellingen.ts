import { eq } from 'drizzle-orm';
import type { Db } from './db.js';
import { geldigProject, schoneSite, type JiraInstellingen } from './jira.js';
import { instellingen } from './schema.js';

/** Dezelfde tekst als de terugvalwaarde van de voice-service (voice/prompts.py), zodat de beheerder hem kan zien en aanpassen. */
export const STANDAARD_HOUDING = 'Je bent meedenkend, vooruitstrevend en ondersteunend. Je denkt mee over oplossingen en kijkt vooruit. '
  + 'Je stelt kritische vragen als een deadline niet is gehaald: wat is er gebeurd, wat is er nodig en wanneer wordt het wel afgerond. '
  + 'Je vraagt door naar weerstanden, bij mensen, klanten of in de organisatie, en je vraagt hoe we dit de volgende keer kunnen voorkomen. '
  + 'Je denkt proactief mee over de volgende stap: hoor je een taak of afspraak, dan vraag je naar het doel en wat de collega nodig heeft, en bied je hulp aan waar dat past. '
  + 'Je blijft respectvol: kritisch op de zaak, nooit op de persoon.';

/** Wat de assistent in een gesprek doet, als een planning geen eigen instructie heeft. De vaste regels (onderwerpen langslopen, eindvragen, grenzen) staan in de voice-service. */
export const STANDAARD_INSTRUCTIE = 'Wees proactief: kijk vooruit en vraag zelf naar wat de collega nog niet noemt, zoals risico\'s, afhankelijkheden, wie of wat het werk kan ophouden en of er hulp nodig is.\n'
  + 'Maak het gesprek per onderwerp concreet met een vervolgactie: wat gaat er gebeuren, wie doet dat en wanneer? Noem de afspraak aan het eind kort terug, bijvoorbeeld "Dan stuur jij de offerte vrijdag, klopt dat?".\n'
  + 'Staat bij een onderwerp een punt waarvan de deadline is verstreken, begin daar dan mee. Vraag zonder verwijt wat er is gebeurd, waar het is blijven steken en wat er nodig is. Spreek daarna een nieuwe datum af.\n'
  + 'Dat dezelfde dingen blijven liggen of dat iemand of iets tegenwerkt is belangrijk om te weten: vraag door naar de weerstand en vraag hoe we dit kunnen voorkomen.';

export type Instelling = { waarde: string; standaard: boolean };

async function lees(db: Db, sleutel: string, standaard: string): Promise<Instelling> {
  const [rij] = await db.select().from(instellingen).where(eq(instellingen.sleutel, sleutel));
  return rij?.waarde.trim() ? { waarde: rij.waarde, standaard: false } : { waarde: standaard, standaard: true };
}

/** Een lege tekst zet de standaard terug. */
async function bewaar(db: Db, sleutel: string, waarde: string): Promise<void> {
  if (!waarde.trim()) { await db.delete(instellingen).where(eq(instellingen.sleutel, sleutel)); return; }
  await db.insert(instellingen).values({ sleutel, waarde: waarde.trim() })
    .onConflictDoUpdate({ target: instellingen.sleutel, set: { waarde: waarde.trim(), bijgewerktOp: new Date() } });
}

export const leesHouding = (db: Db) => lees(db, 'houding', STANDAARD_HOUDING);
export const bewaarHouding = (db: Db, waarde: string) => bewaar(db, 'houding', waarde);
export const leesInstructie = (db: Db) => lees(db, 'gespreksinstructie', STANDAARD_INSTRUCTIE);
export const bewaarInstructie = (db: Db, waarde: string) => bewaar(db, 'gespreksinstructie', waarde);

export const MOTOREN = ['pipecat', 'elevenlabs_agent'] as const;
export type Motor = (typeof MOTOREN)[number];

/** Welke gespreksmotor een gesprek gebruikt als er niets anders is gekozen. Onbekende of lege waarden betekenen Pipecat. */
export async function leesGespreksmotor(db: Db): Promise<Motor> {
  const { waarde } = await lees(db, 'gespreksmotor', 'pipecat');
  return (MOTOREN as readonly string[]).includes(waarde) ? (waarde as Motor) : 'pipecat';
}
export const bewaarGespreksmotor = (db: Db, motor: Motor) => bewaar(db, 'gespreksmotor', motor === 'pipecat' ? '' : motor);

/** Waar Jira-tickets heen gaan. De inloggegevens staan niet hier maar in omgevingsvariabelen. */
export async function leesJira(db: Db): Promise<JiraInstellingen | null> {
  const { waarde } = await lees(db, 'jira', '');
  try {
    const j = JSON.parse(waarde) as Partial<JiraInstellingen>;
    return schoneSite(j.site ?? '') && geldigProject(j.project ?? '') && j.issuetype ? { site: j.site!, project: j.project!, issuetype: j.issuetype } : null;
  } catch { return null; }
}
export const bewaarJira = (db: Db, i: JiraInstellingen | null) => bewaar(db, 'jira', i ? JSON.stringify(i) : '');
