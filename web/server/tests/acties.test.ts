import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { berekenDashboard, type ActieRij } from '../dashboard.js';
import { openItems } from '../schema.js';
import { bepaalEigenaar, bouwGebruikersBericht, geldigeDeadline, vandaagNL } from '../samenvatten.js';
import { SERVICE_KEY, maakTestApp } from './helpers.js';

const VANDAAG = '2026-11-02'; // maandag

describe('deadline en eigenaar uit het gesprek', () => {
  it('neemt alleen echte datums over die niet absurd ver weg liggen', () => {
    expect(geldigeDeadline('2026-11-06', VANDAAG)).toBe('2026-11-06');
    expect(geldigeDeadline('2026-11-30', VANDAAG)).toBe('2026-11-30');
    expect(geldigeDeadline('2026-02-30', VANDAAG)).toBeNull(); // bestaat niet
    expect(geldigeDeadline('vrijdag', VANDAAG)).toBeNull();
    expect(geldigeDeadline('2019-01-01', VANDAAG)).toBeNull(); // te lang geleden
    expect(geldigeDeadline('2040-01-01', VANDAAG)).toBeNull(); // te ver weg
    expect(geldigeDeadline(null, VANDAAG)).toBeNull();
  });

  const team = [{ id: 'a', naam: 'Daan van Hooft' }, { id: 'b', naam: 'Jarich Ypma' }, { id: 'c', naam: 'Jan Smit' }, { id: 'd', naam: 'Jan Bakker' }];
  it('koppelt een naam aan een collega, en laat onbekenden als extern staan', () => {
    expect(bepaalEigenaar('collega', team, 'a')).toEqual({ eigenaarId: 'a', eigenaarExtern: '' });
    expect(bepaalEigenaar('', team, 'a')).toEqual({ eigenaarId: 'a', eigenaarExtern: '' });
    expect(bepaalEigenaar('Jarich', team, 'a')).toEqual({ eigenaarId: 'b', eigenaarExtern: '' });
    expect(bepaalEigenaar('jarich ypma', team, 'a')).toEqual({ eigenaarId: 'b', eigenaarExtern: '' });
    expect(bepaalEigenaar('Jan', team, 'a')).toEqual({ eigenaarId: null, eigenaarExtern: 'Jan' }); // twee Jannen: niet gokken
    expect(bepaalEigenaar('Hans van Holstein', team, 'a')).toEqual({ eigenaarId: null, eigenaarExtern: 'Hans van Holstein' });
  });

  it('geeft het model de datum van vandaag en de collega’s mee', () => {
    const tekst = bouwGebruikersBericht('Daan', [], [{ role: 'user', content: 'ok' }], { vandaag: VANDAAG, collegas: ['Daan', 'Jarich'] });
    expect(tekst).toContain('Vandaag is het 2026-11-02 (maandag).');
    expect(tekst).toContain("Collega's in het team: Daan, Jarich.");
    expect(vandaagNL(new Date('2026-11-02T23:30:00Z'))).toBe('2026-11-03'); // al dinsdag in Nederland
  });
});

const rij = (o: Partial<ActieRij>): ActieRij => ({
  id: Math.random().toString(), tekst: 't', topicId: 'x', topicTitel: 'Onderwerp', eigenaarId: 'a', eigenaarNaam: 'Daan', eigenaarExtern: '',
  deadline: null, status: 'open', createdAt: new Date('2026-10-01T10:00:00Z'), afgerondOp: null, ...o,
});

