/**
 * Gemeenten (klanten) met contactpersonen in één keer toevoegen uit een geplakte lijst.
 * Per regel: Gemeente ; Contactpersoon ; Functie ; Rol, gescheiden door een tab (plakken uit Excel), een puntkomma of een verticale streep.
 * Een lege eerste kolom betekent dezelfde gemeente als de regel erboven; een regel met alleen een gemeente voegt alleen de gemeente toe.
 * Van een contactpersoon worden alleen naam, functie en rol bewaard, nooit telefoon of privégegevens.
 */
import { normaliseer } from './vertrouwen.js';

export interface ImportContact { naam: string; functie: string; rol: string; status: 'nieuw' | 'bestaat_al'; }
export interface ImportGemeente { naam: string; status: 'nieuw' | 'bestaat_al'; klantId: string | null; contacten: ImportContact[]; }
export interface KlantenImport { gemeenten: ImportGemeente[]; fouten: string[]; }

const KOPPEN = new Set(['gemeente', 'klant', 'organisatie']);

export function beoordeelKlantenLijst(
  tekst: string,
  bestaand: { id: string; naam: string }[],
  bestaandeContacten: { klantId: string; naam: string }[],
): KlantenImport {
  const perNaam = new Map(bestaand.map((k) => [normaliseer(k.naam), k]));
  const groepen = new Map<string, ImportGemeente>();
  const fouten: string[] = [];
  const gezienContact = new Set(bestaandeContacten.map((c) => `${c.klantId}|${normaliseer(c.naam)}`));
  let vorige = '';
  let eerste = true;

  for (const [i, regel] of tekst.split(/\r?\n/).entries()) {
    if (!regel.trim()) continue;
    const kolommen = regel.split(/\t|;|\|/).map((c) => c.replace(/\s+/g, ' ').trim());
    if (eerste) {
      eerste = false;
      if (KOPPEN.has(kolommen[0].toLowerCase())) continue; // kopregel van een tabel
    }
    const gemeente = (kolommen[0] || vorige).slice(0, 200);
    const [, naam = '', functie = '', rol = ''] = kolommen;
    if (!gemeente) { fouten.push(`Regel ${i + 1}: geen gemeente en er staat ook geen gemeente erboven`); continue; }
    vorige = gemeente;

    const sleutel = normaliseer(gemeente);
    let g = groepen.get(sleutel);
    if (!g) {
      const k = perNaam.get(sleutel);
      g = { naam: gemeente, status: k ? 'bestaat_al' : 'nieuw', klantId: k?.id ?? null, contacten: [] };
      groepen.set(sleutel, g);
    }
    if (!naam) continue;
    const contactSleutel = `${g.klantId ?? `nieuw:${sleutel}`}|${normaliseer(naam)}`;
    const dubbel = gezienContact.has(contactSleutel);
    gezienContact.add(contactSleutel);
    g.contacten.push({ naam: naam.slice(0, 100), functie: functie.slice(0, 100), rol: rol.slice(0, 100), status: dubbel ? 'bestaat_al' : 'nieuw' });
  }
  return { gemeenten: [...groepen.values()], fouten };
}
