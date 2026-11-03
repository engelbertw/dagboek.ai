import { afterEach, describe, expect, it } from 'vitest';
import { maakSessie } from '../auth.js';
import { citaatKomtVoor } from '../vertrouwen.js';
import { WOORDENLIJST_REGEL, corrigeerTranscript, leesWoordenlijstTekst, woordenlijstSchema, woordenlijstVoorPrompt, type Woord } from '../woordenlijst.js';
import { SERVICE_KEY, maakTestApp } from './helpers.js';

const LIJST: Woord[] = [
  { term: 'iBurgerzaken', soort: 'product', gehoordAls: ['e-burgerzaken', 'eburgerzaken'], toelichting: '' },
  { term: 'iBrondocument', soort: 'product', gehoordAls: ['e-bron document', 'e-brondocument'], toelichting: '' },
  { term: 'P&S', soort: 'afdeling', gehoordAls: ['PNS', 'P N S'], toelichting: 'business unit Proces & Services' },
];
const user = (content: string) => ({ role: 'user', content });

describe('corrigeerTranscript', () => {
  it('zet verkeerd gehoorde producten en afdelingen goed, ook met andere hoofdletters en spaties', () => {
    const uit = corrigeerTranscript([
      user('We gebruiken e-burgerzaken en E-Burgerzaken en eburgerzaken.'),
      user('De e-Bron document module en het e-brondocument.'),
      user('Dat is van PNS, of van P N S.'),
    ], LIJST);
    expect(uit.map((m) => m.content)).toEqual([
      'We gebruiken iBurgerzaken en iBurgerzaken en iBurgerzaken.',
      'De iBrondocument module en het iBrondocument.',
      'Dat is van P&S, of van P&S.',
    ]);
  });

  it('vervangt alleen hele woorden', () => {
    const uit = corrigeerTranscript([user('De pnsx en expns en e-burgerzakenwet blijven staan, maar PNS niet.')], LIJST);
    expect(uit[0].content).toBe('De pnsx en expns en e-burgerzakenwet blijven staan, maar P&S niet.');
  });

  it('is idempotent en raakt de assistent en onbekende beurten niet aan', () => {
    const beurten = [{ role: 'assistant', content: 'Heb je het over e-burgerzaken?' }, user('Ja, e-burgerzaken'), null as any, { role: 'user', content: 5 as any }];
    const eerst = corrigeerTranscript(beurten, LIJST);
    expect(eerst[0].content).toBe('Heb je het over e-burgerzaken?');
    expect(eerst[1].content).toBe('Ja, iBurgerzaken');
    expect(corrigeerTranscript(eerst, LIJST)).toEqual(eerst);
    expect(beurten[1].content).toBe('Ja, e-burgerzaken'); // de invoer is niet gewijzigd
  });

  it('doet niets zonder lijst of zonder varianten', () => {
    const b = [user('e-burgerzaken')];
    expect(corrigeerTranscript(b, [])).toEqual(b);
    expect(corrigeerTranscript(b, [{ term: 'X', soort: 'overig', gehoordAls: [], toelichting: '' }])).toEqual(b);
  });

  it('laat een citaat met de goede schrijfwijze kloppen met het gecorrigeerde transcript', () => {
    const t = corrigeerTranscript([user('We zijn live met e-burgerzaken sinds maandag')], LIJST);
    expect(citaatKomtVoor('live met iBurgerzaken', t)).toBe(true);
  });
});

describe('woordenlijst valideren en voor het model', () => {
  it('weigert dubbele termen, te korte varianten en varianten die een term zijn of bij twee termen staan', () => {
    const w = (term: string, gehoordAls: string[]) => ({ term, soort: 'product', gehoordAls, toelichting: '' });
    expect(woordenlijstSchema.safeParse([w('A', []), w('a', [])]).success).toBe(false);
    expect(woordenlijstSchema.safeParse([w('iBurgerzaken', ['ab'])]).success).toBe(false);
    expect(woordenlijstSchema.safeParse([w('iBurgerzaken', []), w('X-term', ['iburgerzaken'])]).success).toBe(false);
    expect(woordenlijstSchema.safeParse([w('iBurgerzaken', ['e-burgerzaken']), w('iBron', ['E burgerzaken'])]).success).toBe(false);
    expect(woordenlijstSchema.safeParse(Array.from({ length: 201 }, (_, i) => w(`t${i}`, []))).success).toBe(false);
    expect(woordenlijstSchema.safeParse(LIJST).success).toBe(true);
  });

  it('leest kapotte opgeslagen tekst als lege lijst', () => {
    expect(leesWoordenlijstTekst('geen json')).toEqual([]);
    expect(leesWoordenlijstTekst(JSON.stringify([{ term: '' }]))).toEqual([]);
  });

  it('maakt één schone regel met termen en toelichting', () => {
    const regel = woordenlijstVoorPrompt([...LIJST, { term: 'Boos\n# kop <b>', soort: 'overig', gehoordAls: [], toelichting: 'x' }]);
    expect(regel).toContain('iBurgerzaken (product)');
    expect(regel).toContain('P&S (afdeling: business unit Proces & Services)');
    expect(regel).not.toMatch(/[\n<>]/); // één regel, geen tags
    expect(woordenlijstVoorPrompt([])).toBe('');
  });
});

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

