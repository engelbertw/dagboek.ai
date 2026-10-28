import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { foutcode, maskeer, regel, uitvoer } from '../log.js';
import { opschoningStatus, voerOpschoningUit } from '../opschoning.js';
import { calls, callLog, instellingen, opschoningRuns } from '../schema.js';
import { startScheduler } from '../scheduler.js';
import { SERVICE_KEY, maakTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

let gelogd: string[] = [];
const orgineel = uitvoer.schrijf;
beforeEach(() => { gelogd = []; uitvoer.schrijf = (_n, tekst) => { gelogd.push(tekst); }; });
afterEach(() => { uitvoer.schrijf = orgineel; });

const dagenGeleden = (n: number) => new Date(Date.now() - n * 86_400_000);

describe('logregels', () => {
  it('maskeren telefoonnummers, BSN, IBAN, tokens en e-mailadressen maar laten ids en datums staan', () => {
    const uit = maskeer('bel +31612345678 of 06-12345678, bsn 111222333, NL91 ABNA 0417 1643 00, Bearer abcdefgh12345678, jan@gemeente.nl');
    for (const geheim of ['612345678', '12345678', '111222333', 'ABNA', 'abcdefgh12345678', 'jan@']) expect(uit).not.toContain(geheim);
    for (const veilig of ['6f1e2d3c-1234-4567-89ab-0123456789ab', '2026-10-29 09:00', 'poging 2']) expect(maskeer(veilig)).toBe(veilig);
  });

  it('foutcode geeft alleen de klassenaam en een technische code, nooit de melding', () => {
    const e = Object.assign(new TypeError('kan niet verbinden met 0612345678'), { code: 'ECONNREFUSED' });
    expect(foutcode(e)).toBe('TypeError:ECONNREFUSED');
    expect(foutcode('tekst')).toBe('Error');
    expect(regel('error', 'x', { foutcode: foutcode(e), telefoon: '0612345678' })).not.toContain('0612345678');
  });

  it('een gesprek van planning tot samenvatting lekt geen telefoonnummer, transcript of foutmelding in de logs', async () => {
    const t = await maakTestApp({ gebeld: false, reden: 'voice-service niet bereikbaar (TimeoutError)', onzeker: true }, async () => { throw new Error('502 voor 0612345678: Ik heb geheime inhoud besproken'); });
    open.push(t);
    const m = (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678' })).json();
    await t.api('POST', `/api/employees/${m.id}/bel`);
    const [c] = await t.db.select().from(calls);
    await t.app.inject({ method: 'POST', url: `/api/intern/calls/${c.id}/resultaat`, headers: { 'x-service-key': SERVICE_KEY }, payload: { status: 'gesproken', transcript: [{ role: 'user', content: 'Ik heb geheime inhoud besproken' }] } });
    await t.klaarMetAchtergrond();
    const alles = gelogd.join('\n');
    expect(alles).toContain('gesprek.niet_gestart');
    expect(alles).toContain(c.id); // correlatie-id
    for (const verboden of ['0612345678', 'geheime inhoud', 'Daan']) expect(alles).not.toContain(verboden);
  });
});

describe('gespreksverloop', () => {
  it('legt codes en tijden vast, in volgorde, zonder inhoud, en is op te vragen per gesprek', async () => {
    const t = await maakTestApp(); open.push(t);
    const m = (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678', toestemming: true })).json();
    const { callId } = (await t.api('POST', `/api/employees/${m.id}/bel`)).json();
    await t.app.inject({ method: 'POST', url: `/api/intern/calls/${callId}/resultaat`, headers: { 'x-service-key': SERVICE_KEY }, payload: { status: 'gesprek' } });
    await t.app.inject({ method: 'POST', url: `/api/intern/calls/${callId}/resultaat`, headers: { 'x-service-key': SERVICE_KEY }, payload: { status: 'gesprek' } }); // dubbel: niet nogmaals
    const r = (await t.api('GET', `/api/calls/${callId}/verloop`)).json();
    expect(r.map((x: any) => `${x.bron}:${x.gebeurtenis}`)).toEqual(['web:claim:handmatig', 'web:status:verzenden', 'web:status:belt', 'voice:status:gesprek']);
    expect(JSON.stringify(r)).not.toContain('0612345678');
  });
});

describe('bewaartermijnen zichtbaar en bewijsbaar', () => {
  it('registreert een geslaagde ronde en zet per gewist transcript een bewijstijdstip', async () => {
    const t = await maakTestApp(); open.push(t);
    const m = (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678' })).json();
    const [c] = await t.db.insert(calls).values({ employeeId: m.id, status: 'gesproken', afgerondOp: dagenGeleden(40), transcript: [{ role: 'user', content: 'x' }] }).returning();
    expect(await voerOpschoningUit(t.db, 30)).toEqual({ status: 'ok', gewist: 1 });
    const [na] = await t.db.select().from(calls).where(eq(calls.id, c.id));
    expect(na.transcript).toBeNull();
    expect(na.transcriptGewistOp).toBeInstanceOf(Date);
    expect((await t.db.select().from(opschoningRuns))[0]).toMatchObject({ bron: 'web', status: 'ok', gewist: 1 });
    expect((await t.db.select().from(callLog).where(eq(callLog.callId, c.id))).map((x) => x.gebeurtenis)).toContain('transcript:gewist_bewaartermijn');
  });

  it('een mislukte ronde wordt vastgelegd met alleen een foutcode, niet met de foutmelding, en leidt tot een waarschuwing', async () => {
    const t = await maakTestApp(); open.push(t);
    const kapot = new Proxy(t.db, { get: (doel, prop, ontvanger) => (prop === 'update' ? () => { throw Object.assign(new Error('geheime details 0612345678'), { code: 'ECONNRESET' }); } : Reflect.get(doel, prop, ontvanger)) });
    expect(await voerOpschoningUit(kapot as any, 30)).toEqual({ status: 'mislukt', gewist: 0 });
    const [run] = await t.db.select().from(opschoningRuns);
    expect(run).toMatchObject({ status: 'mislukt', mislukt: 1, foutcode: 'Error:ECONNRESET' });
    expect(JSON.stringify(run)).not.toContain('geheime');
    expect(gelogd.join('')).not.toContain('geheime');
    expect((await opschoningStatus(t.db, 30)).waarschuwingen.join(' ')).toContain('mislukt');
  });

  it('waarschuwt als de opschoning nooit draaide, als er een achterstand is en als voice meldt dat iets niet gewist kon worden', async () => {
    const t = await maakTestApp(); open.push(t);
    expect((await opschoningStatus(t.db, 30)).waarschuwingen.join(' ')).toContain('niet gedraaid');
    await voerOpschoningUit(t.db, 30);
    expect((await opschoningStatus(t.db, 30)).waarschuwingen).toEqual([]);

    const m = (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678' })).json();
    await t.db.insert(calls).values({ employeeId: m.id, status: 'gesproken', afgerondOp: dagenGeleden(40), transcript: [{ role: 'user', content: 'x' }] });
    const st = await opschoningStatus(t.db, 30);
    expect(st.achterstand).toBe(1);
    expect(st.waarschuwingen.join(' ')).toContain('bewaartermijn voorbij');

    await t.app.inject({ method: 'POST', url: '/api/intern/opschoning', headers: { 'x-service-key': SERVICE_KEY }, payload: { gewist: 3, mislukt: 2, foutcode: 'OSError' } });
    expect((await opschoningStatus(t.db, 30)).waarschuwingen.join(' ')).toContain('voice-service meldt');
    const api = (await t.api('GET', '/api/systeem/status')).json();
    expect(api.waarschuwingen.length).toBeGreaterThan(1);
  });

  it('de interne opschoonmelding vraagt de servicesleutel en weigert inhoud in de foutcode', async () => {
    const t = await maakTestApp(); open.push(t);
    const post = (headers: any, payload: any) => t.app.inject({ method: 'POST', url: '/api/intern/opschoning', headers, payload });
    expect((await post({}, { gewist: 1, mislukt: 0 })).statusCode).toBe(401);
    expect((await post({ 'x-service-key': SERVICE_KEY }, { gewist: 1, mislukt: 0, foutcode: 'bestand 0612345678 mislukt' })).statusCode).toBe(400);
    expect((await post({ 'x-service-key': SERVICE_KEY }, { gewist: 1, mislukt: 0 })).statusCode).toBe(200);
  });

  it('de beheerder kan een transcript op verzoek wissen, met bewijs en verloop', async () => {
    const t = await maakTestApp(); open.push(t);
    const m = (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678' })).json();
    const [c] = await t.db.insert(calls).values({ employeeId: m.id, status: 'gesproken', transcript: [{ role: 'user', content: 'x' }], samenvattingRuw: { a: 1 } }).returning();
    expect((await t.api('DELETE', `/api/calls/${c.id}/transcript`)).statusCode).toBe(200);
    const [na] = await t.db.select().from(calls).where(eq(calls.id, c.id));
    expect(na).toMatchObject({ transcript: null, samenvattingRuw: null });
    expect(na.transcriptGewistOp).toBeInstanceOf(Date);
    expect((await t.api('DELETE', '/api/calls/00000000-0000-4000-8000-000000000000/transcript')).statusCode).toBe(404);
  });
});

describe('planning hartslag en afsluiten', () => {
  it('schrijft een hartslag, waarschuwt als die ontbreekt of oud is, en stop() ruimt netjes op', async () => {
    const t = await maakTestApp(); open.push(t);
    expect((await t.api('GET', '/api/systeem/status')).json().scheduler.verouderd).toBe(true); // nooit gedraaid, en automatisch bellen staat aan
    const h = startScheduler({ db: t.db, voice: async () => ({ gebeld: true, call_id: 'x' }) }, 60_000);
    await new Promise((r) => setTimeout(r, 300));
    const [rij] = await t.db.select().from(instellingen).where(eq(instellingen.sleutel, 'scheduler_hartslag'));
    expect(rij).toBeTruthy();
    expect((await t.api('GET', '/api/systeem/status')).json().scheduler.verouderd).toBe(false);
    await h.stop();
    await t.db.update(instellingen).set({ waarde: new Date(Date.now() - 5 * 60_000).toISOString() }).where(eq(instellingen.sleutel, 'scheduler_hartslag'));
    expect((await t.api('GET', '/api/systeem/status')).json().scheduler.verouderd).toBe(true);
  });
});
