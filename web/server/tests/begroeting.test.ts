import { afterEach, describe, expect, it } from 'vitest';
import { magDoen } from '../rollen.js';
import { STANDAARD_BEGROETING } from '../instellingen.js';
import { maakTestApp, SERVICE_KEY } from './helpers.js';

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });
const SLEUTEL = { 'x-service-key': SERVICE_KEY };
const NUMMER = '+31612345678';

async function opzet() { const t = await maakTestApp(); open.push(t); return t; }

describe('aanpasbare begroeting', () => {
  it('geeft standaard niets eigens en laat de standaardteksten zien', async () => {
    const t = await opzet();
    const r = (await t.api('GET', '/api/instellingen/begroeting')).json();
    expect(r.waarde).toEqual({});
    expect(r.standaard).toEqual(STANDAARD_BEGROETING);
  });

  it('bewaart eigen teksten als één regel, zonder wat gelijk is aan de standaard of leeg is, en zet terug met een lege waarde', async () => {
    const t = await opzet();
    const put = await t.api('PUT', '/api/instellingen/begroeting', { waarde: {
      verkoop_debrief: { opening: '  Zeg\n het   maar. ', aanloopInkomend: STANDAARD_BEGROETING.verkoop_debrief.aanloopInkomend, aanloopUitgaand: '   ' },
      dagboek: { opening: 'Waar zullen we beginnen?' },
    } });
    expect(put.statusCode).toBe(200);
    expect(put.json().waarde).toEqual({ verkoop_debrief: { opening: 'Zeg het maar.' }, dagboek: { opening: 'Waar zullen we beginnen?' } });
    expect((await t.api('PUT', '/api/instellingen/begroeting', { waarde: {} })).json().waarde).toEqual({});
  });

  it('weigert te lange teksten, onbekende gesprekstypen en onbekende velden', async () => {
    const t = await opzet();
    const stuur = (waarde: unknown) => t.api('PUT', '/api/instellingen/begroeting', { waarde });
    expect((await stuur({ dagboek: { opening: 'x'.repeat(201) } })).statusCode).toBe(400);
    expect((await stuur({ onbekend: { opening: 'x' } })).statusCode).toBe(400);
    expect((await stuur({ dagboek: { toestemming: 'x' } })).statusCode).toBe(400);
    expect((await stuur('tekst')).statusCode).toBe(400);
    expect((await t.api('GET', '/api/instellingen/begroeting')).json().waarde).toEqual({});
  });

  it('stuurt de eigen tekst voor het juiste type mee bij een inkomend gesprek', async () => {
    const t = await opzet();
    await t.api('PUT', '/api/instellingen/inkomend', { aan: true });
    await t.api('PUT', '/api/instellingen/begroeting', { waarde: { verkoop_debrief: { opening: 'Zeg het maar.' }, dagboek: { opening: 'Nee deze niet.' } } });
    await t.api('POST', '/api/employees', { naam: 'Irma Test', telefoon: NUMMER, rol: 'accountmanager' });
    const r = (await t.app.inject({ method: 'POST', url: '/api/intern/inkomend/start', headers: SLEUTEL, payload: { beller: NUMMER } })).json();
    expect(r).toMatchObject({ ok: true, type: 'verkoop_debrief', begroeting: { opening: 'Zeg het maar.' } });
  });

  it('stuurt de eigen tekst mee bij Bel nu, ook voor het dagboek', async () => {
    const t = await opzet();
    await t.api('PUT', '/api/instellingen/gespreksmotor', { motor: 'elevenlabs_agent' });
    await t.api('PUT', '/api/instellingen/begroeting', { waarde: { verkoop_debrief: { aanloopUitgaand: 'Ik bel even.' }, dagboek: { openingUitgaand: 'Past het nu?' } } });
    const m = (await t.api('POST', '/api/employees', { naam: 'Irma Test', telefoon: '0612345678', rol: 'accountmanager' })).json();
    await t.api('POST', `/api/employees/${m.id}/bel`, { route: 'rol' });
    expect(t.opdrachten[0]).toMatchObject({ soort: 'verkoop_debrief', begroeting: { aanloopUitgaand: 'Ik bel even.' } });
    const d = (await t.api('POST', '/api/employees', { naam: 'Daan Test', telefoon: '0612345679', rol: 'medewerker' })).json();
    await t.api('POST', `/api/employees/${d.id}/bel`, {});
    expect(t.opdrachten[1].begroeting).toEqual({ openingUitgaand: 'Past het nu?' });
  });

  it('is alleen voor de beheerder', () => {
    for (const rol of ['accountmanager', 'administratie', 'consultant']) for (const m of ['GET', 'PUT']) expect(magDoen(rol, m, '/api/instellingen/begroeting'), `${rol} ${m}`).toBe(false);
  });
});
