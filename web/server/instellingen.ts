import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './db.js';
import { geldigProject, geldigTeamId, schoneSite, type JiraInstellingen } from './jira.js';
import { instellingen } from './schema.js';
import { leesWoordenlijstTekst, woordenlijstSchema, type Woord } from './woordenlijst.js';

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
  'Dit is een lijst om na te lopen wat er nog ontbreekt, geen volgorde en geen vragenlijst die je afwerkt. De accountmanager vertelt eerst vrij; streep daarna af wat al is gezegd, ook als het in andere woorden of tussendoor is gezegd, en vraag alleen naar wat echt ontbreekt. Stel altijd één korte vraag tegelijk en wacht op het antwoord, nooit twee in één zin. Vraag alleen door als een antwoord vaag is, en dan ook met één concrete vraag. Sla een onderdeel over als het antwoord al is gegeven of als er niets over te melden is. Houd het kort: ongeveer vijf tot acht minuten, en stop met aanvullen zodra de kern er is (klant, afspraken, acties, kans of risico).',
  'KERN (altijd aanwezig in het verslag):',
  '1. Bezoek: bij welke klant, met wie (naam en functie), en wat voor gesprek het was (evaluatie, kennismaking of vervolg).',
  '2. Afspraken: wat jij de klant hebt toegezegd en voor wanneer, en wat de klant zelf heeft toegezegd.',
  '3. Vervolg: wat er nog moet gebeuren, wie het doet en voor wanneer. Eén actie per keer; vraag daarna of er nog een is.',
  '4. Kans of risico: zag je een kans of nieuwe behoefte, of is er een risico dat de klant ontevreden wordt of opzegt? Bij een kans: vraag daarna los van elkaar wat de klant wil, ongeveer hoe groot dat is, hoe ver het is (een signaal, een gesprek, een offerte of onderhandeling) en wanneer een besluit wordt verwacht. Vraag naar beslisser, concurrent, budget en contractdatum alleen als het gesprek daar vanzelf naartoe gaat. Raad niets: wat de accountmanager niet weet, blijft leeg.',
  'AANVULLEND (alleen als het gesprek daar aanleiding toe geeft of het verhaal er al deels over ging):',
  '5. Doelen en resultaten: wat de klant het komende jaar wil bereiken, wat er goed of slecht ging sinds de vorige keer, en een tevredenheidscijfer van 1 tot 10 als dat nog niet is genoemd.',
  '6. Dienstverlening: alleen als de klant problemen of trage reactietijden noemde; vraag alleen naar de SLA als de klant daar zelf over begint.',
  '7. Eerdere acties: zijn afspraken of acties van eerder klaar of anders gaan lopen? Laat de accountmanager ze in eigen woorden noemen; lees niets voor.',
  '8. Contactpersonen: alleen vragen naar nieuwe contactpersonen of beslissers als er een genoemd is zonder functie of rol. Vraag alleen naam, functie en rol.',
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

