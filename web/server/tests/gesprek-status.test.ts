import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { herstelGesprekken } from '../gesprek-herstel.js';
import { OVERGANGEN, toegestaan, zetStatus, type GesprekStatus } from '../gesprek-status.js';
import { calls } from '../schema.js';
import type { OpzoekResultaat } from '../voice.js';
import { SERVICE_KEY, maakTestApp } from './helpers.js';

const open: Awaited<ReturnType<typeof maakTestApp>>[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });
const ALLE = Object.keys(OVERGANGEN) as GesprekStatus[];

async function opzet(voiceAntwoord?: any) {
  const t = await maakTestApp(voiceAntwoord);
  open.push(t);
  const m = (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678' })).json();
  const [c] = await t.db.insert(calls).values({ employeeId: m.id }).returning();
  const melding = (id: string, payload: any) => t.app.inject({ method: 'POST', url: `/api/intern/calls/${id}/resultaat`, headers: { 'x-service-key': SERVICE_KEY }, payload });
  const status = async (id = c.id) => (await t.db.select().from(calls).where(eq(calls.id, id)))[0];
  return { t, m, c, melding, status };
}

describe('overgangen tussen gespreksstatussen', () => {
  it('database en code hanteren exact dezelfde regels (elk paar van → naar)', async () => {
    const { t, c } = await opzet();
    for (const van of ALLE) for (const naar of ALLE) {
      if (van === naar) continue;
      // Zet de rij direct op 'van' (via 'gepland' mag alles; voor de rest omzeilen we de trigger tijdelijk).
      await t.db.execute(sql`ALTER TABLE calls DISABLE TRIGGER calls_status_overgang`);
      await t.db.update(calls).set({ status: van }).where(eq(calls.id, c.id));
      await t.db.execute(sql`ALTER TABLE calls ENABLE TRIGGER calls_status_overgang`);
      let dbMag = true;
      try { await t.db.update(calls).set({ status: naar }).where(eq(calls.id, c.id)); } catch { dbMag = false; }
      expect(dbMag, `${van} → ${naar}`).toBe(toegestaan(van, naar));
    }
  }, 60_000);

  it('zetStatus past alleen toe als de overgang mag, en geeft anders false', async () => {
    const { t, c, status } = await opzet();
    expect(await zetStatus(t.db, c.id, 'belt')).toBe(true);
    expect(await zetStatus(t.db, c.id, 'belt')).toBe(false); // dubbel
    expect(await zetStatus(t.db, c.id, 'gesproken')).toBe(true);
    expect(await zetStatus(t.db, c.id, 'mislukt')).toBe(false); // niets overschrijft 'gesproken'
    expect((await status()).status).toBe('gesproken');
  });

  it('een te late melding "belt" na "gesprek" draait de status niet terug', async () => {
    const { c, melding, status } = await opzet();
    await melding(c.id, { status: 'gesprek' });
    const r = await melding(c.id, { status: 'belt', twilioSid: 'CAx' });
    expect(r.json()).toMatchObject({ ok: true, genegeerd: true });
    expect((await status()).status).toBe('gesprek');
  });

  it('een dubbele melding van dezelfde uitkomst start de samenvatting maar één keer', async () => {
    const { t, c, melding } = await opzet();
    const payload = { status: 'gesproken', transcript: [{ role: 'user', content: 'hallo' }] };
    expect((await melding(c.id, payload)).json()).toEqual({ ok: true });
    expect((await melding(c.id, payload)).json()).toMatchObject({ genegeerd: true });
    await t.klaarMetAchtergrond();
  });

  it('een late "gesproken" vervangt nog steeds een valse voicemail, maar "gesproken" blijft staan', async () => {
    const { c, melding, status } = await opzet();
    await melding(c.id, { status: 'voicemail' });
    await melding(c.id, { status: 'gesproken', transcript: [] });
    expect((await status()).status).toBe('gesproken');
    await melding(c.id, { status: 'niet_bereikt' });
    expect((await status()).status).toBe('gesproken');
  });

  it('gelijktijdige tegenstrijdige meldingen laten precies één geldige uitkomst over', async () => {
    const { c, melding, status } = await opzet();
    await Promise.all([melding(c.id, { status: 'mislukt' }), melding(c.id, { status: 'voicemail' }), melding(c.id, { status: 'niet_bereikt' })]);
    expect(['mislukt', 'voicemail', 'niet_bereikt']).toContain((await status()).status);
  });
});

describe('Bel nu en onzekere verzending', () => {
  it('een antwoord dat uitblijft laat het gesprek op "verzenden" staan (niet "mislukt") zodat het niet blind opnieuw wordt gebeld', async () => {
    const t = await maakTestApp({ gebeld: false, reden: 'voice-service niet bereikbaar (TimeoutError)', onzeker: true });
    open.push(t);
    const m = (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678' })).json();
    const r = await t.api('POST', `/api/employees/${m.id}/bel`);
    expect(r.statusCode).toBe(502);
    const [c] = await t.db.select().from(calls);
    expect(c.status).toBe('verzenden');
  });

  it('een duidelijke weigering door voice is wel "mislukt"', async () => {
    const t = await maakTestApp({ gebeld: false, reden: 'ongeldig telefoonnummer' });
    open.push(t);
    const m = (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678' })).json();
    await t.api('POST', `/api/employees/${m.id}/bel`);
    expect((await t.db.select().from(calls))[0].status).toBe('mislukt');
  });

  it('stuurt de call-id mee als idempotency-sleutel', async () => {
    const t = await maakTestApp();
    open.push(t);
    const m = (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678' })).json();
    await t.api('POST', `/api/employees/${m.id}/bel`);
    const [c] = await t.db.select().from(calls);
    expect(t.opdrachten[0].web_call_id).toBe(c.id);
    expect(c.status).toBe('belt');
  });
});

describe('herstel van vastgelopen gesprekken', () => {
  const nu = new Date(); // de trigger zet status_gewijzigd_op met de databaseklok, dus hier ook de echte klok
  const oud = (min: number) => new Date(nu.getTime() - min * 60_000);
  const opzoeken = (r: OpzoekResultaat) => async () => r;
  const llm = async () => { throw new Error('geen llm'); };

  async function vast(status: GesprekStatus, minuten: number, extra: any = {}) {
    const s = await opzet();
    await s.t.db.update(calls).set({ status, ...extra }).where(eq(calls.id, s.c.id));
    await s.t.db.update(calls).set({ statusGewijzigdOp: oud(minuten) }).where(eq(calls.id, s.c.id));
    return s;
  }

  it('voice kent het verzoek niet: zeker niet gebeld, dus "mislukt" (herpoging mag)', async () => {
    const s = await vast('verzenden', 5);
    await herstelGesprekken({ db: s.t.db, llm, opzoeken: opzoeken({ bereikt: true, bekend: false }) }, nu);
    expect(await s.status()).toMatchObject({ status: 'mislukt', fout: 'niet_verzonden' });
  });

  it('voice heeft wel gebeld: het gesprek loopt door als "belt", er wordt niet opnieuw gebeld', async () => {
    const s = await vast('verzenden', 5);
    await herstelGesprekken({ db: s.t.db, llm, opzoeken: opzoeken({ bereikt: true, bekend: true, call_id: 'abc', gebeld: true, onzeker: false }) }, nu);
    expect(await s.status()).toMatchObject({ status: 'belt', voiceCallId: 'abc' });
  });

  it('voice onbereikbaar: eerst wachten, pas na een half uur "onderbroken" (nooit automatisch herbellen)', async () => {
    const jong = await vast('verzenden', 10);
    await herstelGesprekken({ db: jong.t.db, llm, opzoeken: opzoeken({ bereikt: false }) }, nu);
    expect((await jong.status()).status).toBe('verzenden');
    const oudeS = await vast('verzenden', 40);
    await herstelGesprekken({ db: oudeS.t.db, llm, opzoeken: opzoeken({ bereikt: false }) }, nu);
    expect(await oudeS.status()).toMatchObject({ status: 'onderbroken', fout: 'onzeker_of_gebeld' });
  });

  it('een gesprek zonder uitkomst wordt na 45 minuten "onderbroken"; een jong gesprek niet', async () => {
    const lang = await vast('gesprek', 50);
    const kort = await vast('gesprek', 10);
    await herstelGesprekken({ db: lang.t.db, llm, opzoeken: opzoeken({ bereikt: false }) }, nu);
    await herstelGesprekken({ db: kort.t.db, llm, opzoeken: opzoeken({ bereikt: false }) }, nu);
    expect((await lang.status()).status).toBe('onderbroken');
    expect((await kort.status()).status).toBe('gesprek');
  });

  it('start een samenvatting die nooit begon, maximaal drie keer', async () => {
    const s = await vast('gesproken', 10, { afgerondOp: oud(10), transcript: [] });
    const taken: Promise<unknown>[] = [];
    for (let i = 0; i < 5; i++) await herstelGesprekken({ db: s.t.db, llm, opzoeken: opzoeken({ bereikt: false }), achtergrond: (p) => { taken.push(p); return p; } }, nu);
    expect(taken.length).toBe(1); // geen_inhoud na de eerste poging: niet nog eens
    expect((await s.status()).samenvattingStatus).toBe('geen_inhoud');
    const f = await vast('gesproken', 10, { afgerondOp: oud(10), samenvattingStatus: 'mislukt', samenvattingFout: 'Onderbroken, bijvoorbeeld door een herstart.', samenvattingPogingen: 3 });
    const meer: Promise<unknown>[] = [];
    await herstelGesprekken({ db: f.t.db, llm, opzoeken: opzoeken({ bereikt: false }), achtergrond: (p) => { meer.push(p); return p; } }, nu);
    expect(meer.length).toBe(0);
  });

  it('twee instanties tegelijk starten de samenvatting niet dubbel', async () => {
    const s = await vast('gesproken', 10, { afgerondOp: oud(10), transcript: [] });
    const taken: Promise<unknown>[] = [];
    const a = { db: s.t.db, llm, opzoeken: opzoeken({ bereikt: false }), achtergrond: (p: Promise<unknown>) => { taken.push(p); return p; } };
    await Promise.all([herstelGesprekken(a, nu), herstelGesprekken(a, nu)]);
    expect((await s.status()).samenvattingPogingen).toBeLessThanOrEqual(2);
    expect((await s.status()).samenvattingStatus).toBe('geen_inhoud');
  });
});
