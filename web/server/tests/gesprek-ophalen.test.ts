import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { HERSTEL_MAX_POGINGEN, herstelGesprekken } from '../gesprek-herstel.js';
import { calls } from '../schema.js';
import type { VoiceHerstel } from '../voice.js';
import { SERVICE_KEY, maakTestApp } from './helpers.js';

const open: Awaited<ReturnType<typeof maakTestApp>>[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

const llm = async () => { throw new Error('geen llm'); };
const opzoeken = async () => ({ bereikt: false as const });
const minuten = (n: number) => new Date(Date.now() - n * 60_000);

async function opzet(herstel?: VoiceHerstel, antwoord?: (s: string, g: string) => Promise<string>) {
  const t = await maakTestApp({ gebeld: true, call_id: 'v' }, antwoord ?? llm, undefined, herstel); open.push(t);
  const m = (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678' })).json();
  const nieuw = async (v: Partial<typeof calls.$inferInsert> = {}) => {
    const [c] = await t.db.insert(calls).values({ employeeId: m.id, engine: 'elevenlabs_agent', voiceCallId: 'v1', status: 'belt', ...v }).returning();
    // De trigger zet status_gewijzigd_op met de databaseklok; daarna terugdraaien.
    await t.db.update(calls).set({ statusGewijzigdOp: minuten(30) }).where(eq(calls.id, c.id));
    return c;
  };
  const rij = async (id: string) => (await t.db.select().from(calls).where(eq(calls.id, id)))[0];
  return { t, m, nieuw, rij };
}

describe('agent-gesprekken zonder transcript worden bij voice nagevraagd', () => {
  it('vraagt alleen de juiste gesprekken na, niet te vaak en niet eindeloos', async () => {
    const gevraagd: string[] = [];
    const herstel: VoiceHerstel = async (id) => { gevraagd.push(id); return { bereikt: true, uitkomst: 'nog_bezig' }; };
    const s = await opzet(herstel);
    const vast = await s.nieuw({ status: 'onderbroken' });
    const pipecat = await s.nieuw({ engine: 'pipecat' });
    const metTranscript = await s.nieuw({ transcript: [{ role: 'user', content: 'Hoi' }] });
    const nietGebeld = await s.nieuw({ voiceCallId: null, status: 'mislukt' });
    const jong = await s.nieuw();
    await s.t.db.update(calls).set({ statusGewijzigdOp: minuten(5) }).where(eq(calls.id, jong.id));
    const oud = await s.nieuw();
    await s.t.db.update(calls).set({ createdAt: minuten(60 * 49) }).where(eq(calls.id, oud.id));

    const r = await herstelGesprekken({ db: s.t.db, llm, opzoeken, herstel }, new Date());
    expect(gevraagd).toEqual([vast.id]);
    expect(r.opgevraagd).toBe(1);
    expect(pipecat.id && metTranscript.id && nietGebeld.id && jong.id && oud.id).toBeTruthy();

    // Direct daarna niet opnieuw: het interval is nog niet voorbij.
    await herstelGesprekken({ db: s.t.db, llm, opzoeken, herstel }, new Date());
    expect(gevraagd).toHaveLength(1);

    // Na elk interval opnieuw, tot het maximum.
    for (let i = 0; i < HERSTEL_MAX_POGINGEN + 3; i++) {
      await s.t.db.update(calls).set({ herstelLaatst: minuten(15) }).where(eq(calls.id, vast.id));
      await herstelGesprekken({ db: s.t.db, llm, opzoeken, herstel }, new Date());
    }
    expect(gevraagd).toHaveLength(HERSTEL_MAX_POGINGEN);
    expect((await s.rij(vast.id)).herstelPogingen).toBe(HERSTEL_MAX_POGINGEN);
  });

  it('doet niets zonder voice-herstel en laat een onbereikbare voice de teller wel oplopen', async () => {
    const s = await opzet();
    const c = await s.nieuw({ status: 'onderbroken' });
    await herstelGesprekken({ db: s.t.db, llm, opzoeken }, new Date());
    expect((await s.rij(c.id)).herstelPogingen).toBe(0);
    const herstel: VoiceHerstel = async () => ({ bereikt: false });
    await herstelGesprekken({ db: s.t.db, llm, opzoeken, herstel }, new Date());
    expect((await s.rij(c.id)).herstelPogingen).toBe(1);
  });

  it('een opgehaald gesprek (late melding na onderbroken) wordt samengevat en komt in de acties', async () => {
    const herstel: VoiceHerstel = async () => ({ bereikt: true, uitkomst: 'afgerond' });
    const s = await opzet(herstel, async () => JSON.stringify({ toestemming: 'gegeven', toestemming_citaat: 'Ja, dat is goed', onderwerpen: [{ nr: 1, besproken: true, samenvatting: 'Stand besproken.', nieuwe_open_punten: [
      { tekst: 'Offerte versturen', eigenaar: 'collega', deadline: null, citaat: 'Ik stuur de offerte' },
    ] }] }));
    await s.t.api('POST', '/api/topics', { titel: 'Offertes', eigenaarId: s.m.id });
    const { callId } = (await s.t.api('POST', `/api/employees/${s.m.id}/bel`, { motor: 'elevenlabs_agent' })).json();
    const melding = (payload: unknown) => s.t.app.inject({ method: 'POST', url: `/api/intern/calls/${callId}/resultaat`, headers: { 'x-service-key': SERVICE_KEY }, payload: payload as any });
    expect((await melding({ status: 'onderbroken', fout: 'Gesprek afgebroken zonder uitkomst' })).json()).toMatchObject({ ok: true });
    expect((await s.rij(callId)).status).toBe('onderbroken');
    await melding({ status: 'gesproken', transcript: [{ role: 'user', content: 'Ja, dat is goed. Ik stuur de offerte.' }] });
    await s.t.klaarMetAchtergrond();
    expect((await s.rij(callId))).toMatchObject({ status: 'gesproken', samenvattingStatus: 'klaar' });
    expect((await s.t.api('GET', '/api/acties')).json().map((a: { tekst: string }) => a.tekst)).toContain('Offerte versturen');
  });
});

describe('handmatig opnieuw ophalen', () => {
  it('geeft de uitkomst van voice terug en weigert wat niet kan', async () => {
    const herstel: VoiceHerstel = async () => ({ bereikt: true, uitkomst: 'nog_bezig' });
    const s = await opzet(herstel);
    const agent = await s.nieuw({ status: 'onderbroken' });
    expect((await s.t.api('POST', `/api/calls/${agent.id}/herstel`)).json()).toEqual({ uitkomst: 'nog_bezig' });
    const pipecat = await s.nieuw({ engine: 'pipecat' });
    expect((await s.t.api('POST', `/api/calls/${pipecat.id}/herstel`)).statusCode).toBe(409);
    const klaar = await s.nieuw({ transcript: [{ role: 'user', content: 'Hoi' }] });
    expect((await s.t.api('POST', `/api/calls/${klaar.id}/herstel`)).statusCode).toBe(409);
    expect((await s.t.api('POST', '/api/calls/00000000-0000-4000-8000-000000000000/herstel')).statusCode).toBe(404);
    const onbereikbaar = await opzet(async () => ({ bereikt: false }));
    const c = await onbereikbaar.nieuw({ status: 'onderbroken' });
    expect((await onbereikbaar.t.api('POST', `/api/calls/${c.id}/herstel`)).statusCode).toBe(502);
    const zonder = await opzet();
    const z = await zonder.nieuw({ status: 'onderbroken' });
    expect((await zonder.t.api('POST', `/api/calls/${z.id}/herstel`)).statusCode).toBe(503);
  });
});