/** De woordenlijst met producten en afdelingen (JSON in de instellingen). De lijst van vóór de laatste wijziging blijft bewaard, zodat terugzetten kan. */
export async function leesWoordenlijst(db: Db): Promise<Woord[]> {
  return leesWoordenlijstTekst((await lees(db, 'woordenlijst', '[]')).waarde);
}
export async function leesVorigeWoordenlijst(db: Db): Promise<Woord[]> {
  return leesWoordenlijstTekst((await lees(db, 'woordenlijst_vorige', '[]')).waarde);
}
/** Ongeldige invoer gooit een ZodError (HTTP 400). */
export async function bewaarWoordenlijst(db: Db, ruw: unknown): Promise<void> {
  const nieuw = woordenlijstSchema.parse(ruw);
  const huidig = await leesWoordenlijst(db);
  if (huidig.length && JSON.stringify(huidig) !== JSON.stringify(nieuw)) await bewaar(db, 'woordenlijst_vorige', JSON.stringify(huidig));
  await bewaar(db, 'woordenlijst', JSON.stringify(nieuw));
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

/** Schakelaar voor de consultantdebriefs. Standaard uit: zonder deze schakelaar blijft elke route precies zoals voorheen. */
export async function leesConsultantDebrief(db: Db): Promise<boolean> {
  return (await lees(db, 'consultant_debrief', '')).waarde === 'aan';
}
export const bewaarConsultantDebrief = (db: Db, aan: boolean) => bewaar(db, 'consultant_debrief', aan ? 'aan' : '');

/** De checklist die alle consultantdebriefs delen. Per variant is er een eigen aanvulling (zie consultant-varianten.ts). Geen verplicht formulier, geen vaste volgorde. */
export const STANDAARD_CONSULTANT_VRAGEN = [
  '1. Context: Bij welke gemeente (klant) was dit, en wie was de contactpersoon? Vraag alleen wat nog niet bekend is.',
  '2. Werkzaamheden: Wat heb je gedaan?',
  '3. Resultaat: Wat is er daadwerkelijk bereikt of opgeleverd? Wat is nog niet af?',
  '4. Besluiten en afspraken: Welke keuzes zijn gemaakt en wat is met wie afgesproken?',
  '5. Acties: Wat moet er nog gebeuren, wie doet het en voor wanneer? Eén actie per keer. Onderscheid acties van de klant en interne acties.',
  '6. Blokkades en afhankelijkheden: Wat houdt de voortgang nu echt tegen, en wat moet eerst door een ander of een andere stap gebeuren?',
  '7. Risico\'s: Wat kan de planning, kwaliteit, acceptatie of ingebruikname bedreigen?',
  '8. Vervolgsignalen: Heb je een behoefte bij de klant gehoord die buiten de huidige opdracht of het huidige pakket valt? Leg alleen vast wat is gezegd; kwalificeer het niet commercieel.',
  '9. Eerstvolgende stap: Wat is de eerstvolgende concrete stap?',
].join('\n');

/** Sleutels van de bewerkbare consultantchecklists: 'algemeen' en één per variant. */
const consultantSleutel = (sleutel: string) => `consultant_vragen_${sleutel}`;
export const leesConsultantVragen = (db: Db, sleutel: string, standaard: string) => lees(db, consultantSleutel(sleutel), standaard);
/** Een lege tekst zet de standaard terug; de tekst die wordt vervangen blijft bewaard als vorige versie. */
export async function bewaarConsultantVragen(db: Db, sleutel: string, waarde: string, standaard: string): Promise<void> {
  const huidig = await leesConsultantVragen(db, sleutel, standaard);
  if (!huidig.standaard && huidig.waarde !== waarde.trim()) await bewaar(db, `${consultantSleutel(sleutel)}_vorige`, huidig.waarde);
  await bewaar(db, consultantSleutel(sleutel), waarde);
}
export async function leesVorigeConsultantVragen(db: Db, sleutel: string): Promise<string> {
  return (await lees(db, `${consultantSleutel(sleutel)}_vorige`, '')).waarde;
}

/**
 * De aanpasbare delen van de begroeting per gesprekstype: een aanloopzin (inkomend en uitgaand) en de openingsvraag.
 * De AI-melding en de toestemmingsvraag staan vast in de voice-service (verplicht, en gekoppeld aan de toestemmingsversie).
 * Deze standaardteksten zijn gelijk aan BEGROETING_STANDAARD in voice/prompts.py; een lege tekst betekent de standaard.
 */
export const BEGROETING_VELDEN = ['aanloopInkomend', 'aanloopUitgaand', 'opening', 'openingUitgaand'] as const;
export type BegroetingVeld = (typeof BEGROETING_VELDEN)[number];
export const BEGROETING_TYPES = ['dagboek', 'verkoop_debrief', 'consultant_debrief', 'debrief_keuze'] as const;
export type BegroetingType = (typeof BEGROETING_TYPES)[number];
export type Begroeting = Partial<Record<BegroetingType, Partial<Record<BegroetingVeld, string>>>>;
export const BEGROETING_MAX = 200;
export const STANDAARD_BEGROETING: Record<BegroetingType, Partial<Record<BegroetingVeld, string>>> = {
  dagboek: { aanloopInkomend: 'Fijn dat je belt voor je update.', aanloopUitgaand: '', opening: 'Waar wil je mee beginnen?', openingUitgaand: 'Heb je nu even tijd voor een korte update?' },
  verkoop_debrief: { aanloopInkomend: 'Fijn dat je belt over je klant.', aanloopUitgaand: 'Ik bel voor de debrief van je klantbezoek.', opening: 'Vertel maar, wat wil je kwijt?' },
  consultant_debrief: { aanloopInkomend: 'Fijn dat je belt over je werk bij de klant.', aanloopUitgaand: 'Ik bel voor de debrief van je werk bij de klant.' },
  debrief_keuze: { aanloopInkomend: 'Fijn dat je belt over je klant of je werk.', aanloopUitgaand: 'Ik bel voor een debrief van je klant of je werk.' },
};

const eenRegel = (s: string) => s.split(/\s+/).filter(Boolean).join(' ');
const veldSchema = z.string().max(2000).transform(eenRegel).refine((t) => t.length <= BEGROETING_MAX, `Maximaal ${BEGROETING_MAX} tekens per tekst`);
const begroetingSchema = z.object(Object.fromEntries(BEGROETING_TYPES.map((t) => [t, z.object(Object.fromEntries(BEGROETING_VELDEN.map((v) => [v, veldSchema.optional()]))).strict().optional()]))).strict();

/** Alleen wat afwijkt van de standaard staat in de instelling; ongeldige of onbekende velden worden genegeerd. */
export async function leesBegroeting(db: Db): Promise<Begroeting> {
  try {
    const r = begroetingSchema.safeParse(JSON.parse((await lees(db, 'begroeting', '{}')).waarde));
    return r.success ? (r.data as Begroeting) : {};
  } catch { return {}; }
}
/** Ongeldige invoer gooit een ZodError (HTTP 400). Lege teksten, en teksten gelijk aan de standaard, worden niet bewaard. */
export async function bewaarBegroeting(db: Db, ruw: unknown): Promise<void> {
  const b = begroetingSchema.parse(ruw);
  const schoon: Begroeting = {};
  for (const t of BEGROETING_TYPES) for (const v of BEGROETING_VELDEN) {
    const tekst = b[t]?.[v];
    if (tekst && tekst !== STANDAARD_BEGROETING[t][v]) (schoon[t] ??= {})[v] = tekst;
  }
  await bewaar(db, 'begroeting', Object.keys(schoon).length ? JSON.stringify(schoon) : '');
}
/** Wat voice voor dit gesprekstype meekrijgt: alleen de eigen teksten (voice valt zelf terug op de standaard). */
export async function begroetingVoor(db: Db, type: string): Promise<Partial<Record<BegroetingVeld, string>>> {
  return (BEGROETING_TYPES as readonly string[]).includes(type) ? (await leesBegroeting(db))[type as BegroetingType] ?? {} : {};
}
