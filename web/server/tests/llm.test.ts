import { afterEach, describe, expect, it, vi } from 'vitest';
import { maakLlmClient } from '../llm.js';
import type { Config } from '../config.js';

const config = { llmBaseUrl: 'http://llm.test', llmApiKey: 'k', llmModel: 'm' } as Config;
const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: 'antwoord' } }] }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe('taalmodel-client', () => {
  it('probeert het nog één keer na een time-out', async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error('The operation was aborted due to timeout')).mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', f);
    expect(await maakLlmClient(config)('s', 'g')).toBe('antwoord');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('probeert het nog één keer na een 503, maar niet na een 401', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', f);
    expect(await maakLlmClient(config)('s', 'g')).toBe('antwoord');
    const g = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', g);
    await expect(maakLlmClient(config)('s', 'g')).rejects.toThrow('401');
    expect(g).toHaveBeenCalledTimes(1);
  });

  it('geeft de fout door als ook de tweede poging faalt', async () => {
    const f = vi.fn().mockRejectedValue(new Error('timeout'));
    vi.stubGlobal('fetch', f);
    await expect(maakLlmClient(config)('s', 'g')).rejects.toThrow('timeout');
    expect(f).toHaveBeenCalledTimes(2);
  });
});
