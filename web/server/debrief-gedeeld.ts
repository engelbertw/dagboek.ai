/**
 * Gedeelde bouwstenen voor debriefs die iets aan een gemeente (klant) hangen: kiezen uit een korte lijst en dat bewijzen met het gesprek,
 * concrete deadlines, gemeentekoppeling en contactpersonen. De verkoop-debrief (debrief.ts) gebruikt deze nog niet; dit bestand is nieuw
 * en verandert dus niets aan bestaand gedrag.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from './db.js';
import { klantContacten, type Herkomst } from './schema.js';
import { vergelijkNamen } from './namen.js';
import { citaatKomtVoor, komtVoorInGesprek, normaliseer, type Beurt } from './vertrouwen.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

// ── Een keuze (route of variant) bewijzen met het gesprek ────────────────────────────────────────────────────────────────────────────────

/** Woorden die laten zien dat de beller zelf deze optie noemt of bevestigt. */
export type Trefwoorden = Record<string, readonly string[]>;

const BEVESTIGING = new Set(['ja', 'jawel', 'klopt', 'dat klopt', 'inderdaad', 'juist', 'goed', 'ja klopt', 'ja dat klopt', 'ja hoor', 'prima', 'precies', 'correct']);

export interface Keuzebewijs {
  /** De waarde die het model kiest, bijvoorbeeld 'samenverder'. */
  waarde: string | null | undefined;
  bron: string | null | undefined;
  citaat: string | null | undefined;
}

export interface Voorstel { waarde: string; /** Een naam die de assistent bij het voorstel noemt (bijvoorbeeld de gemeente). */ noemt: string }

export interface Keuze { waarde: string | null; bron: Herkomst; citaat: string }

const BRONNEN: readonly Herkomst[] = ['context_bevestigd', 'mondeling_gekozen', 'mondeling_gecorrigeerd'];

const bevat = (tekst: string, woorden: readonly string[]) => woorden.some((w) => ` ${normaliseer(tekst)} `.includes(` ${normaliseer(w)} `));

/** Staat het citaat in een gebruikersbeurt, en wat zei de assistent daar vlak voor? */
function beurtMetCitaat(citaat: string, transcript: Beurt[]): { index: number; vorigeAssistent: string } | null {
  const c = ` ${normaliseer(citaat)} `;
  for (let i = 0; i < transcript.length; i++) {
    const m = transcript[i];
    if (m.role !== 'user' || typeof m.content !== 'string' || !` ${normaliseer(m.content)} `.includes(c)) continue;
    const vorige = transcript[i - 1];
    return { index: i, vorigeAssistent: vorige?.role === 'assistant' && typeof vorige.content === 'string' ? vorige.content : '' };
  }
  return null;
}

const isBevestiging = (citaat: string) => BEVESTIGING.has(normaliseer(citaat));

/**
 * Verifieert een keuze die het model uit het gesprek haalt. Zonder bewijs is het resultaat `waarde: null` en `bron: 'onbekend'`: er wordt nooit gegokt.
 * - mondeling: het citaat staat in een gebruikersbeurt en noemt de gekozen optie zelf, of bevestigt een assistentbeurt die de optie noemde.
 * - context_bevestigd: de optie komt uit een voorstel dat vooraf bekend was, de assistent noemde dat voorstel en de gebruiker bevestigde het direct daarna.
 */
