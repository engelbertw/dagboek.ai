import type { Config } from './config.js';
import type { LlmGebruik, LlmMeta } from './ai-functies.js';
import { foutcode } from './log.js';

/** Eén aanroep naar het taalmodel: systeemopdracht en gebruikersbericht in, tekst uit. `meta` zegt voor welke functie (voor het AI-register). */
export type LlmClient = (systeem: string, gebruiker: string, meta?: LlmMeta) => Promise<string>;

const LLM_TIMEOUT_MS = 180_000;

export function maakLlmClient(config: Config, registreer?: (g: LlmGebruik) => void | Promise<void>): LlmClient {
  return async (systeem, gebruiker, meta) => {
    const start = Date.now();
    let tokensIn = 0;
    let tokensUit = 0;
    // Het register is best-effort: een fout bij het vastleggen laat de aanroep zelf nooit mislukken.
    const leg = (uitkomst: 'ok' | 'fout', foutCode?: string) => {
      if (!registreer) return;
      try { void Promise.resolve(registreer({ functie: meta?.functie ?? 'overig', referentie: meta?.referentie, model: config.llmModel, tokensIn, tokensUit, duurMs: Date.now() - start, uitkomst, foutCode })).catch(() => {}); } catch { /* genegeerd */ }
    };
    try {
    if (!config.llmBaseUrl || !config.llmApiKey) throw new Error('Taalmodel is niet geconfigureerd');
    const aanroep = () => fetch(`${config.llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.llmApiKey}` },
      body: JSON.stringify({
        model: config.llmModel, temperature: 0.1, max_tokens: 8000,
        messages: [{ role: 'system', content: systeem }, { role: 'user', content: gebruiker }],
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    // Eén herpoging bij een time-out, netwerkfout of tijdelijke serverfout; andere fouten (bv. 401) hebben geen baat bij nog een keer.
    let r: Response;
    try {
      r = await aanroep();
      if (r.status === 429 || r.status >= 500) r = await aanroep();
    } catch {
      r = await aanroep();
    }
    if (!r.ok) throw new Error(`Taalmodel gaf ${r.status}`);
    const data = (await r.json()) as { choices?: { finish_reason?: string; message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    tokensIn = Number(data.usage?.prompt_tokens) || 0;
    tokensUit = Number(data.usage?.completion_tokens) || 0;
    const reden = data.choices?.[0]?.finish_reason;
    if (reden === 'length' || reden === 'content_filter') throw new Error(`Taalmodel stopte voortijdig (${reden})`);
    const tekst = data.choices?.[0]?.message?.content;
    if (!tekst) throw new Error('Taalmodel gaf een leeg antwoord');
    leg('ok');
    return tekst;
    } catch (e) {
      leg('fout', foutcode(e));
      throw e;
    }
  };
}
