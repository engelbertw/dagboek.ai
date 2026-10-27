import { afterEach, describe, expect, it } from 'vitest';
import { SERVICE_KEY, maakTestApp } from './helpers.js';

const open: Awaited<ReturnType<typeof maakTestApp>>[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

async function gesprek(antwoord: object, toestemming = true) {
  const t = await maakTestApp({ gebeld: true, call_id: 'v' }, async () => JSON.stringify(antwoord));
  open.push(t);
  const m = (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678', toestemming })).json();
  await t.api('POST', '/api/topics', { titel: 'Offertes', eigenaarId: m.id });
  const { callId } = (await t.api('POST', `/api/employees/${m.id}/bel`)).json();
  await t.app.inject({ method: 'POST', url: `/api/intern/calls/${callId}/resultaat`, headers: { 'x-service-key': SERVICE_KEY }, payload: { status: 'gesproken', transcript: [{ role: 'user', content: 'Ja, dat is goed.' }] } });
  await t.klaarMetAchtergrond();
  return { t, m, callId };
}
const basis = { toestemming: 'gegeven', onderwerpen: [{ nr: 1, besproken: true, samenvatting: 'Besproken.' }] };

describe('suggesties uit een gesprek', () => {
  it('bewaart voorgestelde onderwerpen en verbeteringen met de collega die ze noemde, zonder dubbelen', async () => {
    const { t, m, callId } = await gesprek({ ...basis, suggesties: [
      { soort: 'onderwerp', tekst: 'Wallet-pilot volgen' }, { soort: 'verbetering', tekst: 'Een herinnering per mail' },
      { soort: 'onderwerp', tekst: 'wallet-pilot volgen' }, { soort: 'verbetering', tekst: '   ' },
    ] });
    const lijst = (await t.api('GET', '/api/suggesties')).json();
    expect(lijst.map((s: any) => [s.soort, s.tekst]).sort()).toEqual([['onderwerp', 'Wallet-pilot volgen'], ['verbetering', 'Een herinnering per mail']]);
    expect(lijst[0]).toMatchObject({ employeeId: m.id, employeeNaam: 'Daan', status: 'nieuw' });
    expect(callId).toBeTruthy();
  });

  it('negeert een onbekende soort niet stil: het antwoord is dan niet te lezen en er wordt niets opgeslagen', async () => {
    const { t, callId } = await gesprek({ ...basis, suggesties: [{ soort: 'iets-anders', tekst: 'x' }] });
    expect((await t.api('GET', '/api/suggesties')).json()).toEqual([]);
    expect((await t.api('GET', `/api/calls/${callId}`)).json().samenvattingStatus).toBe('mislukt');
  });

  it('werkt zonder suggesties in het antwoord (oudere vorm)', async () => {
    const { t, callId } = await gesprek(basis);
    expect((await t.api('GET', `/api/calls/${callId}`)).json().samenvattingStatus).toBe('klaar');
    expect((await t.api('GET', '/api/suggesties')).json()).toEqual([]);
  });

  it('bewaart niets als de collega geen toestemming gaf', async () => {
    const { t } = await gesprek({ toestemming: 'geweigerd', onderwerpen: [], suggesties: [{ soort: 'onderwerp', tekst: 'Geheim' }] }, false);
    expect((await t.api('GET', '/api/suggesties')).json()).toEqual([]);
  });
});

describe('suggesties beheren', () => {
  it('neemt een onderwerp over met de voorsteller als eigenaar, en doet dat maar één keer', async () => {
    const { t, m } = await gesprek({ ...basis, suggesties: [{ soort: 'onderwerp', tekst: 'Wallet-pilot volgen' }, { soort: 'verbetering', tekst: 'Mail-herinnering' }] });
    const lijst = (await t.api('GET', '/api/suggesties')).json();
    const so = lijst.find((s: any) => s.soort === 'onderwerp'); const sv = lijst.find((s: any) => s.soort === 'verbetering');

    const r = await t.api('POST', `/api/suggesties/${so.id}/overnemen`, {});
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ titel: 'Wallet-pilot volgen', eigenaarId: m.id, status: 'actief' });
    expect((await t.api('POST', `/api/suggesties/${so.id}/overnemen`, {})).statusCode).toBe(409);
    expect((await t.api('POST', `/api/suggesties/${sv.id}/overnemen`, {})).statusCode).toBe(409); // een verbetering is geen onderwerp
    const na = (await t.api('GET', '/api/suggesties')).json().find((s: any) => s.id === so.id);
    expect(na).toMatchObject({ status: 'overgenomen', topicId: r.json().id });

    expect((await t.api('PATCH', `/api/suggesties/${sv.id}`, { status: 'klaar' })).json().status).toBe('klaar');
    expect((await t.api('PATCH', `/api/suggesties/${sv.id}`, { status: 'overgenomen' })).statusCode).toBe(400); // alleen via overnemen
    expect((await t.api('PATCH', '/api/suggesties/00000000-0000-4000-8000-000000000000', { status: 'klaar' })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/api/suggesties' })).statusCode).toBe(401);
  });
});
