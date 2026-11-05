import { createHash } from 'node:crypto';
import { klantSleutel } from './debrief-gedeeld.js';
import { leesDatum } from './klanten-import.js';
import { normaliseer } from './vertrouwen.js';

/**
 * Evaluaties uit iThermometer ("Feedback rapport", PDF) uitlezen en beoordelen op dubbelen. Alles hier is een pure functie zonder database of netwerk,
 * zodat het volledig te testen is. Er is bewust geen taalmodel bij betrokken: de tekst wordt alleen gelezen op basis van vaste kopjes.
 *
 * Opbouw van één evaluatie in het rapport: kopregel (gemeente, daaronder "contact · functie · datum"), GEGEVENS (label/waarde-paren), SCORES (label gevolgd
 * door "n/10"), TOELICHTING (vaste vragen met vrije antwoorden), "TOP 3 THEMA'S & DROMEN OP VOLGORDE" en soms "FEEDBACK PER DOMEIN". Een evaluatie kan over
 * meerdere pagina's lopen; elke pagina heeft een voettekst met "Pagina x van y".
 */

export interface Evaluatie {
  gemeente: string;
  datum: string;
  aangemaakt: string | null;
  contact: { naam: string; functie: string; email: string; telefoon: string };
  businessUnit: string;
  scores: { label: string; waarde: number | null }[];
  toelichting: { vraag: string; antwoord: string }[];
  themas: string;
  domeinfeedback: string;
}
export interface NietLeesbaar { titel: string; reden: string }
export interface Uitgelezen { evaluaties: Evaluatie[]; nietLeesbaar: NietLeesbaar[] }

export class GeenFeedbackRapport extends Error {}

const SECTIES = ['GEGEVENS', 'SCORES', 'TOELICHTING', "TOP 3 THEMA'S & DROMEN OP VOLGORDE", 'FEEDBACK PER DOMEIN'] as const;
const GEGEVENS_LABELS = ['Gemeente', 'Datum', 'Contactpersoon', 'Functie', 'E-mail', 'Mobiel', 'Business unit', 'Aangemaakt op'] as const;
/** De vaste vragen uit de toelichting. Een onbekende regel hoort bij het vorige antwoord, dus er gaat nooit tekst verloren als iThermometer een vraag wijzigt. */
const TOELICHTING_VRAGEN = [
  'Reden voor score',
  'Wat moeten we vooral blijven doen?',
  'Wat moeten we als eerste verbeteren?',
  'Welke ondersteuning of samenwerking verwacht je de komende 12 maanden van ons?',
];
const STREEP = /^[-–—]+$/;
const schoon = (w: string) => (STREEP.test(w.trim()) ? '' : w.trim());

function regelsVanPagina(tekst: string): string[] {
  const regels = tekst.replace(/\r\n?/g, '\n').split('\n').map((r) => r.replace(/\s+$/, ''));
  while (regels.length && !regels[regels.length - 1].trim()) regels.pop();
  // Voettekst: "<gemeente>" gevolgd door "Pagina x van y".
  if (regels.length && /^Pagina \d+ van \d+$/.test(regels[regels.length - 1].trim())) { regels.pop(); if (regels.length) regels.pop(); }
  return regels;
}

function secties(blok: string[]): Map<string, string[]> {
  const uit = new Map<string, string[]>();
  let huidig = '';
  for (const r of blok) {
    const t = r.trim();
    if ((SECTIES as readonly string[]).includes(t)) { huidig = t; if (!uit.has(huidig)) uit.set(huidig, []); continue; }
    if (huidig) uit.get(huidig)!.push(r);
  }
  return uit;
}

function leesGegevens(regels: string[]): Record<string, string> {
  const uit: Record<string, string> = {};
  let sleutel = '';
  for (const r of regels) {
    const t = r.trim();
    if (!t) continue;
    if ((GEGEVENS_LABELS as readonly string[]).includes(t) && !(t in uit)) { sleutel = t; uit[sleutel] = ''; continue; }
    if (sleutel) uit[sleutel] = uit[sleutel] ? `${uit[sleutel]} ${t}` : t; // een lange functie loopt over twee regels
  }
  return uit;
}

function leesScores(regels: string[]): Evaluatie['scores'] {
  const uit: Evaluatie['scores'] = [];
  let label: string[] = [];
  for (const r of regels) {
    const t = r.trim();
    if (!t) continue;
    const m = /^(\d{1,2})\s*\/\s*10$/.exec(t);
    if (m && label.length) { uit.push({ label: label.join(' '), waarde: Number(m[1]) <= 10 ? Number(m[1]) : null }); label = []; continue; }
    if (STREEP.test(t) && label.length) { uit.push({ label: label.join(' '), waarde: null }); label = []; continue; }
    label.push(t);
  }
  return uit;
}