export function verifieerKeuze(bewijs: Keuzebewijs, trefwoorden: Trefwoorden, transcript: Beurt[], voorstel?: Voorstel | null): Keuze {
  const onbekend: Keuze = { waarde: null, bron: 'onbekend', citaat: '' };
  const waarde = (bewijs.waarde ?? '').trim().toLowerCase();
  const woorden = trefwoorden[waarde];
  const bron = BRONNEN.find((b) => b === bewijs.bron);
  const citaat = (bewijs.citaat ?? '').trim();
  if (!waarde || !woorden || !bron || !citaat || !citaatKomtVoor(citaat, transcript)) return onbekend;
  const plek = beurtMetCitaat(citaat, transcript);
  if (!plek) return onbekend;

  if (bron === 'context_bevestigd') {
    // De assistent noemde het voorstel in de beurt vlak vóór het antwoord, en de gebruiker bevestigde dat.
    const nietNoemt = !voorstel || voorstel.waarde !== waarde || !isBevestiging(citaat) || !komtVoorInGesprek(voorstel.noemt, [{ role: 'assistant', content: plek.vorigeAssistent }]);
    return nietNoemt ? onbekend : { waarde, bron, citaat };
  }
  // Mondeling: zelf genoemd, of een bevestiging op een vraag die de optie noemde (en dan alleen die optie, niet een andere).
  if (bevat(citaat, woorden)) return { waarde, bron, citaat };
  if (isBevestiging(citaat) && bevat(plek.vorigeAssistent, woorden)) {
    const anderen = Object.entries(trefwoorden).filter(([k]) => k !== waarde);
    if (!anderen.some(([, w]) => bevat(plek.vorigeAssistent, w))) return { waarde, bron, citaat };
  }
  return onbekend;
}

