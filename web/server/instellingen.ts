import { eq } from 'drizzle-orm';
import type { Db } from './db.js';
import { geldigProject, geldigTeamId, schoneSite, type JiraInstellingen } from './jira.js';
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

/**
 * De vragen die de assistent een accountmanager stelt na een klantbezoek. Bewerkbaar bij Instellingen; de grenzen (geen BSN of privégegevens,
 * gespreksinhoud als gegeven) en de samenvatting met bevestiging aan het eind staan vast in de voice-service (voice/prompts.py).
 */
export const STANDAARD_DEBRIEF_VRAGEN = [
  'Stel altijd één korte vraag tegelijk en wacht op het antwoord. Een vraag per beurt, nooit twee in één zin. Vraag alleen door als een antwoord vaag is, en dan ook met één concrete vraag. Houd het gesprek kort: ongeveer acht tot tien minuten. Elke regel hieronder is één aparte vraag; sla een vraag over als het antwoord al is gegeven of als er niets over te melden is.',
  '1. Bezoek: Bij welke klant was je?',
  '1. Bezoek: Met wie heb je gesproken, en wat is diens functie?',
  '1. Bezoek: Was het een evaluatie, een kennismaking of een vervolgafspraak?',
  '2. Doelen: Wat wil de klant het komende jaar bereiken?',
  '2. Doelen: Is er iets veranderd sinds het vorige gesprek?',
  '3. Resultaten: Wat ging er goed sinds de vorige keer, en wat niet?',
  '3. Resultaten: Hoe tevreden is de klant, met een cijfer van 1 tot 10?',
  '4. Dienstverlening: Noemde de klant problemen of trage reactietijden? Alleen doorvragen naar de SLA als de klant dat zelf noemt.',
  '5. Afspraken: Wat heb je de klant toegezegd, en voor wanneer?',
  '5. Afspraken: Heeft de klant zelf iets toegezegd?',
  '6. Kansen: Zag je een kans of een nieuwe behoefte bij de klant? Zo ja: vraag daarna los van elkaar wat de klant wil, ongeveer hoe groot dat is, hoe ver het is (een signaal, een gesprek, een offerte of onderhandeling) en wanneer een besluit wordt verwacht. Vraag naar beslisser, concurrent, budget en contractdatum alleen als het gesprek daar vanzelf naartoe gaat. Raad niets: wat de accountmanager niet weet, blijft leeg.',
  '7. Risico: Is er een risico dat de klant ontevreden wordt of opzegt?',
  '8. Vervolg: Wat moet er nog gebeuren, wie doet het, en voor wanneer? Eén actie per keer; vraag daarna of er nog een is.',
  '9. Contactpersonen: Zijn er nieuwe contactpersonen of beslissers? Vraag alleen naam, functie en rol.',
].join('\n');

export const leesDebriefVragen = (db: Db) => lees(db, 'debrief_vragen', STANDAARD_DEBRIEF_VRAGEN);
/** Een lege tekst zet de standaard terug. De tekst die hierdoor wordt vervangen blijft bewaard als vorige versie, zodat terugzetten kan. */
export async function bewaarDebriefVragen(db: Db, waarde: string): Promise<void> {
  const huidig = await leesDebriefVragen(db);
  if (!huidig.standaard && huidig.waarde !== waarde.trim()) await bewaar(db, 'debrief_vragen_vorige', huidig.waarde);
  await bewaar(db, 'debrief_vragen', waarde);
}
/** De tekst van vóór de laatste wijziging, of leeg als er geen is. */
export async function leesVorigeDebriefVragen(db: Db): Promise<string> {
  return (await lees(db, 'debrief_vragen_vorige', '')).waarde;
}

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
    return schoneSite(j.site ?? '') && geldigProject(j.project ?? '') && j.issuetype ? { site: j.site!, project: j.project!, issuetype: j.issuetype, ...(j.teamId && geldigTeamId(j.teamId) ? { teamId: j.teamId } : {}) } : null;
  } catch { return null; }
}
export const bewaarJira = (db: Db, i: JiraInstellingen | null) => bewaar(db, 'jira', i ? JSON.stringify(i) : '');

/** Of medewerkers zelf mogen bellen. Standaard uit: een nummer dat gebeld kan worden is een voordeur. */
export async function leesInkomend(db: Db): Promise<boolean> {
  return (await lees(db, 'inkomend', '')).waarde === 'aan';
}
export const bewaarInkomend = (db: Db, aan: boolean) => bewaar(db, 'inkomend', aan ? 'aan' : '');