function leesToelichting(regels: string[]): Evaluatie['toelichting'] {
  const uit: { vraag: string; regels: string[] }[] = [];
  for (const r of regels) {
    const vraag = TOELICHTING_VRAGEN.find((v) => v.toLowerCase() === r.trim().toLowerCase());
    if (vraag) { uit.push({ vraag, regels: [] }); continue; }
    if (!uit.length) { if (!r.trim()) continue; uit.push({ vraag: '', regels: [] }); }
    uit[uit.length - 1].regels.push(r.trim());
  }
  return uit.map((u) => ({ vraag: u.vraag, antwoord: schoon(u.regels.join('\n').trim()) }));
}

const blok = (regels: string[] | undefined) => schoon((regels ?? []).map((r) => r.trimEnd()).join('\n').trim());

/** Leest de tekst per pagina van een iThermometer-feedbackrapport. Gooit `GeenFeedbackRapport` als dit er niet uitziet als zo'n rapport. */
export function leesFeedbackRapport(paginas: string[]): Uitgelezen {
  const regels = paginas.flatMap(regelsVanPagina);
  const starts = regels.map((r, i) => (r.trim() === 'GEGEVENS' ? i : -1)).filter((i) => i >= 0);
  if (!starts.length) throw new GeenFeedbackRapport('Dit lijkt geen iThermometer-feedbackrapport: er zijn geen evaluaties met "GEGEVENS" gevonden.');
  const evaluaties: Evaluatie[] = [];
  const nietLeesbaar: NietLeesbaar[] = [];
  starts.forEach((start, n) => {
    // Twee regels boven GEGEVENS staan de gemeente en de kopregel van deze evaluatie; het blok van de vorige evaluatie eindigt daarvoor.
    const begin = Math.max(start - 2, n ? starts[n - 1] + 1 : 0);
    const einde = n + 1 < starts.length ? Math.max(starts[n + 1] - 2, start + 1) : regels.length;
    const titel = (regels[start - 2] ?? '').trim() || `Evaluatie ${n + 1}`;
    const s = secties(regels.slice(begin, einde));
    const g = leesGegevens(s.get('GEGEVENS') ?? []);
    const datum = leesDatum(g['Datum'] ?? '');
    const scores = leesScores(s.get('SCORES') ?? []);
    const reden = !g['Gemeente'] ? 'geen gemeente' : !datum ? 'geen geldige datum' : !scores.length ? 'geen scores' : null;
    if (reden) { nietLeesbaar.push({ titel, reden }); return; }
    evaluaties.push({
      gemeente: g['Gemeente'], datum: datum!, aangemaakt: leesDatum(g['Aangemaakt op'] ?? ''),
      contact: { naam: schoon(g['Contactpersoon'] ?? ''), functie: schoon(g['Functie'] ?? ''), email: schoon(g['E-mail'] ?? ''), telefoon: schoon(g['Mobiel'] ?? '') },
      businessUnit: schoon(g['Business unit'] ?? ''), scores, toelichting: leesToelichting(s.get('TOELICHTING') ?? []),
      themas: blok(s.get("TOP 3 THEMA'S & DROMEN OP VOLGORDE")), domeinfeedback: blok(s.get('FEEDBACK PER DOMEIN')),
    });
  });
  return { evaluaties, nietLeesbaar };
}

// ── Dubbelen ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const spaties = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Identiteit van een evaluatie: welke gemeente, wanneer, met wie en voor welke business unit. Dezelfde evaluatie in een nieuwe export krijgt dezelfde sleutel. */
export function evaluatieSleutel(e: Evaluatie): string {
  return hash([klantSleutel(e.gemeente), e.datum, normaliseer(e.contact.naam), normaliseer(e.businessUnit), e.aangemaakt ?? ''].join('|'));
}
/** Inhoud van een evaluatie (scores en antwoorden). Regelafbrekingen en spaties tellen niet mee, zodat een andere paginabreedte geen 'wijziging' geeft. */
export function evaluatieInhoudHash(e: Evaluatie): string {
  return hash(JSON.stringify({
    s: e.scores.map((x) => [spaties(x.label), x.waarde]), t: e.toelichting.map((x) => [spaties(x.vraag), spaties(x.antwoord)]), th: spaties(e.themas), d: spaties(e.domeinfeedback),
  }));
}

