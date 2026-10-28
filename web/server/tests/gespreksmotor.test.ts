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
