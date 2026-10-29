import { afterEach, describe, expect, it } from 'vitest';
import { maakTestApp } from './helpers.js';

const open: Awaited<ReturnType<typeof maakTestApp>>[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });
type T = Awaited<ReturnType<typeof maakTestApp>>;

const SLEUTEL = { 'x-service-key': 'servicesleutel-voor-tests' };
const MCP = { authorization: 'Bearer mcp-sleutel-voor-tests' };

async function opzet() {
  const t = await maakTestApp(); open.push(t);
  const beheer = (await t.api('POST', '/api/employees', { naam: 'Engelbert', telefoon: '0611111111', toestemming: true })).json();
  const daan = (await t.api('POST', '/api/employees', { naam: 'Daan van Hooft', telefoon: '0622222222' })).json();
  const topic = (await t.api('POST', '/api/topics', { titel: 'Goes', eigenaarId: daan.id })).json();
  await t.api('PUT', '/api/instellingen/inkomend', { aan: true });
  return { t, beheer, daan, topic };
}
const bel = async (t: T, nummer: string) => (await t.app.inject({ method: 'POST', url: '/api/intern/inkomend/start', headers: SLEUTEL, payload: { beller: nummer } })).json().callId as string;
const tool = async (t: T, name: string, args: Record<string, unknown>) => {
  const r = await t.app.inject({ method: 'POST', url: '/mcp', headers: MCP, payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } });
  return JSON.parse(r.json().result.content[0].text);
};

describe('MCP-hulpmiddelen tijdens een inkomend gesprek', () => {
  it('vereist de MCP-sleutel en kent de basismethoden', async () => {
    const { t } = await opzet();
    expect((await t.app.inject({ method: 'POST', url: '/mcp', payload: { jsonrpc: '2.0', id: 1, method: 'ping' } })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'POST', url: '/mcp', headers: { authorization: 'Bearer fout' }, payload: { jsonrpc: '2.0', id: 1, method: 'ping' } })).statusCode).toBe(401);
    const lijst = await t.app.inject({ method: 'POST', url: '/mcp', headers: MCP, payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    expect(lijst.json().result.tools.map((x: { name: string }) => x.name)).toEqual(['bevestig_codewoord', 'zoek_punten_van_collega', 'voeg_aandachtspunt_toe']);
    expect((await t.app.inject({ method: 'POST', url: '/mcp', headers: MCP, payload: { jsonrpc: '2.0', method: 'notifications/initialized' } })).statusCode).toBe(202);
  });

  it('geeft niets over een collega zonder codewoord, ook niet aan een beheerder', async () => {
    const { t, beheer } = await opzet();
    await t.api('PUT', `/api/employees/${beheer.id}/overzicht`, { codewoord: 'Zonnebloem' });
    const call = await bel(t, '0611111111');
    expect(await tool(t, 'zoek_punten_van_collega', { gesprek_id: call, medewerker: 'Daan' })).toMatchObject({ ok: false, fout: 'codewoord_nodig' });
    expect(await tool(t, 'voeg_aandachtspunt_toe', { gesprek_id: call, medewerker: 'Daan', onderwerp: 'Goes', tekst: 'Offerte nakijken' })).toMatchObject({ fout: 'codewoord_nodig' });
  });

  it('met het juiste codewoord mag een beheerder punten opvragen en een aandachtspunt toevoegen dat gecontroleerd moet worden', async () => {
    const { t, beheer, daan } = await opzet();
    await t.api('PUT', `/api/employees/${beheer.id}/overzicht`, { codewoord: 'Zonnebloem' });
    const call = await bel(t, '0611111111');
    expect(await tool(t, 'bevestig_codewoord', { gesprek_id: call, codewoord: ' zonne bloem! ' })).toEqual({ ok: true });
    const punten = await tool(t, 'zoek_punten_van_collega', { gesprek_id: call, medewerker: 'daan' });
    expect(punten).toMatchObject({ ok: true, medewerker: 'Daan van Hooft', onderwerpen: [{ titel: 'Goes' }] });
    expect(await tool(t, 'voeg_aandachtspunt_toe', { gesprek_id: call, medewerker: 'Daan', onderwerp: 'goes', tekst: 'Offerte nakijken' })).toMatchObject({ ok: true, onderwerp: 'Goes' });
    const acties = (await t.api('GET', '/api/acties')).json();
    const regel = JSON.stringify(acties);
    expect(regel).toContain('Offerte nakijken');
    expect(regel).toContain('Telefonisch toegevoegd door Engelbert');
    expect(daan.id).toBeTruthy();
  });

  it('weigert een medewerker zonder overzichtsrol, ook met een bestaand codewoord, en blokkeert na drie pogingen', async () => {
    const { t, beheer } = await opzet();
    await t.api('PUT', `/api/employees/${beheer.id}/overzicht`, { codewoord: 'Zonnebloem' });
    const gewoon = await bel(t, '0622222222'); // Daan heeft geen overzichtsrol
    expect(await tool(t, 'bevestig_codewoord', { gesprek_id: gewoon, codewoord: 'Zonnebloem' })).toMatchObject({ ok: false, fout: 'onjuist' });
    const call = await bel(t, '0611111111');
    for (let i = 0; i < 3; i++) expect(await tool(t, 'bevestig_codewoord', { gesprek_id: call, codewoord: 'verkeerd' })).toMatchObject({ fout: 'onjuist' });
    expect(await tool(t, 'bevestig_codewoord', { gesprek_id: call, codewoord: 'Zonnebloem' })).toMatchObject({ fout: 'te_vaak' });
  });

  it('weigert een onbekend of beëindigd gesprek en een te kort codewoord', async () => {
    const { t, beheer } = await opzet();
    expect((await t.api('PUT', `/api/employees/${beheer.id}/overzicht`, { codewoord: 'kort' })).statusCode).toBe(400);
    expect(await tool(t, 'bevestig_codewoord', { gesprek_id: '00000000-0000-4000-8000-000000000000', codewoord: 'x' })).toMatchObject({ fout: 'gesprek_onbekend' });
    await t.api('PUT', `/api/employees/${beheer.id}/overzicht`, { codewoord: 'Zonnebloem' });
    const call = await bel(t, '0611111111');
    await t.app.inject({ method: 'POST', url: `/api/intern/calls/${call}/resultaat`, headers: SLEUTEL, payload: { status: 'gesproken' } });
    expect(await tool(t, 'bevestig_codewoord', { gesprek_id: call, codewoord: 'Zonnebloem' })).toMatchObject({ fout: 'gesprek_onbekend' });
  });

  it('toont het codewoord nooit in de medewerkerslijst en kan de rol intrekken', async () => {
    const { t, beheer } = await opzet();
    await t.api('PUT', `/api/employees/${beheer.id}/overzicht`, { codewoord: 'Zonnebloem' });
    expect(JSON.stringify((await t.api('GET', '/api/employees')).json())).not.toContain('scrypt');
    expect((await t.api('GET', '/api/overzicht-toegang')).json()).toEqual([beheer.id]);
    await t.api('DELETE', `/api/employees/${beheer.id}/overzicht`);
    expect((await t.api('GET', '/api/overzicht-toegang')).json()).toEqual([]);
  });
});