const TUSSENVOEGSELS = new Set(['van', 'der', 'de', 'den', 'ten', 'ter', 'het', 'te', 'op', 'in', 'la', 'le']);
/** Een hint: lijkt het e-mailadres bij de naam van de contactpersoon te horen? Alleen een signaal voor de beheerder, geen besluit. */
export function emailLijktBijNaam(naam: string, email: string): boolean {
  const lokaal = normaliseer(email.split('@')[0] ?? '').replace(/\s+/g, '');
  const delen = normaliseer(naam.normalize('NFD').replace(/[̀-ͯ]/g, '')).split(' ').filter((d) => d.length >= 3 && !TUSSENVOEGSELS.has(d));
  if (!lokaal || !delen.length) return true;
  return delen.some((d) => lokaal.includes(d)) || delen.some((d) => d.length >= 4 && lokaal.includes(d.slice(0, 4)));
}

export type EvaluatieStatus = 'nieuw' | 'al_aanwezig' | 'gewijzigd' | 'dubbel_in_bestand';
export interface Beoordeeld {
  evaluatie: Evaluatie;
  sleutel: string;
  status: EvaluatieStatus;
  /** Alleen bij 'dubbel_in_bestand': dezelfde evaluatie staat er nogmaals in, maar met andere inhoud. */
  afwijkend: boolean;
  klantId: string | null;
  /** 'nieuw': de contactpersoon staat nog niet bij de gemeente; 'bestaat': al bekend; 'geen': geen naam in de evaluatie. */
  contact: 'nieuw' | 'bestaat' | 'geen';
  emailTwijfel: boolean;
}
export interface BestaandeEvaluatie { sleutel: string; inhoudHash: string }

export function beoordeelEvaluaties(
  evaluaties: Evaluatie[],
  bestaand: BestaandeEvaluatie[],
  klanten: { id: string; naam: string }[],
  contacten: { klantId: string; naam: string }[],
): Beoordeeld[] {
  const inDb = new Map(bestaand.map((b) => [b.sleutel, b.inhoudHash]));
  const perKlant = new Map(klanten.map((k) => [klantSleutel(k.naam), k.id]));
  const gezien = new Map<string, string>();
  return evaluaties.map((e): Beoordeeld => {
    const sleutel = evaluatieSleutel(e), inhoud = evaluatieInhoudHash(e);
    const klantId = perKlant.get(klantSleutel(e.gemeente)) ?? null;
    let status: EvaluatieStatus, afwijkend = false;
    if (gezien.has(sleutel)) { status = 'dubbel_in_bestand'; afwijkend = gezien.get(sleutel) !== inhoud; }
    else {
      gezien.set(sleutel, inhoud);
      status = !inDb.has(sleutel) ? 'nieuw' : inDb.get(sleutel) === inhoud ? 'al_aanwezig' : 'gewijzigd';
    }
    const naam = normaliseer(e.contact.naam);
    const contact = !naam ? 'geen' : klantId && contacten.some((c) => c.klantId === klantId && normaliseer(c.naam) === naam) ? 'bestaat' : 'nieuw';
    return { evaluatie: e, sleutel, status, afwijkend, klantId, contact, emailTwijfel: !!e.contact.email && !!e.contact.naam && !emailLijktBijNaam(e.contact.naam, e.contact.email) };
  });
}

export function samenvatting(b: Beoordeeld[], nietLeesbaar: number): Record<EvaluatieStatus | 'nietLeesbaar' | 'gemeenteOnbekend', number> {
  const tel = (s: EvaluatieStatus) => b.filter((x) => x.status === s).length;
  return { nieuw: tel('nieuw'), al_aanwezig: tel('al_aanwezig'), gewijzigd: tel('gewijzigd'), dubbel_in_bestand: tel('dubbel_in_bestand'), nietLeesbaar, gemeenteOnbekend: b.filter((x) => x.status !== 'dubbel_in_bestand' && !x.klantId).length };
}

// ── PDF lezen ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const MAX_PDF_BYTES = 10_000_000;
export const MAX_PAGINAS = 300;

/** De tekst per pagina. unpdf is pure JavaScript (geen native module) en wordt pas geladen als er echt een PDF binnenkomt. */
export async function leesPdfPaginas(buf: Buffer): Promise<string[]> {
  if (buf.length > MAX_PDF_BYTES) throw new GeenFeedbackRapport('Het bestand is te groot (maximaal 10 MB).');
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new GeenFeedbackRapport('Dit is geen PDF-bestand.');
  const { extractText, getDocumentProxy } = await import('unpdf');
  let pdf;
  try { pdf = await getDocumentProxy(new Uint8Array(buf)); } catch { throw new GeenFeedbackRapport('Dit PDF-bestand kon niet worden gelezen.'); }
  if (pdf.numPages > MAX_PAGINAS) throw new GeenFeedbackRapport(`Het bestand heeft te veel pagina's (maximaal ${MAX_PAGINAS}).`);
  try { return (await extractText(pdf, { mergePages: false })).text; } catch { throw new GeenFeedbackRapport('De tekst in dit PDF-bestand kon niet worden gelezen.'); }
}
