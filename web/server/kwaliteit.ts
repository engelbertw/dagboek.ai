/**
 * Kritisch zijn op wat uit een gesprek als punt wordt opgenomen. Het taalmodel neigt ertoe alles op te schrijven: vage gevoelens als "resultaat",
 * dezelfde zaak als doel, kans én actie, en tientallen kleine acties. Dit bestand bepaalt met vaste regels (zonder tweede modelaanroep) wat belangrijk
 * genoeg is. Liever een punt te weinig dan het register vol met ruis.
 */

const STOPWOORDEN = new Set(['de', 'het', 'een', 'met', 'en', 'van', 'voor', 'op', 'in', 'te', 'naar', 'is', 'zijn', 'dat', 'die', 'aan', 'om', 'bij', 'nog', 'deze', 'dit']);
const woorden = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w && !STOPWOORDEN.has(w));

/** Is dit punt al gedekt door een bestaand punt, ook met andere woorden? Liever een dubbel punt missen dan het dagboek vervuilen. */
export function lijktOpBestaand(nieuw: string, bestaand: string[]): boolean {
  const a = woorden(nieuw);
  if (!a.length) return true;
  return bestaand.some((b) => {
    const w = woorden(b);
    if (!w.length) return false;
    const [kort, lang] = a.length <= w.length ? [a, w] : [w, a];
    if (kort.every((x) => lang.includes(x))) return true; // het ene punt zit helemaal in het andere
    const gemeenschappelijk = a.filter((x) => w.includes(x)).length;
    return gemeenschappelijk / new Set([...a, ...w]).size >= 0.6;
  });
}

/** Algemene zinnen die niets zeggen over wat er is bereikt of wat iemand moet doen. */
const VAGE_FRASEN = [
  /\bverder gekomen\b/, /\bstappen (?:gemaakt|gezet)\b/, /\bgoed(?:e)? (?:gesprek|sfeer|gevoel)\b/, /\b(?:ging|loopt|liep) (?:goed|prima|best)\b/,
  /\bis besproken\b/, /\bzijn besproken\b/, /\bin contact blijven\b/, /\bblijven in contact\b/, /\bnog even kijken\b/, /\bpositief ontvangen\b/,
  /\bgeen bijzonderheden\b/, /\bverder uitgewerkt\b/, /\bvoortgang (?:gemaakt|geboekt)\b/, /\bprettig (?:gesprek|overleg)\b/,
];

/** Iets concreets: een getal, een bedrag of een eigennaam (hoofdletter midden in de zin). */
const heeftConcreet = (t: string) => /\d|€|\beuro\b/i.test(t) || /(?:^|\s)\S+\s+[A-ZÀ-Ý][\p{L}]{2,}/u.test(t);

export type Soortnaam = 'doel' | 'resultaat' | 'afspraak' | 'actie' | 'intern' | 'kans' | 'risico';

/** Te kort, te algemeen, of (bij een doel of resultaat) zonder iets concreets: niet opnemen. */
export function teVaag(tekst: string, soort: Soortnaam | 'dagboek'): boolean {
  const t = tekst.trim();
  const n = woorden(t).length;
  if (n < 2) return true;
  if (VAGE_FRASEN.some((f) => f.test(t.toLowerCase()))) return true;
  if ((soort === 'doel' || soort === 'resultaat') && n < 5 && !heeftConcreet(t)) return true;
  return false;
}

/** Als twee soorten over hetzelfde gaan, wint de soort waar het meest mee te doen valt. */
const PRIORITEIT: Record<Soortnaam, number> = { actie: 0, afspraak: 1, intern: 2, kans: 3, risico: 4, doel: 5, resultaat: 6 };

/** Hoeveel er per gesprek hooguit wordt opgenomen; de actiegerichte soorten delen één maximum. */
export const MAX_PER_GESPREK = { acties: 5, kans: 3, risico: 3, doel: 3, resultaat: 3 } as const;
export const MAX_DAGBOEK_PER_ONDERWERP = 4;

export interface Kandidaat { soort: Soortnaam; omschrijving: string; citaat: string; eigenaar?: string; deadline?: string | null }

const groep = (s: Soortnaam): keyof typeof MAX_PER_GESPREK => (s === 'actie' || s === 'afspraak' || s === 'intern' ? 'acties' : s);

/** Hoe goed is een punt onderbouwd? Met citaat, eigenaar en deadline gaat voor een punt zonder. */
const gewicht = (k: Kandidaat) => (k.citaat.trim() ? 4 : 0) + (k.eigenaar?.trim() ? 1 : 0) + (k.deadline ? 1 : 0);

export interface Selectie<T extends Kandidaat> { behouden: T[]; weggelaten: { vaag: number; dubbel: number; teveel: number } }

/**
 * Kiest wat belangrijk genoeg is: laat vage punten weg, laat dubbelen over soorten heen vallen (ook tegen `bestaand`, de open punten van dezelfde klant)
 * en houdt per soort een maximum aan. De volgorde van binnenkomst blijft behouden.
 */
export function selecteerBelangrijk<T extends Kandidaat>(kandidaten: T[], bestaand: string[] = []): Selectie<T> {
  const weggelaten = { vaag: 0, dubbel: 0, teveel: 0 };
  const serieus = kandidaten.filter((k) => {
    if (!teVaag(k.omschrijving, k.soort)) return true;
    weggelaten.vaag++;
    return false;
  });
  // Eerst de soort met de hoogste prioriteit, bij gelijke soort de best onderbouwde; wat daarna op een gekozen punt lijkt valt weg.
  const volgorde = serieus.map((k, i) => ({ k, i })).sort((x, y) => PRIORITEIT[x.k.soort] - PRIORITEIT[y.k.soort] || gewicht(y.k) - gewicht(x.k) || x.i - y.i);
  const gekozen: { k: T; i: number }[] = [];
  const bekend = [...bestaand];
  const aantal: Record<string, number> = {};
  for (const c of volgorde) {
    if (lijktOpBestaand(c.k.omschrijving, bekend)) { weggelaten.dubbel++; continue; }
    const g = groep(c.k.soort);
    if ((aantal[g] ?? 0) >= MAX_PER_GESPREK[g]) { weggelaten.teveel++; continue; }
    aantal[g] = (aantal[g] ?? 0) + 1;
    bekend.push(c.k.omschrijving);
    gekozen.push(c);
  }
  return { behouden: gekozen.sort((x, y) => x.i - y.i).map((c) => c.k), weggelaten };
}
