import type { Config } from './config.js';

/** Eén aanroep naar het taalmodel: systeemopdracht en gebruikersbericht in, tekst uit. */
export type LlmClient = (systeem: string, gebruiker: string) => Promise<string>;

const LLM_TIMEOUT_MS = 180_000;

export function maakLlmClient(config: Config): LlmClient {
  return async (systeem, gebruiker) => {
    if (!config.llmBaseUrl || !config.llmApiKey) throw new Error('Taalmodel is niet geconfigureerd');
    const aanroep = () => fetch(`${config.llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.llmApiKey}` },
      body: JSON.stringify({
        model: config.llmModel, temperature: 0.1, max_tokens: 2500,
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
    const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const tekst = data.choices?.[0]?.message?.content;
    if (!tekst) throw new Error('Taalmodel gaf een leeg antwoord');
    return tekst;
  };
}
