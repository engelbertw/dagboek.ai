import { afterEach, describe, expect, it, vi } from 'vitest';
import { maakVoiceClient, maakVoiceOpzoeker } from '../voice.js';
import { maakTestApp } from './helpers.js';

afterEach(() => vi.unstubAllGlobals());
const antwoord = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('opzoeken bij voice', () => {
  it('leest het eigen "Onbekend"-antwoord als nooit ontvangen, en een gewone 404 van een oudere versie als "weet ik niet"', async () => {
    const t = await maakTestApp();
    const cfg = { ...t.config, voiceUrl: 'https://voice.test', voiceAdminToken: 'tok' };
    vi.stubGlobal('fetch', antwoord(404, { detail: 'Onbekend' }));
    expect(await maakVoiceOpzoeker(cfg)('abc')).toEqual({ bereikt: true, bekend: false });
    vi.stubGlobal('fetch', antwoord(404, { detail: 'Not Found' }));
    expect(await maakVoiceOpzoeker(cfg)('abc')).toEqual({ bereikt: false });
    vi.stubGlobal('fetch', antwoord(500, {}));
    expect(await maakVoiceOpzoeker(cfg)('abc')).toEqual({ bereikt: false });
    vi.stubGlobal('fetch', antwoord(200, { call_id: 'c1', gebeld: true, onzeker: false }));
    expect(await maakVoiceOpzoeker(cfg)('abc')).toEqual({ bereikt: true, bekend: true, call_id: 'c1', gebeld: true, onzeker: false });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('netwerk'); }));
    expect(await maakVoiceOpzoeker(cfg)('abc')).toEqual({ bereikt: false });
    await t.close();
  });

  it('een time-out of serverfout bij het bellen is onzeker; een weigering (4xx) is dat niet', async () => {
    const t = await maakTestApp();
    const cfg = { ...t.config, voiceUrl: 'https://voice.test', voiceAdminToken: 'tok' };
    const opdracht = { telefoonnummer: '0612345678', medewerker: 'D', onderwerpen: [], toestemming_nodig: true, web_call_id: 'w1' };
    vi.stubGlobal('fetch', vi.fn(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }));
    expect(await maakVoiceClient(cfg)(opdracht)).toMatchObject({ gebeld: false, onzeker: true });
    vi.stubGlobal('fetch', antwoord(503, {}));
    expect(await maakVoiceClient(cfg)(opdracht)).toMatchObject({ gebeld: false, onzeker: true });
    vi.stubGlobal('fetch', antwoord(401, {}));
    const r = await maakVoiceClient(cfg)(opdracht);
    expect(r).toMatchObject({ gebeld: false }); expect((r as any).onzeker).toBeFalsy();
    await t.close();
  });
});
