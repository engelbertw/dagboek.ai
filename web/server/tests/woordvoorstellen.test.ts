import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { maakSessie } from '../auth.js';
import { activiteiten, bezoeken, calls, employees, klantContacten, klanten, updates, woordvoorstellen } from '../schema.js';
import { leesModelVoorstellen, vindKandidaten } from '../woordvoorstellen.js';
import { haalStopwoordenWeg, corrigeerTranscript, type Woord } from '../woordenlijst.js';
import { SERVICE_KEY, maakTestApp } from './helpers.js';

const user = (content: string) => ({ role: 'user', content });

describe('stopwoorden', () => {
  it('haalt uh, uhm, eh weg met de komma erachter en laat de rest ongemoeid', () => {
    expect(haalStopwoordenWeg('Die, uh, zat bij de balie.')).toBe('Die, zat bij de balie.');
    expect(haalStopwoordenWeg('Uhm, ik heb daar Ronbout ook getroffen.')).toBe('Ik heb daar Ronbout ook getroffen.');
    expect(haalStopwoordenWeg('En eh dat was het, uhm.')).toBe('En dat was het.');
    expect(haalStopwoordenWeg('vooruit te schuif-- uh, alvast vooruit')).toBe('vooruit te schuif-- alvast vooruit');
    expect(haalStopwoordenWeg('EH, nee')).toBe('Nee');
  });
  it('raakt hele woorden niet aan en laat ah/oh staan', () => {
    for (const t of ['De zeh en het uhr en hmmm-woord? ah, oh!', 'Dat is behoorlijk heet', 'rehm uhrwerk']) {
      expect(haalStopwoordenWeg(t.replace('hmmm-woord?', 'woord?'))).toBe(t.replace('hmmm-woord?', 'woord?'));
    }
  });
  it('geldt alleen voor wat de beller zei en is herhaalbaar', () => {
    const beurten = [{ role: 'assistant', content: 'Uh, vertel eens' }, user('Uh, dat gaat goed, uhm.')];
    const eerst = corrigeerTranscript(beurten, []);
    expect(eerst.map((m) => m.content)).toEqual(['Uh, vertel eens', 'Dat gaat goed.']);
    expect(corrigeerTranscript(eerst, [])).toEqual(eerst);
  });
});

describe('vindKandidaten', () => {
  const lijst: Woord[] = [{ term: 'iBurgerzaken', soort: 'product', gehoordAls: ['e-burgerzaken'], toelichting: '' }];
  it('stelt i-producten voor bij een e- ervoor en slaat echte e-woorden en bekende varianten over', () => {
    const k = vindKandidaten([user('Bij eKlantgeleiding, eBrondocumenten en e-raadplegen. Ook e-burgerzaken, e-mail en eHerkenning, eenvoudig en echt.')], lijst, []);
    expect(k.map((x) => [x.gehoordAls, x.term])).toEqual([['eKlantgeleiding', 'iKlantgeleiding'], ['eBrondocumenten', 'iBrondocumenten'], ['e-raadplegen', 'iRaadplegen']]);
    expect(k.every((x) => x.soort === 'product' && x.bron === 'e_voorvoegsel')).toBe(true);
  });
  it('stelt een naam voor die bijna gelijk is aan een bekende medewerker of contactpersoon', () => {
    const k = vindKandidaten([user('Ik heb daar Ronbout ook getroffen, en Rombout was er ook, met Roby erbij.')], [], ['Anouk Rombout', 'Pieter Jansen']);
    expect(k.map((x) => [x.gehoordAls, x.term, x.soort])).toEqual([['Ronbout', 'Rombout', 'persoon']]);
  });
  it('houdt zinsbegin en assistentbeurten buiten beschouwing', () => {
    expect(vindKandidaten([{ role: 'assistant', content: 'Ik sprak eKlantgeleiding' }, user('Ronbout was er. Dat was fijn.')], [], ['Rombout'])).toEqual([]);
  });
});

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

async function opzet() {
  const t = await maakTestApp({ gebeld: true, call_id: 'v1' }, async () => JSON.stringify({ toestemming: 'gegeven', toestemming_citaat: 'Ja hoor, dat is goed', onderwerpen: [] }));
  open.push(t);
  return t;
}
const als = (t: T, rol: string) => {
  const cookies = { dagboek_sessie: maakSessie(`${rol}@test.nl`, t.config.sessionSecret, Date.now(), { naam: rol, rol }) };
  return (method: string, url: string, payload?: unknown) => t.app.inject({ method: method as any, url, payload: payload as any, cookies });
};