describe('dashboard', () => {
  it('telt te laat, binnenkort en zonder deadline, en rekent het nakomen uit', () => {
    const d = berekenDashboard([
      rij({ deadline: '2026-10-30' }),                                                                                       // te laat
      rij({ deadline: '2026-11-02' }),                                                                                       // vandaag: nog niet te laat
      rij({ deadline: '2026-11-09' }),                                                                                       // binnenkort (7 dagen)
      rij({ deadline: '2026-11-20' }),                                                                                       // later
      rij({}),                                                                                                               // zonder deadline
      rij({ status: 'afgerond', deadline: '2026-10-28', afgerondOp: new Date('2026-10-28T20:00:00Z') }),                     // op tijd
      rij({ status: 'afgerond', deadline: '2026-10-20', afgerondOp: new Date('2026-10-25T10:00:00Z') }),                     // te laat afgerond
    ], VANDAAG);
    expect(d.totaal).toMatchObject({ open: 5, teLaat: 1, binnenkort: 2, zonderDeadline: 1, opTijd: 1, laatAfgerond: 1 });
    expect(d.totaal.nakoming).toBe(33); // 1 op tijd van 3 (1 op tijd, 1 te laat afgerond, 1 nog open en verlopen)
    expect(d.teLaat).toHaveLength(1);
    expect(d.binnenkort.map((r) => r.deadline)).toEqual(['2026-11-02', '2026-11-09']);
  });

  it('rekent afronden op Nederlandse dagen: 23:30 UTC is al de volgende dag', () => {
    const laat = berekenDashboard([rij({ status: 'afgerond', deadline: '2026-10-28', afgerondOp: new Date('2026-10-28T23:30:00Z') })], VANDAAG); // 00:30 op 29 oktober in NL
    expect(laat.totaal).toMatchObject({ opTijd: 0, laatAfgerond: 1 });
    const tijdig = berekenDashboard([rij({ status: 'afgerond', deadline: '2026-10-28', afgerondOp: new Date('2026-10-28T22:30:00Z') })], VANDAAG); // 23:30 op 28 oktober
    expect(tijdig.totaal).toMatchObject({ opTijd: 1, laatAfgerond: 0, nakoming: 100 });
  });

  it('geeft geen percentage zonder acties met een deadline, en negeert zeer oude deadlines', () => {
    expect(berekenDashboard([rij({})], VANDAAG).totaal.nakoming).toBeNull();
    expect(berekenDashboard([rij({ deadline: '2026-01-01' })], VANDAAG).totaal.nakoming).toBeNull(); // ouder dan 90 dagen
  });

  it('groepeert per eigenaar, ook voor mensen buiten het team, en zet de meeste achterstand bovenaan', () => {
    const d = berekenDashboard([
      rij({ deadline: '2026-10-30' }),
      rij({ eigenaarId: 'b', eigenaarNaam: 'Jarich', deadline: '2026-10-29' }),
      rij({ eigenaarId: 'b', eigenaarNaam: 'Jarich', deadline: '2026-10-28' }),
      rij({ eigenaarId: null, eigenaarNaam: null, eigenaarExtern: 'Hans van Holstein' }),
    ], VANDAAG);
    expect(d.perEigenaar.map((e) => [e.naam, e.teLaat])).toEqual([['Jarich', 2], ['Daan', 1], ['Hans van Holstein (buiten het team)', 0]]);
  });
});

