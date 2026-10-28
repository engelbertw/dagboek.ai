/**
 * Gestructureerde logregels (JSON) zonder gespreksinhoud, volledige telefoonnummers, BSN, IBAN of sleutels.
 * Het correlatie-id is het id van het gesprek (calls.id): dat staat ook in de logs van de voice-service.
 */
const PATRONEN: [RegExp, string][] = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [token]'],
  [/\b(?:sk|xi)[-_][A-Za-z0-9_-]{16,}\b/g, '[sleutel]'],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[e-mail]'],
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g, '[iban]'],
  [/(?:\+|\b00)\d{1,3}[\s-]?\(?\d?\)?(?:[\s-]?\d){7,11}\b/g, '[tel]'],
  [/\b0\d{1,2}(?:[\s-]?\d){7,9}\b/g, '[tel]'],
  [/(?<![\w-])\d{9}(?![\w-])/g, '[nummer]'],
];

export function maskeer(tekst: string): string {
  return PATRONEN.reduce((t, [patroon, vervanging]) => t.replace(patroon, vervanging), tekst);
}

/** Alleen de klassenaam van een fout (en een technische code zoals ECONNREFUSED): de melding kan gegevens bevatten. */
export function foutcode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  const naam = (e as { name?: unknown } | null)?.name;
  return [typeof naam === 'string' ? naam : 'Error', typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code) ? code : null].filter(Boolean).join(':');
}

type Veld = string | number | boolean | null | undefined;
export type Niveau = 'info' | 'warn' | 'error';

export function regel(niveau: Niveau, gebeurtenis: string, velden: Record<string, Veld> = {}): string {
  const schoon: Record<string, Veld> = {};
  for (const [k, v] of Object.entries(velden)) schoon[k] = typeof v === 'string' ? maskeer(v).slice(0, 300) : v;
  return JSON.stringify({ t: new Date().toISOString(), niveau, gebeurtenis, ...schoon });
}

export const uitvoer = { schrijf: (niveau: Niveau, tekst: string) => (niveau === 'info' ? console.log(tekst) : console.error(tekst)) };

export function log(niveau: Niveau, gebeurtenis: string, velden: Record<string, Veld> = {}): void {
  uitvoer.schrijf(niveau, regel(niveau, gebeurtenis, velden));
}