// ── Deadlines ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const VAGE_TERMIJNEN = /\b(binnenkort|zo snel mogelijk|asap|volgende keer|straks|op korte termijn|zsm|nog even|later|ooit|in de toekomst)\b/i;
const MAANDEN = /\b(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\b/i;
const WEEKDAGEN = /\b(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b/i;
const RELATIEF = /\b(morgen|overmorgen|vandaag|volgende week|volgende maand|aankomende)\b/i;

/**
 * Een deadline telt alleen als de woorden waarop hij berust een concrete datumaanduiding bevatten (cijfers met een dag/maand, een maand, of een weekdag of
 * relatieve dag) en niet vaag zijn. "Binnenkort" of "volgende keer" wordt nooit omgezet in een datum, ook niet als het model er een invult.
 */
export function deadlineConcreet(citaat: string | null | undefined): boolean {
  const t = citaat ?? '';
  if (!t.trim() || VAGE_TERMIJNEN.test(t)) return false;
  return /\b\d{1,2}[-/. ]\d{1,2}([-/. ]\d{2,4})?\b/.test(t) || /\b\d{1,2}(e|ste|de)?\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\b/i.test(t)
    || MAANDEN.test(t) || WEEKDAGEN.test(t) || RELATIEF.test(t);
}

// ── Gemeentekoppeling ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Koppeling { soort: string; klantId: string | null | undefined }

/**
 * Alles wat bij één debrief hoort moet bij dezelfde gemeente horen. Een koppeling met een andere (of geen) klant wordt niet gelegd maar komt in de lijst
 * met afwijkingen, zodat die als `klant_inconsistent` naar Controle nodig kan.
 */
export function controleerKlantConsistentie(klantId: string | null, koppelingen: Koppeling[]): { toegestaan: Koppeling[]; afwijkend: Koppeling[] } {
  const toegestaan: Koppeling[] = [];
  const afwijkend: Koppeling[] = [];
  for (const k of koppelingen) (klantId && k.klantId === klantId ? toegestaan : afwijkend).push(k);
  return { toegestaan, afwijkend };
}

// ── Contactpersonen ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface GenoemdContact { naam: string; functie: string; rol: string }
export interface ContactUitkomst { gekoppeld: string[]; onzeker: string[] }

/**
 * Legt contactpersonen van de gemeente vast. Alleen een naam die letterlijk in het gesprek voorkomt; een bestaand contact (zelfde klant, zelfde genormaliseerde
 * naam) wordt hergebruikt en alleen aangevuld waar functie of rol nog leeg is. Meer dan één treffer of een naamdeel dat niet eenduidig is: `onzeker`.
 * Geen e-mailadres of telefoonnummer: die zijn uit spraak onbetrouwbaar en komen alleen via de beheerschermen of een import.
 */
export async function legContactenVast(tx: Db | Tx, klantId: string, callId: string, genoemd: GenoemdContact[], transcript: Beurt[]): Promise<ContactUitkomst> {
  const rijen = await tx.select().from(klantContacten).where(eq(klantContacten.klantId, klantId));
  const bekend = rijen.map((r) => ({ id: r.id, naam: r.naam, functie: r.functie, rol: r.rol }));
  const uitkomst: ContactUitkomst = { gekoppeld: [], onzeker: [] };
  const gezien = new Set<string>();
  const delen = (naam: string) => normaliseer(naam).split(' ').filter(Boolean);
  for (const c of genoemd) {
    const naam = c.naam.trim().slice(0, 100);
    const sleutel = normaliseer(naam);
    if (!sleutel || gezien.has(sleutel) || !komtVoorInGesprek(naam, transcript)) continue;
    gezien.add(sleutel);
    const gelijk = bekend.filter((b) => normaliseer(b.naam) === sleutel);
    if (gelijk.length > 1) { uitkomst.onzeker.push(naam); continue; }
    if (gelijk.length === 0) {
      // Een gedeeltelijke overeenkomst ("De Boer" tegenover "Mevrouw De Boer") is geen zekerheid: niet raden en geen dubbel contact maken, de beheerder beslist.
      const eigen = delen(naam);
      // Ook een bijna gelijke naam (spelfout van de spraakherkenning) is geen nieuw contact.
      const gedeeltelijk = bekend.filter((b) => { const d = delen(b.naam); return eigen.every((w) => d.includes(w)) || d.every((w) => eigen.includes(w)) || vergelijkNamen(b.naam, naam) !== null; });
      if (gedeeltelijk.length) { uitkomst.onzeker.push(naam); continue; }
      const functie = c.functie.trim().slice(0, 100);
      const rol = c.rol.trim().slice(0, 100);
      const [nieuw] = await tx.insert(klantContacten).values({ klantId, naam, functie, rol, callId }).returning({ id: klantContacten.id });
      bekend.push({ id: nieuw.id, naam, functie, rol });
      uitkomst.gekoppeld.push(nieuw.id);
      continue;
    }
    // Eén bestaand contact: hergebruiken, alleen lege velden aanvullen.
    const t = gelijk[0];
    const aanvulling = { ...(!t.functie && c.functie.trim() ? { functie: c.functie.trim().slice(0, 100) } : {}), ...(!t.rol && c.rol.trim() ? { rol: c.rol.trim().slice(0, 100) } : {}) };
    if (Object.keys(aanvulling).length) await tx.update(klantContacten).set(aanvulling).where(and(eq(klantContacten.id, t.id), eq(klantContacten.klantId, klantId)));
    uitkomst.gekoppeld.push(t.id);
  }
  return uitkomst;
}

// ── Klant kiezen ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface BekendeKlant { id: string; naam: string }

/**
 * Welke gemeente is bedoeld? Een klant uit de lijst (zoals het model hem aanwees, of op genormaliseerde naam), anders een nieuwe klant als voorstel, maar alleen
 * als de naam echt in het gesprek voorkomt. Het resultaat `nieuw: true` betekent: moet worden aangemaakt als voorstel (status 'voorgesteld') en gecontroleerd.
 */
export function kiesKlant(genoemd: string, aangewezen: string, bekende: BekendeKlant[], transcript: Beurt[]): { klantId: string | null; nieuweNaam: string | null } {
  const naam = genoemd.trim();
  const gekozen = aangewezen.trim().toLowerCase();
  let klant = gekozen ? bekende.find((k) => k.naam.toLowerCase() === gekozen) : undefined;
  if (!klant && naam) klant = bekende.find((k) => normaliseer(k.naam) === normaliseer(naam));
  if (klant) return { klantId: klant.id, nieuweNaam: null };
  return { klantId: null, nieuweNaam: naam && komtVoorInGesprek(naam, transcript) ? naam.slice(0, 200) : null };
}
