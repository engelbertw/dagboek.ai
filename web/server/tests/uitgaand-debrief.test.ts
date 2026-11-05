import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { calls } from '../schema.js';
import { registreerVariant, verwijderVariant } from '../consultant-varianten.js';
import { STANDAARD_DEBRIEF_VRAGEN } from '../instellingen.js';
import { tik } from '../scheduler.js';
import { maakTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); verwijderVariant('project'); });
beforeEach(() => registreerVariant({
  id: 'project', naam: 'projectdebrief', promptVersie: 'consultant-project-v1', trefwoorden: ['project'], standaardVragen: '1. Projectdoel: wat is het doel van het project?',
  promptAanvulling: '', schema: z.object({}),
}));

async function opzet(rol: 'accountmanager' | 'medewerker', opties: { consultant?: boolean; flag?: boolean; agent?: boolean } = {}) {
  const t = await maakTestApp(); open.push(t);
  if (opties.agent !== false) await t.api('PUT', '/api/instellingen/gespreksmotor', { motor: 'elevenlabs_agent' });
  if (opties.flag) await t.api('PUT', '/api/instellingen/consultant-debrief', { aan: true });
  const m = (await t.api('POST', '/api/employees', { naam: 'Irma Test', telefoon: '0612345678', rol, consultant: !!opties.consultant })).json();
  return { t, m };
}
const typeVan = async (t: T, callId: string) => (await t.db.select().from(calls).where(eq(calls.id, callId)))[0];

describe("Bel nu: gesprekstype volgt de rol als daarom gevraagd wordt", () => {
  it('belt een accountmanager voor een verkoop-debrief, met de debrieflijst en zonder dagboekonderwerpen', async () => {
    const { t, m } = await opzet('accountmanager');
    const r = await t.api('POST', `/api/employees/${m.id}/bel`, { route: 'rol' });
    expect(r.statusCode).toBe(202);
    expect(t.opdrachten[0]).toMatchObject({ soort: 'verkoop_debrief', onderwerpen: [], engine: 'elevenlabs_agent', instructie: STANDAARD_DEBRIEF_VRAGEN, toestemming_nodig: true, varianten: [], voorstel: null });
    expect(await typeVan(t, r.json().callId)).toMatchObject({ type: 'verkoop_debrief', bron: 'handmatig', onderwerpen: [] });
  });

  it('belt een consultant voor een consultantdebrief als de consultantroute aan staat', async () => {
    const { t, m } = await opzet('medewerker', { consultant: true, flag: true });
    const r = await t.api('POST', `/api/employees/${m.id}/bel`, { route: 'rol' });
    expect(t.opdrachten[0]).toMatchObject({ soort: 'consultant_debrief', varianten: ['project'] });
    expect(t.opdrachten[0].instructie).toContain('## projectdebrief');
    expect((await typeVan(t, r.json().callId)).type).toBe('consultant_debrief');
  });

  it('laat de keuze in het gesprek bij een dubbele rol', async () => {
    const { t, m } = await opzet('accountmanager', { consultant: true, flag: true });
    const r = await t.api('POST', `/api/employees/${m.id}/bel`, { route: 'rol' });
    expect(t.opdrachten[0]).toMatchObject({ soort: 'debrief_keuze' });
    expect(t.opdrachten[0].instructie).toContain('# Verkoop-debrief');
    expect((await typeVan(t, r.json().callId)).type).toBe('debrief_keuze');
  });

  it('valt terug op het dagboek zolang de consultantroute uit staat', async () => {
    const { t, m } = await opzet('medewerker', { consultant: true, flag: false });
    const r = await t.api('POST', `/api/employees/${m.id}/bel`, { route: 'rol' });
    expect(r.statusCode).toBe(202);
    expect(t.opdrachten[0].soort).toBeUndefined();
    expect((await typeVan(t, r.json().callId)).type).toBe('dagboek');
  });

  it('blijft een dagboekgesprek zonder route, met route dagboek en voor een gewone medewerker', async () => {
    const { t, m } = await opzet('accountmanager');
    await t.api('POST', `/api/employees/${m.id}/bel`);
    await t.api('POST', `/api/employees/${m.id}/bel`, { route: 'dagboek' });
    const gewoon = (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0687654321', rol: 'medewerker' })).json();
    await t.api('POST', `/api/employees/${gewoon.id}/bel`, { route: 'rol' });
    expect(t.opdrachten.map((o) => o.soort)).toEqual([undefined, undefined, undefined]);
    expect((await t.db.select().from(calls)).every((c) => c.type === 'dagboek')).toBe(true);
    expect((await t.api('POST', `/api/employees/${m.id}/bel`, { route: 'iets' })).statusCode).toBe(400);
  });

  it('weigert een debrief met Pipecat en belt dan niet', async () => {
    const { t, m } = await opzet('accountmanager', { agent: false });
    const r = await t.api('POST', `/api/employees/${m.id}/bel`, { route: 'rol' });
    expect(r.statusCode).toBe(409);
    expect(r.json().fout).toContain('ElevenLabs-agent');
    expect(t.opdrachten).toHaveLength(0);
    expect(await t.db.select().from(calls)).toHaveLength(0);
  });
});

describe('een geplande poging blijft een dagboekgesprek', () => {
  it('negeert de rol van de medewerker bij een planning', async () => {
    const { t, m } = await opzet('accountmanager');
    await t.api('POST', '/api/plannings', { naam: 'Ochtend', dagen: [1, 2, 3, 4, 5, 6, 7], tijden: ['09:00'], maxPogingen: 1, employeeIds: [m.id] });
    await tik({ db: t.db, voice: async (o) => { t.opdrachten.push(o); return { gebeld: true, call_id: 'v' }; }, wacht: async () => {} }, new Date('2026-10-29T08:00:00Z'));
    const alle = await t.db.select().from(calls);
    expect(alle).toHaveLength(1);
    expect(alle[0]).toMatchObject({ type: 'dagboek', bron: 'schema' });
    expect(t.opdrachten[0].soort).toBeUndefined();
  });
});
