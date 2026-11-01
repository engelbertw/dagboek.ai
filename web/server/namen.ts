/**
 * Vergelijken van namen, e-mailadressen en telefoonnummers voor het opsporen van dubbele contactpersonen. Spraakherkenning schrijft dezelfde persoon
 * vaak net anders ("Muntinga", "Mentenga", "Munterga"); daarom telt een kleine afstand tussen achternamen ook als een mogelijk dubbel.
 * Dit zijn alleen aanwijzingen voor een mens: er wordt nooit automatisch samengevoegd.
 */
import { normaliseer } from './vertrouwen.js';

const TITELS = new Set(['mevrouw', 'mevr', 'mw', 'mw.', 'dhr', 'de heer', 'heer', 'meneer', 'dr', 'drs', 'ir', 'mr', 'prof', 'ing', 'bsc', 'msc', 'mba']);

/** Genormaliseerde naamdelen zonder aanspreektitels, in de volgorde van de naam. */
export function naamDelen(naam: string): string[] {
  const delen = normaliseer(naam).split(' ').filter(Boolean);
  const zonder = delen.filter((d) => !TITELS.has(d));
  return zonder.length ? zonder : delen;
}

/** Aantal bewerkingen (invoegen, weglaten, vervangen, twee letters omwisselen) om de ene tekst in de andere te veranderen. */
export function afstand(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length; const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const kosten = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + kosten);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

export type Gelijkenis = 'gelijk' | 'bijna' | null;

/**
 * Zijn dit dezelfde persoon? 'gelijk': dezelfde naamdelen (op titels, hoofdletters, leestekens en volgorde na). 'bijna': dezelfde voornaam (of voorletter) en een
 * achternaam die een of twee letters verschilt. Alleen een voornaam of alleen een achternaam is te weinig om te vergelijken: dan null.
 */
export function vergelijkNamen(a: string, b: string): Gelijkenis {
  const x = naamDelen(a); const y = naamDelen(b);
  if (!x.length || !y.length) return null;
  if ([...x].sort().join(' ') === [...y].sort().join(' ')) return 'gelijk';
  if (x.length < 2 || y.length < 2) return null;
  const [vx, ...rx] = x; const [vy, ...ry] = y;
  const voornaamOk = vx === vy || (vx.length === 1 && vy.startsWith(vx)) || (vy.length === 1 && vx.startsWith(vy)) || (vx.length > 2 && vy.length > 2 && afstand(vx, vy) <= 1);
  if (!voornaamOk) return null;
  const sx = rx.join(''); const sy = ry.join('');
  if (!sx || !sy) return null;
  const grens = Math.max(1, Math.floor(Math.max(sx.length, sy.length) / 4));
  return afstand(sx, sy) <= grens ? 'bijna' : null;
}

const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/;
const TELEFOON = /(?:\+|00)?\d[\d\s\-().]{7,}\d/;

/** Het e-mailadres in een tekst, kleine letters, of null. */
export const zoekEmail = (t: string): string | null => EMAIL.exec(t)?.[0].replace(/[.,;]+$/, '').toLowerCase() ?? null;
export const zoekTelefoon = (t: string): string | null => TELEFOON.exec(t.replace(EMAIL, ' '))?.[0].trim() ?? null;

/** Alleen de cijfers van een telefoonnummer, zonder landcode of beginnul: 31653236242 en 06 53236242 geven dezelfde sleutel. */
export function telefoonSleutel(t: string): string | null {
  const cijfers = t.replace(/\D/g, '');
  if (cijfers.length < 9) return null;
  return cijfers.slice(-9);
}

export const emailSleutel = (e: string): string | null => (e.includes('@') ? e.trim().toLowerCase() : null);

/** Een bruikbare schrijfwijze voor een Nederlands nummer: +31 zonder spaties. Onbekende vormen blijven ongemoeid. */
export function schoonTelefoon(t: string): string {
  const c = t.trim().replace(/[\s\-().]/g, '');
  if (/^\+31\d{9}$/.test(c)) return c;
  if (/^0031\d{9}$/.test(c)) return `+${c.slice(2)}`;
  if (/^31\d{9}$/.test(c)) return `+${c}`;
  if (/^0\d{9}$/.test(c)) return `+31${c.slice(1)}`;
  return t.trim();
}

/** Een e-mailadres in een naamveld, of een telefoonnummer: de rest is de naam. */
export function splitsNaam(naam: string): { naam: string; email: string | null; telefoon: string | null } | null {
  const email = zoekEmail(naam);
  const telefoon = zoekTelefoon(naam);
  if (!email && !telefoon) return null;
  let rest = naam;
  if (email) rest = rest.replace(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
  if (telefoon) rest = rest.replace(telefoon, ' ');
  rest = rest.replace(/[<>()|;,]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { naam: rest, email, telefoon };
}
