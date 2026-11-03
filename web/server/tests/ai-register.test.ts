import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { maakSessie } from '../auth.js';
import { AI_VERWERKINGEN, ruimAiActiviteitenOp, schrijfActiviteit } from '../ai-register.js';
import { AI_FUNCTIES } from '../ai-functies.js';
import type { Config } from '../config.js';
import { maakLlmClient } from '../llm.js';
import { aiActiviteiten } from '../schema.js';
import { maakTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { vi.unstubAllGlobals(); while (open.length) await open.pop()!.close(); });
const config = { llmBaseUrl: 'http://llm.test', llmApiKey: 'k', llmModel: 'testmodel' } as Config;

describe('AI-register', () => {
  it('legt een aanroep vast met functie, model, tokens en duur, zonder inhoud', async () => {
    const regels: any[] = [];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'geheim antwoord' } }], usage: { prompt_tokens: 120, completion_tokens: 30 } }), { status: 200 })));
    const llm = maakLlmClient(config, (g) => { regels.push(g); });
    expect(await llm('systeem met BSN 123456782', 'transcript van Jan', { functie: 'dagboekverslag', referentie: 'call-1' })).toBe('geheim antwoord');
    expect(regels).toEqual([expect.objectContaining({ functie: 'dagboekverslag', referentie: 'call-1', model: 'testmodel', tokensIn: 120, tokensUit: 30, uitkomst: 'ok' })]);
    expect(JSON.stringify(regels)).not.toMatch(/geheim|BSN|Jan|transcript/);
  });

  it('legt een mislukte aanroep vast en geeft de fout door; zonder meta telt hij als overig', async () => {
    const regels: any[] = [];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    await expect(maakLlmClient(config, (g) => { regels.push(g); })('s', 'g')).rejects.toThrow('401');
    expect(regels[0]).toMatchObject({ functie: 'overig', uitkomst: 'fout', foutCode: 'Error' });
  });

  it('laat een fout bij het vastleggen de aanroep niet breken', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })));
    expect(await maakLlmClient(config, () => { throw new Error('db weg'); })('s', 'g')).toBe('ok');
    expect(await maakLlmClient(config, async () => { throw new Error('db weg'); })('s', 'g')).toBe('ok');
  });

  it('heeft voor elke aanroep van het taalmodel een functie en voor elke functie een inventarisregel', () => {
    const dir = join(__dirname, '..');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && !['llm.ts', 'ai-register.ts'].includes(n))) {
      const tekst = readFileSync(join(dir, f), 'utf8');
      for (const m of tekst.matchAll(/await llm\(/g)) {
        const rest = tekst.slice(m.index!, m.index! + 2500);
        expect(rest.slice(0, rest.indexOf(';\n') + 1), `${f}: aanroep zonder functie`).toMatch(/functie: '/);
      }
    }
    const sleutels = new Set(AI_VERWERKINGEN.map((v) => v.sleutel));
    for (const f of AI_FUNCTIES.filter((x) => x !== 'overig')) expect(sleutels.has(f), f).toBe(true);
    expect(AI_VERWERKINGEN.every((v) => v.doel && v.menselijkeControle && v.bewaartermijn && v.bron)).toBe(true);
  });

  it('toont het register aan de beheerder en weigert andere rollen', async () => {
    const t = await maakTestApp(); open.push(t);
    await schrijfActiviteit(t.db, { functie: 'weekoverzicht', model: 'm', tokensIn: 10, tokensUit: 5, duurMs: 800, uitkomst: 'ok' });
    await schrijfActiviteit(t.db, { functie: 'dagboekverslag', model: 'm', tokensIn: 100, tokensUit: 50, duurMs: 2000, uitkomst: 'fout', foutCode: 'Error', referentie: 'abc' });
    const stand = (await t.api('GET', '/api/ai-register')).json();
    expect(stand.totaal).toEqual({ aanroepen: 2, tokens: 165, fouten: 1 });
    expect(stand.verwerkingen.find((v: any) => v.sleutel === 'weekoverzicht').laatste30Dagen).toMatchObject({ aanroepen: 1 });
    expect(stand.verwerkingen.find((v: any) => v.sleutel === 'dagboekverslag').model).toBe('test');
    expect((await t.api('GET', '/api/ai-register/activiteiten?uitkomst=fout')).json()).toEqual([expect.objectContaining({ functie: 'dagboekverslag', referentie: 'abc' })]);
    expect((await t.api('GET', '/api/ai-register/activiteiten?functie=onzin')).statusCode).toBe(400);
    for (const rol of ['accountmanager', 'consultant', 'administratie']) {
      const cookies = { dagboek_sessie: maakSessie(`${rol}@test.nl`, t.config.sessionSecret, Date.now(), { rol }) };
      expect((await t.app.inject({ method: 'GET', url: '/api/ai-register', cookies })).statusCode, rol).toBe(403);
    }
  });

  it('ruimt oude regels op', async () => {
    const t = await maakTestApp(); open.push(t);
    await t.db.insert(aiActiviteiten).values({ functie: 'weekoverzicht', uitkomst: 'ok', tijdstip: new Date(Date.now() - 400 * 86_400_000) });
    await schrijfActiviteit(t.db, { functie: 'weekoverzicht', model: 'm', tokensIn: 1, tokensUit: 1, duurMs: 1, uitkomst: 'ok' });
    expect(await ruimAiActiviteitenOp(t.db)).toBe(1);
    expect(await t.db.select().from(aiActiviteiten)).toHaveLength(1);
  });
});