describe('woordenlijst: instellingen en verwerking', () => {
  it('bewaart en geeft de lijst terug met de vorige versie, en weigert ongeldige invoer', async () => {
    const t = await maakTestApp(); open.push(t);
    expect((await t.api('GET', '/api/instellingen/woordenlijst')).json()).toEqual({ items: [], vorige: [] });
    expect((await t.api('PUT', '/api/instellingen/woordenlijst', { items: LIJST })).json().items).toHaveLength(3);
    const tweede = (await t.api('PUT', '/api/instellingen/woordenlijst', { items: [LIJST[0]] })).json();
    expect(tweede.items).toHaveLength(1);
    expect(tweede.vorige).toHaveLength(3);
    expect((await t.api('PUT', '/api/instellingen/woordenlijst', { items: [{ term: 'A', gehoordAls: ['ab'] }] })).statusCode).toBe(400);
  });

  it('is alleen voor de beheerder', async () => {
    const t = await maakTestApp(); open.push(t);
    for (const rol of ['accountmanager', 'administratie', 'consultant']) {
      const cookies = { dagboek_sessie: maakSessie(`${rol}@test.nl`, t.config.sessionSecret, Date.now(), { naam: rol, rol }) };
      expect((await t.app.inject({ method: 'GET', url: '/api/instellingen/woordenlijst', cookies })).statusCode, rol).toBe(403);
      expect((await t.app.inject({ method: 'PUT', url: '/api/instellingen/woordenlijst', payload: { items: [] }, cookies })).statusCode, rol).toBe(403);
    }
  });

  it('corrigeert het transcript bij binnenkomst en geeft het taalmodel de lijst als hint', async () => {
    const vragen: { systeem: string; gebruiker: string }[] = [];
    const antwoord = JSON.stringify({ toestemming: 'gegeven', toestemming_citaat: 'Ja hoor, dat is goed', onderwerpen: [] });
    const t = await maakTestApp({ gebeld: true, call_id: 'v1' }, async (systeem, gebruiker) => { vragen.push({ systeem, gebruiker }); return antwoord; }); open.push(t);
    await t.api('PUT', '/api/instellingen/woordenlijst', { items: LIJST });
    const m = (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678', toestemming: false })).json();
    await t.api('POST', '/api/topics', { titel: 'Offertes', eigenaarId: m.id });
    const { callId } = (await t.api('POST', `/api/employees/${m.id}/bel`)).json();
    const transcript = [
      { role: 'assistant', content: 'Goedemorgen Daan. Ik maak een samenvatting. Vind je dat goed?' },
      user('Ja hoor, dat is goed.'),
      { role: 'assistant', content: 'Hoe staat het?' },
      user('We zijn live met e-burgerzaken, en het PNS team helpt.'),
    ];
    await t.app.inject({ method: 'POST', url: `/api/intern/calls/${callId}/resultaat`, headers: { 'x-service-key': SERVICE_KEY }, payload: { status: 'gesproken', transcript } });
    await t.klaarMetAchtergrond();
    const call = (await t.api('GET', `/api/calls/${callId}`)).json();
    const opgeslagen = JSON.stringify(call.transcript ?? []);
    expect(opgeslagen).toContain('live met iBurgerzaken, en het P&S team');
    expect(vragen).toHaveLength(1);
    expect(vragen[0].gebruiker).toContain('Schrijfwijze van producten en afdelingen: iBurgerzaken (product)');
    expect(vragen[0].gebruiker).toContain('live met iBurgerzaken');
    expect(vragen[0].systeem).toContain(WOORDENLIJST_REGEL);
  });

  it('laat zonder lijst alles zoals het was: geen hint en geen extra regel', async () => {
    const vragen: { systeem: string; gebruiker: string }[] = [];
    const t = await maakTestApp({ gebeld: true, call_id: 'v1' }, async (systeem, gebruiker) => { vragen.push({ systeem, gebruiker }); return JSON.stringify({ toestemming: 'gegeven', toestemming_citaat: 'Ja hoor, dat is goed', onderwerpen: [] }); }); open.push(t);
    const m = (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678', toestemming: false })).json();
    await t.api('POST', '/api/topics', { titel: 'Offertes', eigenaarId: m.id });
    const { callId } = (await t.api('POST', `/api/employees/${m.id}/bel`)).json();
    await t.app.inject({ method: 'POST', url: `/api/intern/calls/${callId}/resultaat`, headers: { 'x-service-key': SERVICE_KEY },
      payload: { status: 'gesproken', transcript: [{ role: 'assistant', content: 'Vind je dat goed?' }, user('Ja hoor, dat is goed.'), user('Over e-burgerzaken.')] } });
    await t.klaarMetAchtergrond();
    expect(vragen[0].gebruiker).not.toContain('Schrijfwijze');
    expect(vragen[0].gebruiker).toContain('e-burgerzaken');
    expect(vragen[0].systeem).not.toContain(WOORDENLIJST_REGEL);
  });
});
