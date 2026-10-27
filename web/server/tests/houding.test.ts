import { afterEach, describe, expect, it } from 'vitest';
import { STANDAARD_HOUDING } from '../instellingen.js';
import { puntenVoorGesprek } from '../voor-gesprek.js';
import { maakTestApp } from './helpers.js';

const open: Awaited<ReturnType<typeof maakTestApp>>[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

describe('houding van de assistent', () => {
  it('geeft de standaard, bewaart een eigen tekst en zet de standaard terug bij een lege tekst', async () => {
    const t = await maakTestApp(); open.push(t);
    expect((await t.api('GET', '/api/instellingen/houding')).json()).toEqual({ waarde: STANDAARD_HOUDING, standaard: true });
    const eigen = (await t.api('PUT', '/api/instellingen/houding', { waarde: '  Wees kort en streng.  ' })).json();
    expect(eigen).toEqual({ waarde: 'Wees kort en streng.', standaard: false });
    expect((await t.api('PUT', '/api/instellingen/houding', { waarde: 'Nog een keer' })).json().waarde).toBe('Nog een keer'); // overschrijven
    expect((await t.api('PUT', '/api/instellingen/houding', { waarde: '   ' })).json()).toEqual({ waarde: STANDAARD_HOUDING, standaard: true });
    expect((await t.api('PUT', '/api/instellingen/houding', { waarde: 'x'.repeat(4001) })).statusCode).toBe(400);
  });

  it('is alleen voor de beheerder', async () => {
    const t = await maakTestApp(); open.push(t);
    expect((await t.app.inject({ method: 'GET', url: '/api/instellingen/houding' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'PUT', url: '/api/instellingen/houding', payload: { waarde: 'x' } })).statusCode).toBe(401);
  });

  it('stuurt de houding en te late punten mee bij het bellen', async () => {
    const t = await maakTestApp(); open.push(t);
    await t.api('PUT', '/api/instellingen/houding', { waarde: 'Kritisch maar vriendelijk.' });
    const m = (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678' })).json();
    const topic = (await t.api('POST', '/api/topics', { titel: 'Offertes', eigenaarId: m.id })).json();
    await t.api('POST', `/api/topics/${topic.id}/open-items`, { tekst: 'Offerte versturen', deadline: '2020-01-01' });
    await t.api('POST', `/api/topics/${topic.id}/open-items`, { tekst: 'Planning maken', deadline: '2099-01-01' });
    await t.api('POST', `/api/topics/${topic.id}/open-items`, { tekst: 'Zonder datum' });
    await t.api('POST', `/api/employees/${m.id}/bel`);
    const opdracht = t.opdrachten[0];
    expect(opdracht.houding).toBe('Kritisch maar vriendelijk.');
    expect(opdracht.onderwerpen[0].te_laat_punten).toHaveLength(1);
    expect(opdracht.onderwerpen[0].te_laat_punten![0]).toMatch(/^Offerte versturen \(deadline 2020-01-01, \d+ dagen te laat\)$/);
    expect(opdracht.onderwerpen[0].open_punten).toEqual(['Planning maken (deadline 2099-01-01)', 'Zonder datum']);
  });
});

describe('punten voor het gesprek', () => {
  const p = (o: object) => ({ tekst: 'Actie', deadline: null, eigenaarId: 'a', eigenaarNaam: 'Daan', eigenaarExtern: '', ...o });
  it('noemt de eigenaar alleen als het niet de gebelde collega is, en telt dagen goed', () => {
    const r = puntenVoorGesprek([
      p({ eigenaarId: 'b', eigenaarNaam: 'Jarich', deadline: '2026-11-01' }),
      p({ eigenaarId: null, eigenaarNaam: null, eigenaarExtern: 'Hans', deadline: '2026-11-02' }),
      p({ deadline: '2026-11-02' }),
      p({ deadline: '2026-11-05' }),
    ], '2026-11-02', 'a');
    expect(r.teLaat).toEqual(['Actie (bij Jarich, deadline 2026-11-01, 1 dag te laat)']);
    expect(r.open).toEqual(['Actie (bij Hans, deadline 2026-11-02)', 'Actie (deadline 2026-11-02)', 'Actie (deadline 2026-11-05)']); // vandaag is nog niet te laat
  });
});