describe('voorstellen van het taalmodel', () => {
  const beurten = [user('We werken samen met Roby van Pluspunt, versie 52.0 staat klaar.'), { role: 'assistant', content: 'Hallo Rombout' }];
  const lijst: Woord[] = [{ term: 'iBurgerzaken', soort: 'product', gehoordAls: ['e-burgerzaken'], toelichting: '' }];
  it('houdt alleen voorstellen over die letterlijk in een beurt van de beller staan', () => {
    const antwoord = JSON.stringify({ voorstellen: [
      { gehoord_als: 'Roby', voorstel: 'Robbie', soort: 'persoon' },
      { gehoord_als: 'Pluspunt', voorstel: 'Plus Punt', soort: 'onzin' },
      { gehoord_als: '52.0', voorstel: 'v5.2', soort: 'overig' },
      { gehoord_als: 'Hallo', voorstel: 'Hello', soort: 'overig' }, // alleen in de assistent
      { gehoord_als: 'verzonnen', voorstel: 'iets', soort: 'product' },
      { gehoord_als: 'e-burgerzaken', voorstel: 'iBurgerzaken', soort: 'product' }, // al bekend
      { gehoord_als: 'ab', voorstel: 'abc', soort: 'product' }, // te kort
    ] });
    expect(leesModelVoorstellen(`Hier:\n${antwoord}`, beurten, lijst).map((k) => [k.gehoordAls, k.term, k.soort, k.bron])).toEqual([
      ['Roby', 'Robbie', 'persoon', 'model'], ['Pluspunt', 'Plus Punt', 'overig', 'model'], ['52.0', 'v5.2', 'overig', 'model']]);
  });
  it('geeft niets bij rommel', () => {
    for (const a of ['', 'geen json', '{"voorstellen": "x"}', '[1,2]', '{"voorstellen":[null,5]}']) expect(leesModelVoorstellen(a, beurten, [])).toEqual([]);
  });
});

