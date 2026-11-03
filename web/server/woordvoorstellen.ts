/**
 * Voorstellen voor de woordenlijst uit gesprekken. Alleen vaste herkenning, geen taalmodel:
 * - een woord met een e- voor een productnaam ("eKlantgeleiding", "e-burgerzaken"): het product heet waarschijnlijk iKlantgeleiding, iBurgerzaken;
 * - een naam die bijna gelijk is aan een bekende medewerker of contactpersoon ("Ronbout" voor Rombout).
 * Een voorstel verandert niets totdat de beheerder het goedkeurt; een afgewezen voorstel komt niet terug.
 */
import { eq, sql } from 'drizzle-orm';
import type { Db } from './db.js';
import { employees, klantContacten, woordvoorstellen } from './schema.js';
import { afstand } from './namen.js';
import { normaliseer, type Beurt } from './vertrouwen.js';
import type { Woord } from './woordenlijst.js';

export type VoorstelBron = 'e_voorvoegsel' | 'naam_lijkt_op';
export interface Kandidaat { term: string; gehoordAls: string; soort: 'product' | 'persoon'; bron: VoorstelBron }

/** Echte e-woorden: die zijn geen verkeerd gehoorde i-producten. */
const ECHTE_E_WOORDEN = new Set(['mail', 'mails', 'mailadres', 'mailen', 'herkenning', 'id', 'factuur', 'facturen', 'boekhouden', 'commerce', 'learning', 'sport', 'book', 'bike']);

const E_VOORVOEGSEL = /(?<![\p{L}\p{N}])e(?:-(\p{L}{3,})|(\p{Lu}\p{Ll}{2,}))(?![\p{L}\p{N}])/gu;
/** Een hoofdletterwoord midden in een zin: een naam, geen zinsbegin. */
const NAAMWOORD = /(?<=[\p{Ll},;:] )(\p{Lu}\p{L}{3,})(?![\p{L}\p{N}])/gu;

const hoofdletter = (t: string) => t[0].toUpperCase() + t.slice(1);

export function vindKandidaten(beurten: Beurt[], lijst: Woord[], bekendeNamen: string[]): Kandidaat[] {
  const bekendInLijst = new Set(lijst.flatMap((w) => [normaliseer(w.term), ...w.gehoordAls.map(normaliseer)]));
  const bekendeDelen = new Map<string, string>(); // genormaliseerd naamdeel -> zoals bekend
  for (const naam of bekendeNamen) for (const deel of naam.split(/\s+/)) if (deel.length >= 4) bekendeDelen.set(normaliseer(deel), deel);
  const uit = new Map<string, Kandidaat>();
  const voeg = (k: Kandidaat) => { const sleutel = `${normaliseer(k.gehoordAls)}|${normaliseer(k.term)}`; if (!uit.has(sleutel)) uit.set(sleutel, k); };

  for (const m of beurten) {
    if (!m || m.role !== 'user' || typeof m.content !== 'string') continue;
    for (const hit of m.content.matchAll(E_VOORVOEGSEL)) {
      const rest = (hit[1] ?? hit[2]).toLowerCase();
      const gehoord = hit[0];
      if (ECHTE_E_WOORDEN.has(rest) || bekendInLijst.has(normaliseer(gehoord))) continue;
      const term = `i${hoofdletter(hit[1] ?? hit[2])}`;
      if (bekendInLijst.has(normaliseer(term))) continue;
      voeg({ term, gehoordAls: gehoord, soort: 'product', bron: 'e_voorvoegsel' });
    }
    for (const hit of m.content.matchAll(NAAMWOORD)) {
      const woord = hit[1];
      const n = normaliseer(woord);
      if (bekendeDelen.has(n) || bekendInLijst.has(n)) continue;
      for (const [bekend, zoalsBekend] of bekendeDelen) {
        const grens = Math.min(n.length, bekend.length) >= 8 ? 2 : 1;
        if (n.length >= 5 && Math.abs(n.length - bekend.length) <= 1 && afstand(n, bekend) <= grens) { voeg({ term: zoalsBekend, gehoordAls: woord, soort: 'persoon', bron: 'naam_lijkt_op' }); break; }
      }
    }
  }
  return [...uit.values()];
}

/** Bewaart de voorstellen: hetzelfde voorstel telt op, een besloten voorstel (goedgekeurd of afgewezen) blijft zoals het is. Geeft het aantal nieuwe of opgetelde voorstellen. */
export async function bewaarKandidaten(db: Db, callId: string, kandidaten: Kandidaat[]): Promise<number> {
  for (const k of kandidaten) {
    const sleutel = `${normaliseer(k.gehoordAls)}|${normaliseer(k.term)}`;
    await db.insert(woordvoorstellen).values({ term: k.term, gehoordAls: k.gehoordAls, soort: k.soort, bron: k.bron, sleutel, eersteCallId: callId })
      .onConflictDoUpdate({ target: woordvoorstellen.sleutel, set: { aantal: sql`${woordvoorstellen.aantal} + 1`, bijgewerktOp: new Date() }, setWhere: eq(woordvoorstellen.status, 'voorgesteld') });
  }
  return kandidaten.length;
}

/** Zoekt en bewaart voorstellen voor één gesprek. Mag nooit het verwerken van het gesprek verstoren. */
export async function verzamelVoorstellen(db: Db, callId: string, beurten: Beurt[], lijst: Woord[]): Promise<number> {
  try {
    const [medewerkers, contacten] = await Promise.all([db.select({ naam: employees.naam }).from(employees), db.select({ naam: klantContacten.naam }).from(klantContacten)]);
    const kandidaten = vindKandidaten(beurten, lijst, [...medewerkers, ...contacten].map((r) => r.naam));
    return kandidaten.length ? await bewaarKandidaten(db, callId, kandidaten) : 0;
  } catch { return 0; }
}