const open: Awaited<ReturnType<typeof maakTestApp>>[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

describe('acties via de api en uit een gesprek', () => {
  it('maakt acties met eigenaar en deadline vanuit het gesprek, met de datum van vandaag in de opdracht', async () => {
    const vandaag = vandaagNL();
    const vragen: string[] = [];
    const t = await maakTestApp({ gebeld: true, call_id: 'v' }, async (_s, g) => {
      vragen.push(g);
      return JSON.stringify({ toestemming: 'gegeven', onderwerpen: [{ nr: 1, besproken: true, samenvatting: 'Stand besproken.', nieuwe_open_punten: [
        { tekst: 'Offerte versturen', eigenaar: 'collega', deadline: vandaag },
        { tekst: 'Aanvraag beoordelen', eigenaar: 'Jarich', deadline: 'volgende week' },
        { tekst: 'Contract aanleveren', eigenaar: 'Hans van Holstein', deadline: null },
        'Losse tekst als actie',
      ] }] });
    });
    open.push(t);
    const daan = (await t.api('POST', '/api/employees', { naam: 'Daan van Hooft', telefoon: '0612345678' })).json();
    const jarich = (await t.api('POST', '/api/employees', { naam: 'Jarich Ypma', telefoon: '0687654321' })).json();
    const topic = (await t.api('POST', '/api/topics', { titel: 'Offertes', eigenaarId: daan.id })).json();
    const { callId } = (await t.api('POST', `/api/employees/${daan.id}/bel`)).json();
    await t.app.inject({ method: 'POST', url: `/api/intern/calls/${callId}/resultaat`, headers: { 'x-service-key': SERVICE_KEY }, payload: { status: 'gesproken', transcript: [{ role: 'user', content: 'Ja, dat is goed. Ik stuur de offerte vandaag.' }] } });
    await t.klaarMetAchtergrond();

    expect(vragen[0]).toContain(`Vandaag is het ${vandaag}`);
    const acties = (await t.api('GET', '/api/acties')).json();
    const per = (tekst: string) => acties.find((a: any) => a.tekst === tekst);
    expect(per('Offerte versturen')).toMatchObject({ eigenaarId: daan.id, deadline: vandaag, topicTitel: 'Offertes' });
    expect(per('Aanvraag beoordelen')).toMatchObject({ eigenaarId: jarich.id, deadline: null }); // 'volgende week' is geen datum
    expect(per('Contract aanleveren')).toMatchObject({ eigenaarId: null, eigenaarExtern: 'Hans van Holstein' });
    expect(per('Losse tekst als actie')).toMatchObject({ eigenaarId: daan.id, deadline: null });
    expect(topic.id).toBe(per('Offerte versturen').topicId);

    const dash = (await t.api('GET', '/api/dashboard')).json();
    expect(dash.totaal).toMatchObject({ open: 4, teLaat: 0, zonderDeadline: 3 });
  });

  it('beheert acties met de api: eigenaar en deadline instellen, afronden, ongeldige invoer weigeren', async () => {
    const t = await maakTestApp();
    open.push(t);
    const m = (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678' })).json();
    const topic = (await t.api('POST', '/api/topics', { titel: 'X', eigenaarId: m.id })).json();
    const a = (await t.api('POST', `/api/topics/${topic.id}/open-items`, { tekst: 'Doe iets' })).json();
    expect(a).toMatchObject({ eigenaarId: m.id, deadline: null }); // standaard: eigenaar van het onderwerp

    expect((await t.api('PATCH', `/api/open-items/${a.id}`, { deadline: '2026-13-45' })).statusCode).toBe(400);
    expect((await t.api('PATCH', `/api/open-items/${a.id}`, { deadline: '2026-02-30' })).statusCode).toBe(400);
    expect((await t.api('PATCH', `/api/open-items/${a.id}`, { eigenaarId: 'geen-uuid' })).statusCode).toBe(400);

    const na = (await t.api('PATCH', `/api/open-items/${a.id}`, { deadline: '2026-11-06', eigenaarId: null, eigenaarExtern: 'Klant' })).json();
    expect(na).toMatchObject({ deadline: '2026-11-06', eigenaarId: null, eigenaarExtern: 'Klant', tekst: 'Doe iets', status: 'open' });

    const klaar = (await t.api('PATCH', `/api/open-items/${a.id}`, { status: 'afgerond' })).json();
    expect(klaar.afgerondOp).toBeTruthy();
    expect(klaar).toMatchObject({ deadline: '2026-11-06', eigenaarExtern: 'Klant' }); // deelwijziging laat de rest met rust
    expect((await t.api('PATCH', `/api/open-items/${a.id}`, { status: 'open' })).json().afgerondOp).toBeNull();
    expect((await t.db.select().from(openItems).where(eq(openItems.id, a.id)))[0].deadline).toBe('2026-11-06');
  });
});
