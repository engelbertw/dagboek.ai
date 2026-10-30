/**
 * Gemeenten (klanten) met contactpersonen in één keer toevoegen uit een geplakte lijst (uit Excel: gescheiden door een tab; ook een puntkomma of
 * een verticale streep). De kopregel bepaalt welke kolom wat is: Gemeente, Samenwerkingsverband, Inwonersaantallen, Sales AM, Contactpersoon,
 * Functie, Rol, Emailadres, Telefoonnummer en Looptijd contract. Zonder kopregel geldt: Gemeente ; Contactpersoon ; Functie ; Rol.
 * Een lege gemeente betekent dezelfde gemeente als de regel erboven; een regel met alleen een gemeente voegt alleen de gemeente toe.
 */
import { normaliseer } from './vertrouwen.js';

export interface ImportContact { naam: string; functie: string; rol: string; email: string; telefoon: string; status: 'nieuw' | 'bestaat_al'; }
export interface KlantVelden { samenwerkingsverband: string; inwoners: number | null; salesAm: string; contractEinde: string | null }
export interface ImportGemeente { naam: string; status: 'nieuw' | 'bestaat_al'; klantId: string | null; velden: KlantVelden; contacten: ImportContact[]; }
export interface KlantenImport { gemeenten: ImportGemeente[]; fouten: string[]; }
export interface BestaandContact { id?: string; klantId: string; naam: string }

type Veld = 'gemeente' | 'samenwerkingsverband' | 'inwoners' | 'salesAm' | 'naam' | 'functie' | 'rol' | 'email' | 'telefoon' | 'contractEinde';
const LEGACY: Veld[] = ['gemeente', 'naam', 'functie', 'rol'];

/** Welke kolom is wat, op basis van de kopregel. Geeft null als de eerste regel geen kopregel is. */
function leesKop(kolommen: string[]): Veld[] | null {
  const kop = kolommen.map((k): Veld | null => {
    const t = k.toLowerCase();
    if (/^(gemeente|klant|organisatie)$/.test(t)) return 'gemeente';
    if (t.includes('samenwerking')) return 'samenwerkingsverband';
    if (t.includes('inwoner')) return 'inwoners';
    if (t.includes('sales') || t === 'accountmanager' || t === 'am') return 'salesAm';
    if (t.includes('contactpersoon') || t === 'naam') return 'naam';
    if (t.includes('mail')) return 'email';
    if (t.includes('telefoon') || t.includes('mobiel')) return 'telefoon';
    if (t.includes('looptijd') || t.includes('contract') || t.includes('attritie')) return 'contractEinde';
    if (t === 'functie') return 'functie';
    if (t === 'rol') return 'rol';
    return null;
  });
  if (kop[0] !== 'gemeente') return null;
  return kop as Veld[];
}

const leeg = (w: string) => (/^[-–—]*$/.test(w) ? '' : w);

/** 22-05-24, 1-07-31 of 3-2-2031 (dag-maand-jaar) naar 2024-05-22; null als het geen geldige datum is. */
export function leesDatum(w: string): string | null {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(w.trim());
  if (!m) return null;
  const jaar = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const iso = `${jaar}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return !Number.isNaN(Date.parse(iso)) && new Date(iso).toISOString().slice(0, 10) === iso ? iso : null;
}

export function beoordeelKlantenLijst(
  tekst: string,
  bestaand: { id: string; naam: string }[],
  bestaandeContacten: BestaandContact[],
): KlantenImport {
  const perNaam = new Map(bestaand.map((k) => [normaliseer(k.naam), k]));
  const groepen = new Map<string, ImportGemeente>();
  const fouten: string[] = [];
  const gezienContact = new Set(bestaandeContacten.map((c) => `${c.klantId}|${normaliseer(c.naam)}`));
  let vorige = '';
  let eerste = true;
  let velden = LEGACY;

  for (const [i, regel] of tekst.split(/\r?\n/).entries()) {
    if (!regel.trim()) continue;
    const kolommen = regel.split(/\t|;|\|/).map((c) => c.replace(/\s+/g, ' ').trim());
    if (eerste) {
      eerste = false;
      const kop = leesKop(kolommen);
      if (kop) { velden = kop; continue; } // kopregel van een tabel
    }
    const w = (veld: Veld) => { const k = velden.indexOf(veld); return k >= 0 ? leeg(kolommen[k] ?? '') : ''; };
    const gemeente = (w('gemeente') || vorige).slice(0, 200);
    const naam = w('naam');
    if (!gemeente) { fouten.push(`Regel ${i + 1}: geen gemeente en er staat ook geen gemeente erboven`); continue; }
    vorige = gemeente;

    const sleutel = normaliseer(gemeente);
    let g = groepen.get(sleutel);
    if (!g) {
      const k = perNaam.get(sleutel);
      g = { naam: gemeente, status: k ? 'bestaat_al' : 'nieuw', klantId: k?.id ?? null, velden: { samenwerkingsverband: '', inwoners: null, salesAm: '', contractEinde: null }, contacten: [] };
      groepen.set(sleutel, g);
    }
    // Gegevens van de gemeente: de eerste regel met een waarde wint.
    if (!g.velden.samenwerkingsverband) g.velden.samenwerkingsverband = w('samenwerkingsverband').slice(0, 200);
    if (!g.velden.salesAm) g.velden.salesAm = w('salesAm').slice(0, 100);
    const inwoners = w('inwoners').replace(/\D/g, '');
    if (g.velden.inwoners === null && inwoners && Number(inwoners) <= 20_000_000) g.velden.inwoners = Number(inwoners);
    const einde = w('contractEinde');
    if (einde && !g.velden.contractEinde) {
      const iso = leesDatum(einde);
      if (iso) g.velden.contractEinde = iso; else fouten.push(`Regel ${i + 1}: "${einde}" is geen datum (dag-maand-jaar), de looptijd is overgeslagen`);
    }

    if (!naam) continue;
    let email = w('email').toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { fouten.push(`Regel ${i + 1}: "${email}" is geen e-mailadres, overgeslagen`); email = ''; }
    const contactSleutel = `${g.klantId ?? `nieuw:${sleutel}`}|${normaliseer(naam)}`;
    const dubbel = gezienContact.has(contactSleutel);
    gezienContact.add(contactSleutel);
    g.contacten.push({ naam: naam.slice(0, 100), functie: w('functie').slice(0, 100), rol: w('rol').slice(0, 100), email: email.slice(0, 200), telefoon: w('telefoon').slice(0, 30), status: dubbel ? 'bestaat_al' : 'nieuw' });
  }
  return { gemeenten: [...groepen.values()], fouten };
}
