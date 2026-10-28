/**
 * Alles wat uit een gesprek of van het taalmodel komt is onbetrouwbare invoer: het kan opmaak bevatten die een datablok in een prompt
 * afsluit, of regels die op een instructie lijken. Deze helpers maken tekst veilig om als gegeven in een prompt te zetten en controleren
 * of een bewering van het model echt in het gesprek voorkomt.
 */
// eslint-disable-next-line no-control-regex
const STUURTEKENS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g;

/** Maakt tekst geschikt als gegeven in een prompt: geen < of > (dus geen tags die een blok kunnen sluiten), geen regelovergangen of stuurtekens, begrensd. */
export function schoonVoorPrompt(tekst: unknown, max = 500): string {
  const s = typeof tekst === 'string' ? tekst : '';
  return s.replace(/[<>]/g, '').replace(STUURTEKENS, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Kleine letters, alleen letters en cijfers, enkele spaties: om een citaat te vergelijken met wat er gezegd is. */
export function normaliseer(tekst: string): string {
  return tekst.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export interface Beurt { role: string; content: string }

const MIN_CITAAT_TEKENS = 2; // "ja" is een geldig antwoord

/** Komt dit citaat letterlijk (op hoofdletters en leestekens na) voor in iets wat de collega zelf zei? */
export function citaatKomtVoor(citaat: string | null | undefined, transcript: Beurt[]): boolean {
  const c = normaliseer(citaat ?? '');
  if (c.length < MIN_CITAAT_TEKENS) return false;
  return transcript.some((m) => m.role === 'user' && typeof m.content === 'string' && ` ${normaliseer(m.content)} `.includes(` ${c} `));
}

/** Komt deze naam of tekst ergens in het gesprek voor (door wie dan ook)? */
export function komtVoorInGesprek(tekst: string, transcript: Beurt[]): boolean {
  const t = normaliseer(tekst);
  if (t.length < MIN_CITAAT_TEKENS) return false;
  return transcript.some((m) => typeof m.content === 'string' && ` ${normaliseer(m.content)} `.includes(` ${t} `));
}
