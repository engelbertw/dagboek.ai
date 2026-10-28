import { afterEach, describe, expect, it, vi } from 'vitest';
import { maakVoiceClient } from '../voice.js';
import type { Config } from '../config.js';

const config = { voiceUrl: 'http://voice.test', voiceAdminToken: 't' } as Config;
const opdracht = { telefoonnummer: '0612345678', medewerker: 'X', onderwerpen: [], toestemming_nodig: true, web_call_id: 'w' };

afterEach(() => vi.unstubAllGlobals());

describe('voice-client', () => {
  it('toont bij een 422 welk veld is afgewezen, zonder de ingevoerde waarde', async () => {
    const detail = [{ type: 'too_long', loc: ['body', 'onderwerpen'], msg: 'List should have at most 10 items after validation', input: [{ geheim: 'x' }] }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail }), { status: 422 })));
    const r = await maakVoiceClient(config)(opdracht);
    expect(r).toMatchObject({ gebeld: false, onzeker: false });
    expect((r as { reden: string }).reden).toBe('voice-service gaf 422 (onderwerpen: List should have at most 10 items after validation)');
  });

  it('houdt het bij een 422 zonder leesbare body bij de gewone melding', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nee', { status: 422 })));
    expect(((await maakVoiceClient(config)(opdracht)) as { reden: string }).reden).toBe('voice-service gaf 422');
  });
});
