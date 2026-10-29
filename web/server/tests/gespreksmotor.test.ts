import { afterEach, describe, expect, it } from 'vitest';
import { maakTestApp } from './helpers.js';

const open: Awaited<ReturnType<typeof maakTestApp>>[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

async function medewerker(t: Awaited<ReturnType<typeof maakTestApp>>) {
  return (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678' })).json();
}

describe('gespreksmotor', () => {
  it('staat standaard op Pipecat, bewaart een keuze en weigert een onbekende motor', async () => {
    const t = await maakTestApp(); open.push(t);
    expect((await t.api('GET', '/api/instellingen/gespreksmotor')).json()).toEqual({ motor: 'pipecat' });
    expect((await t.api('PUT', '/api/instellingen/gespreksmotor', { motor: 'elevenlabs_agent' })).json()).toEqual({ motor: 'elevenlabs_agent' });
    expect((await t.api('PUT', '/api/instellingen/gespreksmotor', { motor: 'pipecat' })).json()).toEqual({ motor: 'pipecat' });
    expect((await t.api('PUT', '/api/instellingen/gespreksmotor', { motor: 'andere' })).statusCode).toBe(400);
  });

  it('stuurt de standaardmotor mee, en een keuze bij Bel nu gaat voor', async () => {
    const t = await maakTestApp(); open.push(t);
    const m = await medewerker(t);
    await t.api('POST', `/api/employees/${m.id}/bel`);
    expect(t.opdrachten[0].engine).toBe('pipecat');
    await t.api('PUT', '/api/instellingen/gespreksmotor', { motor: 'elevenlabs_agent' });
    await t.api('POST', `/api/employees/${m.id}/bel`);
    expect(t.opdrachten[1].engine).toBe('elevenlabs_agent');
    const r = await t.api('POST', `/api/employees/${m.id}/bel`, { motor: 'pipecat' });
    expect(r.statusCode).toBe(202);
    expect(t.opdrachten[2].engine).toBe('pipecat');
    const regels = (await t.api('GET', '/api/calls')).json();
    expect(regels.map((c: { engine: string }) => c.engine).sort()).toEqual(['elevenlabs_agent', 'pipecat', 'pipecat']);
    expect((await t.api('POST', `/api/employees/${m.id}/bel`, { motor: 'x' })).statusCode).toBe(400);
  });

  it('bewaart een beoordeling en wist hem weer', async () => {
    const t = await maakTestApp(); open.push(t);
    const m = await medewerker(t);
    const { callId } = (await t.api('POST', `/api/employees/${m.id}/bel`)).json();
    expect((await t.api('PUT', `/api/calls/${callId}/beoordeling`, { beoordeling: 4, opmerking: ' verstond me goed ' })).statusCode).toBe(200);
    const rij = (await t.api('GET', '/api/calls')).json().find((c: { id: string }) => c.id === callId);
    expect(rij).toMatchObject({ beoordeling: 4, beoordelingOpmerking: 'verstond me goed' });
    expect((await t.api('PUT', `/api/calls/${callId}/beoordeling`, { beoordeling: 6 })).statusCode).toBe(400);
    await t.api('PUT', `/api/calls/${callId}/beoordeling`, { beoordeling: null });
    expect((await t.api('GET', '/api/calls')).json()[0]).toMatchObject({ beoordeling: null, beoordelingOpmerking: null });
    expect((await t.api('PUT', `/api/calls/00000000-0000-4000-8000-000000000000/beoordeling`, { beoordeling: 3 })).statusCode).toBe(404);
  });
});

describe('inkomende gesprekken', () => {
  const intern = (t: Awaited<ReturnType<typeof maakTestApp>>, beller: string) =>
    t.app.inject({ method: 'POST', url: '/api/intern/inkomend/start', headers: { 'x-service-key': 'servicesleutel-voor-tests' }, payload: { beller } });

  it('staat standaard uit en vereist de servicesleutel', async () => {
    const t = await maakTestApp(); open.push(t);
    await medewerker(t);
    expect((await intern(t, '+31612345678')).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'POST', url: '/api/intern/inkomend/start', payload: { beller: '+31612345678' } })).statusCode).toBe(401);
    expect((await t.api('GET', '/api/instellingen/inkomend')).json()).toEqual({ aan: false });
  });

  it('herkent de beller aan het nummer en maakt een gesprek met bron inkomend', async () => {
    const t = await maakTestApp(); open.push(t);
    const m = await medewerker(t);
    await t.api('PUT', '/api/instellingen/inkomend', { aan: true });
    const r = await intern(t, '+31 6 12345678');
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toMatchObject({ ok: true, medewerker: 'Daan', toestemmingNodig: true });
    const regels = (await t.api('GET', '/api/calls')).json();
    expect(regels).toHaveLength(1);
    expect(regels[0]).toMatchObject({ id: body.callId, bron: 'inkomend', status: 'gesprek', employeeId: m.id });
    // Een transcript van voice loopt via dezelfde terugmelding als bij uitgaande gesprekken.
    const res = await t.app.inject({ method: 'POST', url: `/api/intern/calls/${body.callId}/resultaat`, headers: { 'x-service-key': 'servicesleutel-voor-tests' }, payload: { status: 'gesproken', transcript: [{ role: 'user', content: 'Het gaat goed.' }] } });
    expect(res.json()).toEqual({ ok: true });
  });

  it('kent een onbekend of dubbel nummer niet toe en begrenst per uur', async () => {
    const t = await maakTestApp(); open.push(t);
    await medewerker(t);
    await t.api('POST', '/api/employees', { naam: 'Ander', telefoon: '06 12345678' });
    await t.api('PUT', '/api/instellingen/inkomend', { aan: true });
    expect((await intern(t, '+31612345678')).statusCode).toBe(404); // twee medewerkers op één nummer
    expect((await intern(t, '+31699999999')).statusCode).toBe(404);
    expect((await intern(t, 'anoniem')).statusCode).toBe(404);
    await t.api('POST', '/api/employees', { naam: 'Eva', telefoon: '0687654321' });
    for (let i = 0; i < 5; i++) expect((await intern(t, '0687654321')).statusCode).toBe(200);
    expect((await intern(t, '0687654321')).statusCode).toBe(429);
  });
});