describe('voorstellen uit gesprekken', () => {
  it('maakt voorstellen bij binnenkomst, telt ze op, en laat een afgewezen voorstel niet terugkomen', async () => {
    const t = await opzet();
    await t.db.insert(klantContacten).values({ klantId: (await t.db.insert(klanten).values({ naam: 'Gemeente A' }).returning())[0].id, naam: 'Rombout' });
    const m = (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678', toestemming: false })).json();
    const meld = async () => {
      const { callId } = (await t.api('POST', `/api/employees/${m.id}/bel`)).json();
      await t.app.inject({ method: 'POST', url: `/api/intern/calls/${callId}/resultaat`, headers: { 'x-service-key': SERVICE_KEY },
        payload: { status: 'gesproken', transcript: [{ role: 'assistant', content: 'Vind je dat goed?' }, user('Ja hoor, dat is goed.'), user('We zijn live met eKlantgeleiding, en Ronbout was er uh ook.')] } });
      await t.klaarMetAchtergrond();
      return callId as string;
    };
    const callId = await meld();
    const lijst = async () => (await t.api('GET', '/api/instellingen/woordenlijst/voorstellen')).json();
    expect((await lijst()).map((v: any) => [v.gehoordAls, v.term, v.aantal])).toEqual(expect.arrayContaining([['eKlantgeleiding', 'iKlantgeleiding', 1], ['Ronbout', 'Rombout', 1]]));
    // Stopwoord is uit het transcript.
    expect(JSON.stringify((await t.api('GET', `/api/calls/${callId}`)).json().transcript)).not.toContain(' uh ');
    // Afwijzen: komt niet terug.
    const v = (await lijst()).find((x: any) => x.gehoordAls === 'Ronbout');
    expect((await t.api('POST', `/api/instellingen/woordenlijst/voorstellen/${v.id}`, { besluit: 'afwijzen' })).statusCode).toBe(200);
    expect((await t.api('POST', `/api/instellingen/woordenlijst/voorstellen/${v.id}`, { besluit: 'afwijzen' })).statusCode).toBe(409);
    await meld(); // tweede gesprek met dezelfde woorden
    const na = await lijst();
    expect(na.map((x: any) => x.gehoordAls)).toEqual(['eKlantgeleiding']);
    expect(na[0].aantal).toBe(2);
    expect((await t.db.select().from(woordvoorstellen).where(eq(woordvoorstellen.gehoordAls, 'Ronbout')))[0]).toMatchObject({ status: 'afgewezen', aantal: 1 });
  });

  it('goedkeuren zet het voorstel in de woordenlijst, voegt samen met een bestaande term en weigert een conflict', async () => {
    const t = await opzet();
    await t.db.insert(woordvoorstellen).values([
      { term: 'iKlantgeleiding', gehoordAls: 'eKlantgeleiding', bron: 'e_voorvoegsel', sleutel: 'a' },
      { term: 'iKlantgeleiding', gehoordAls: 'e klantgeleiding', bron: 'e_voorvoegsel', sleutel: 'b' },
      { term: 'X', gehoordAls: 'ab', bron: 'e_voorvoegsel', sleutel: 'c' },
    ]);
    const lijst = (await t.api('GET', '/api/instellingen/woordenlijst/voorstellen')).json();
    const id = (naam: string) => lijst.find((v: any) => v.gehoordAls === naam).id;
    const r = await t.api('POST', `/api/instellingen/woordenlijst/voorstellen/${id('eKlantgeleiding')}`, { besluit: 'goedkeuren' });
    expect(r.json().items).toMatchObject([{ term: 'iKlantgeleiding', soort: 'product', gehoordAls: ['eKlantgeleiding'] }]);
    const tweede = await t.api('POST', `/api/instellingen/woordenlijst/voorstellen/${id('e klantgeleiding')}`, { besluit: 'goedkeuren', term: 'IKLANTGELEIDING' });
    expect(tweede.json().items).toHaveLength(1);
    expect(tweede.json().items[0].gehoordAls).toEqual(['eKlantgeleiding', 'e klantgeleiding']);
    expect((await t.api('POST', `/api/instellingen/woordenlijst/voorstellen/${id('ab')}`, { besluit: 'goedkeuren' })).statusCode).toBe(400); // te korte variant
    expect((await t.db.select().from(woordvoorstellen).where(eq(woordvoorstellen.gehoordAls, 'ab')))[0].status).toBe('voorgesteld');
  });

  it('is alleen voor de beheerder', async () => {
    const t = await opzet();
    for (const rol of ['accountmanager', 'administratie', 'consultant']) {
      const a = als(t, rol);
      expect((await a('GET', '/api/instellingen/woordenlijst/voorstellen')).statusCode, rol).toBe(403);
      expect((await a('POST', '/api/instellingen/woordenlijst/toepassen', { voorbeeld: true })).statusCode, rol).toBe(403);
    }
  });
});

describe('terugwerkend toepassen', () => {
  it('toont eerst een voorbeeld zonder iets te wijzigen en past daarna transcripten en verslagen aan', async () => {
    const t = await opzet();
    await t.api('PUT', '/api/instellingen/woordenlijst', { items: [{ term: 'iBurgerzaken', soort: 'product', gehoordAls: ['e-burgerzaken'], toelichting: '' }, { term: 'Rombout', soort: 'persoon', gehoordAls: ['Ronbout'], toelichting: '' }] });
    const m = (await t.db.insert(employees).values({ naam: 'Daan', telefoon: '0612345678' }).returning())[0];
    const [k] = await t.db.insert(klanten).values({ naam: 'Gemeente A' }).returning();
    const [c] = await t.db.insert(calls).values({ employeeId: m.id, status: 'gesproken', transcript: [{ role: 'user', content: 'Uh, e-burgerzaken is live, zei Ronbout.' }, { role: 'assistant', content: 'e-burgerzaken?' }] }).returning();
    const [b] = await t.db.insert(bezoeken).values({ klantId: k.id, accountmanagerId: m.id, samenvatting: 'Live met e-burgerzaken; Ronbout was er.' }).returning();
    const [a] = await t.db.insert(activiteiten).values({ klantId: k.id, soort: 'actie', omschrijving: 'e-burgerzaken koppelen', citaat: 'e-burgerzaken koppelen' }).returning();
    const [u] = await t.db.insert(updates).values({ topicId: (await t.api('POST', '/api/topics', { titel: 'T' })).json().id, samenvatting: 'Ronbout past e-burgerzaken aan', bron: 'voice' } as any).returning();

    const voor = (await t.api('POST', '/api/instellingen/woordenlijst/toepassen', { voorbeeld: true })).json();
    expect(voor).toMatchObject({ voorbeeld: true, transcripten: 1, teksten: { bezoeken: 1, activiteiten: 1, updates: 1 } });
    expect(voor.regels.length).toBeGreaterThan(0);
    expect((await t.db.select().from(bezoeken).where(eq(bezoeken.id, b.id)))[0].samenvatting).toContain('e-burgerzaken'); // niets gewijzigd

    const echt = (await t.api('POST', '/api/instellingen/woordenlijst/toepassen', { voorbeeld: false })).json();
    expect(echt.voorbeeld).toBe(false);
    expect((await t.db.select().from(calls).where(eq(calls.id, c.id)))[0].transcript).toEqual([{ role: 'user', content: 'iBurgerzaken is live, zei Rombout.' }, { role: 'assistant', content: 'e-burgerzaken?' }]);
    expect((await t.db.select().from(bezoeken).where(eq(bezoeken.id, b.id)))[0].samenvatting).toBe('Live met iBurgerzaken; Rombout was er.');
    expect((await t.db.select().from(activiteiten).where(eq(activiteiten.id, a.id)))[0]).toMatchObject({ omschrijving: 'iBurgerzaken koppelen', citaat: 'iBurgerzaken koppelen' });
    expect((await t.db.select().from(updates).where(eq(updates.id, u.id)))[0].samenvatting).toBe('Rombout past iBurgerzaken aan');
    // Herhalen verandert niets meer.
    expect((await t.api('POST', '/api/instellingen/woordenlijst/toepassen', { voorbeeld: false })).json()).toMatchObject({ transcripten: 0, teksten: {} });
  });
});

describe('modelvoorstellen bij binnenkomst', () => {
  const lang = 'We zijn gisteren bij de gemeente geweest en hebben met Roby van Pluspunt gesproken over de planning van de livegang. '.repeat(3);
  async function melding(llm: (s: string, g: string) => Promise<string>) {
    const t = await maakTestApp({ gebeld: true, call_id: 'v1' }, llm);
    open.push(t);
    const m = (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678', toestemming: false })).json();
    const { callId } = (await t.api('POST', `/api/employees/${m.id}/bel`)).json();
    const r = await t.app.inject({ method: 'POST', url: `/api/intern/calls/${callId}/resultaat`, headers: { 'x-service-key': SERVICE_KEY }, payload: { status: 'gesproken', transcript: [user(lang)] } });
    await t.klaarMetAchtergrond();
    return { t, r };
  }
  it('bewaart een geverifieerd voorstel met bron model en stuurt het transcript als gegevens', async () => {
    const gezien: string[] = [];
    const { t } = await melding(async (systeem, gebruiker) => {
      if (systeem.includes('woordenlijst')) { gezien.push(gebruiker); return JSON.stringify({ voorstellen: [{ gehoord_als: 'Pluspunt', voorstel: 'Plus Punt', soort: 'overig' }, { gehoord_als: 'niet gezegd', voorstel: 'X Y Z', soort: 'overig' }] }); }
      return JSON.stringify({ toestemming: 'gegeven', onderwerpen: [] });
    });
    expect(gezien[0]).toMatch(/^<bekend>.*<\/bekend>\n<namen>.*<\/namen>\n<transcript>/s);
    const rijen = await t.db.select().from(woordvoorstellen).where(eq(woordvoorstellen.bron, 'model'));
    expect(rijen.map((r) => [r.gehoordAls, r.term, r.status])).toEqual([['Pluspunt', 'Plus Punt', 'voorgesteld']]);
  });
  it('blijft stil als het model faalt: het gesprek wordt gewoon verwerkt', async () => {
    const { t, r } = await melding(async () => { throw new Error('llm stuk'); });
    expect(r.statusCode).toBe(200);
    expect(await t.db.select().from(woordvoorstellen).where(eq(woordvoorstellen.bron, 'model'))).toEqual([]);
  });
});
