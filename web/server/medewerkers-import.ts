/**
 * Medewerkers in één keer toevoegen uit een geplakte lijst (naam, telefoonnummer en e-mailadres per regel, in elke volgorde).
 * Alleen een regel met een geldig nederlands nummer wordt toegevoegd; een nummer of naam die al bestaat, of dubbel in de lijst staat, wordt overgeslagen.
 */
import { normaliseerNummer } from './inkomend.js';

export type ImportStatus = 'nieuw' | 'bestaat_al' | 'dubbel_in_lijst' | 'ongeldig';

export interface ImportRegel {
  naam: string;
  telefoon: string;
  email: string;
  locgovGebruikersnaam: string;
  status: ImportStatus;
  reden?: string;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// Een nummer: begint met +31, 0031 of 0 en bestaat verder uit cijfers met spaties, streepjes of haakjes ertussen.
const NUMMER = /(?:\+|00)?\d[\d\s\-().]{6,}\d/;

export function leesLijst(tekst: string): { naam: string; telefoon: string; email: string }[] {
  const uit: { naam: string; telefoon: string; email: string }[] = [];
  for (const regel of tekst.split(/\r?\n/)) {
    let rest = regel.replace(/[ \t]+/g, ' ').trim();
    if (!rest) continue;
    const mail = EMAIL.exec(rest)?.[0] ?? '';
    if (mail) rest = rest.replace(mail, ' ');
    const nr = NUMMER.exec(rest)?.[0] ?? '';
    if (nr) rest = rest.replace(nr, ' ');
    const naam = rest.replace(/[;,|]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!naam && !nr && !mail) continue;
    uit.push({ naam, telefoon: nr.trim(), email: mail.toLowerCase() });
  }
  return uit;
}

const sleutelNaam = (n: string) => n.toLowerCase().replace(/\s+/g, ' ').trim();

export function beoordeelLijst(tekst: string, bestaand: { naam: string; telefoon: string }[]): ImportRegel[] {
  const nummers = new Set(bestaand.map((b) => normaliseerNummer(b.telefoon)).filter(Boolean));
  const namen = new Set(bestaand.map((b) => sleutelNaam(b.naam)));
  const gezien = new Set<string>();
  return leesLijst(tekst).map((r) => {
    const telefoon = normaliseerNummer(r.telefoon);
    const basis = {
      naam: r.naam.slice(0, 100), telefoon: telefoon || r.telefoon, email: r.email.slice(0, 200),
      // Een LOCGOV-account is de naam voor de @ van een LOCGOV-adres.
      locgovGebruikersnaam: /^[a-z0-9._-]{1,64}@locgov\.nl$/.test(r.email) ? r.email.split('@')[0] : '',
    };
    if (!r.naam) return { ...basis, status: 'ongeldig' as const, reden: 'geen naam gevonden' };
    if (!telefoon) return { ...basis, status: 'ongeldig' as const, reden: 'geen geldig nederlands telefoonnummer' };
    if (nummers.has(telefoon)) return { ...basis, status: 'bestaat_al' as const, reden: 'dit nummer is al van een medewerker' };
    if (namen.has(sleutelNaam(r.naam))) return { ...basis, status: 'bestaat_al' as const, reden: 'deze naam bestaat al' };
    if (gezien.has(telefoon) || gezien.has(sleutelNaam(r.naam))) return { ...basis, status: 'dubbel_in_lijst' as const, reden: 'staat twee keer in de lijst' };
    gezien.add(telefoon); gezien.add(sleutelNaam(r.naam));
    return { ...basis, status: 'nieuw' as const };
  });
}
