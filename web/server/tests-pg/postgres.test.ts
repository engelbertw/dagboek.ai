import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectPostgres, migrate, migratieNamen, type DbHandle } from '../db.js';
import { herstelGesprekken } from '../gesprek-herstel.js';
import { startGesprek } from '../gesprek-starten.js';
import { zetStatus } from '../gesprek-status.js';
import { leggToestemmingVast } from '../toestemming.js';
import { tik } from '../scheduler.js';
import { calls, employees, openItems, scheduleEmployees, schedules, toestemmingen } from '../schema.js';
import { maakDatabase, maakHandles, migratieMap, migratiesTot, pool } from './helpers.js';

const rijen = (r: unknown) => ((r as { rows?: any[] }).rows ?? (r as any[]));

describe('migraties op een echte Postgres', () => {
  const opruimen: (() => Promise<void>)[] = [];
  afterAll(async () => { for (const f of opruimen.reverse()) await f(); });

  it('twee instanties die tegelijk starten migreren zonder fout en leggen elke migratie precies één keer vast', async () => {
    const d = await maakDatabase(); opruimen.push(d.verwijder);
    const handles = await maakHandles(d.url, 4); opruimen.push(async () => { await Promise.all(handles.map((h) => h.close())); });
    const uitkomsten = await Promise.all(handles.map((h) => migrate(h)));
    expect(uitkomsten.flat().sort()).toEqual(migratieNamen()); // elke migratie door precies één instantie toegepast
    const gedaan = rijen(await handles[0].db.execute(sql`select naam from migraties order by naam`)).map((r) => r.naam);
    expect(gedaan).toEqual(migratieNamen());
    expect(await migrate(handles[0])).toEqual([]); // opnieuw draaien doet niets
  });

  it('zonder de lock botst gelijktijdig migreren (bewijs dat de lock nodig is)', async () => {
    const d = await maakDatabase(); opruimen.push(d.verwijder);
    const handles = await maakHandles(d.url, 3); opruimen.push(async () => { await Promise.all(handles.map((h) => h.close())); });
    for (const h of handles) delete h.metLock;
    const r = await Promise.allSettled(handles.map((h) => migrate(h)));
    expect(r.some((x) => x.status === 'rejected')).toBe(true);
  });

  it('een database op stand 009 met gegevens migreert naar nu zonder dataverlies, met de verwachte aanvullingen', async () => {
    const d = await maakDatabase(); opruimen.push(d.verwijder);
    const h = await connectPostgres(d.url); opruimen.push(h.close);
    await migrate(h, migratiesTot('009'));
    const db = h.db;
    // Platte SQL: op stand 009 bestaan de latere kolommen van het schema (zoals rol) nog niet, dus drizzle kan hier niet invoegen.
    const [m1] = rijen(await db.execute(sql`insert into employees (naam, telefoon, toestemming_op) values ('Met', '0612345678', '2026-09-01T10:00:00Z') returning id`));
    const [m2] = rijen(await db.execute(sql`insert into employees (naam, telefoon) values ('Zonder', '0687654321') returning id`));
    await h.exec(`INSERT INTO projects (naam) VALUES ('P')`);
    const t = rijen(await db.execute(sql`insert into topics (titel, eigenaar_id) values ('T', ${m1.id}) returning id`))[0].id;
    const [c] = await h.db.execute(sql`insert into calls (employee_id, status, transcript) values (${m1.id}, 'gesproken', '[{"role":"user","content":"hoi"}]'::jsonb) returning id`).then(rijen);
    await h.exec(`INSERT INTO open_items (topic_id, tekst, call_id, deadline) VALUES ('${t}', 'Uit gesprek', '${c.id}', '2026-11-06'), ('${t}', 'Handmatig', NULL, NULL)`);

    const nieuw = await migrate(h);
    expect(nieuw).toEqual(migratieNamen().filter((n) => n.slice(0, 3) > '009'));

    // niets kwijt
    expect(rijen(await db.execute(sql`select count(*)::int as n from employees`))[0].n).toBe(2);
    expect(rijen(await db.execute(sql`select transcript from calls`))[0].transcript).toEqual([{ role: 'user', content: 'hoi' }]);
    // aanvullingen en backfills
    const reg = await db.select().from(toestemmingen);
    expect(reg).toHaveLength(1);
    expect(reg[0]).toMatchObject({ employeeId: m1.id, besluit: 'gegeven', bron: 'migratie' });
    const punten = await db.select().from(openItems);
    expect(punten.find((p) => p.tekst === 'Uit gesprek')).toMatchObject({ bron: 'gesprek', deadlineOorspronkelijk: '2026-11-06', controleNodig: false });
    expect(punten.find((p) => p.tekst === 'Handmatig')).toMatchObject({ bron: 'handmatig', deadlineOorspronkelijk: null });
    expect((await db.select().from(calls))[0]).toMatchObject({ status: 'gesproken', toestemmingStatus: 'onbekend', transcriptBewarenTot: null });
    // de nieuwe status mag, de trigger bewaakt overgangen, het register is append-only
    const [lopend] = await db.insert(calls).values({ employeeId: m1.id, status: 'belt' }).returning();
    await db.update(calls).set({ status: 'onderbroken' }).where(eq(calls.id, lopend.id));
    await expect(db.update(calls).set({ status: 'belt' }).where(eq(calls.id, lopend.id))).rejects.toThrow();
    await expect(db.update(calls).set({ status: 'mislukt' }).where(eq(calls.id, c.id))).rejects.toThrow(); // 'gesproken' blijft staan
    await expect(db.execute(sql`update toestemmingen set besluit = 'ingetrokken'`)).rejects.toThrow();
    expect(m2.id).toBeTruthy();
  });
});

describe('gelijktijdigheid', () => {
  let d: Awaited<ReturnType<typeof maakDatabase>>;
  let handles: DbHandle[];
  beforeAll(async () => {
    d = await maakDatabase();
    handles = await maakHandles(d.url, 4);
    await migrate(handles[0]);
  });
  afterAll(async () => { await Promise.all(handles.map((h) => h.close())); await d.verwijder(); });

  const maakMedewerker = async (naam: string) => (await handles[0].db.insert(employees).values({ naam, telefoon: '0612345678' }).returning())[0];
  const teller = () => {
    const opdrachten: string[] = [];
    return { opdrachten, voice: async (o: { web_call_id: string }) => { opdrachten.push(o.web_call_id); await new Promise((r) => setTimeout(r, 20)); return { gebeld: true as const, call_id: `v-${opdrachten.length}` }; } };
  };

  it('60 gelijktijdige pogingen voor hetzelfde slot over vier verbindingen: precies één gesprek en één oproep naar voice', async () => {
    const m = await maakMedewerker('Claim');
    const [p] = await handles[0].db.insert(schedules).values({ naam: 'x', tijden: ['09:00'] }).returning();
    await handles[0].db.insert(scheduleEmployees).values({ scheduleId: p.id, employeeId: m.id });
    const slot = new Date('2026-10-29T08:00:00Z');
    const { opdrachten, voice } = teller();
    const uitkomsten = await Promise.all(Array.from({ length: 60 }, (_, i) => startGesprek({ db: handles[i % 4].db, voice }, m.id, { scheduleId: p.id, slotStart: slot, poging: 1 })));
    expect(uitkomsten.filter((u) => u.ok)).toHaveLength(1);
    expect(uitkomsten.filter((u) => !u.ok && u.status === 409)).toHaveLength(59);
    expect(opdrachten).toHaveLength(1);
    expect(await handles[0].db.select().from(calls).where(eq(calls.employeeId, m.id))).toHaveLength(1);
  });

  it('vier onafhankelijke schedulers (eigen verbindingen) bellen iedereen precies één keer', async () => {
    const mensen = await Promise.all(Array.from({ length: 6 }, (_, i) => maakMedewerker(`Tik ${i}`)));
    const [p] = await handles[0].db.insert(schedules).values({ naam: 'Tik', tijden: ['09:00'], dagen: [1, 2, 3, 4, 5, 6, 7] }).returning();
    await handles[0].db.insert(scheduleEmployees).values(mensen.map((m) => ({ scheduleId: p.id, employeeId: m.id })));
    const nu = new Date();
    const uur = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(nu.getTime() - 5 * 60_000));
    await handles[0].db.update(schedules).set({ tijden: [uur] }).where(eq(schedules.id, p.id)); // vijf minuten geleden: nu aan de beurt
    const { opdrachten, voice } = teller();
    await Promise.all(handles.map((h) => tik({ db: h.db, voice: voice as any, wacht: async () => {} }, nu)));
    const mijn = await handles[0].db.select().from(calls).where(eq(calls.scheduleId, p.id));
    const perMens = new Map<string, number>();
    for (const c of mijn) perMens.set(c.employeeId, (perMens.get(c.employeeId) ?? 0) + 1);
    expect([...perMens.values()].every((n) => n === 1)).toBe(true);
    expect(perMens.size).toBe(6);
    expect(opdrachten).toHaveLength(6);
    expect(new Set(opdrachten).size).toBe(6);
  });

  it('tegenstrijdige statusmeldingen tegelijk: precies één uitkomst wint en de trigger blokkeert terugdraaien', async () => {
    const m = await maakMedewerker('Status');
    for (let ronde = 0; ronde < 10; ronde++) {
      const [c] = await handles[0].db.insert(calls).values({ employeeId: m.id, status: 'gesprek' }).returning();
      const doel = ['mislukt', 'voicemail', 'niet_bereikt', 'onderbroken', 'gesproken'] as const;
      const r = await Promise.all(doel.map((s, i) => zetStatus(handles[i % 4].db, c.id, s)));
      const [na] = await handles[0].db.select().from(calls).where(eq(calls.id, c.id));
      expect(r.filter(Boolean).length).toBeGreaterThanOrEqual(1);
      expect(doel).toContain(na.status);
      if (na.status === 'gesproken') expect(await zetStatus(handles[1].db, c.id, 'mislukt')).toBe(false);
    }
    const [c2] = await handles[0].db.insert(calls).values({ employeeId: m.id, status: 'gesproken' }).returning();
    const fout: any = await handles[2].db.execute(sql`update calls set status = 'belt' where id = ${c2.id}`).then(() => null, (e) => e);
    expect(String(fout?.cause?.message ?? fout?.message)).toMatch(/Ongeldige gespreksstatus-overgang gesproken -> belt/);
  });

  it('twee herstel-sweepers tegelijk handelen een vastgelopen gesprek één keer af', async () => {
    const m = await maakMedewerker('Herstel');
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const [c] = await handles[0].db.insert(calls).values({ employeeId: m.id, status: 'verzenden' }).returning();
      ids.push(c.id);
    }
    await handles[0].db.execute(sql`update calls set status_gewijzigd_op = now() - interval '10 minutes' where status = 'verzenden'`);
    let telling = 0;
    const opzoeken = async () => { telling++; return { bereikt: true as const, bekend: false as const }; };
    const llm = async () => '';
    const uitkomsten = await Promise.all(handles.slice(0, 3).map((h) => herstelGesprekken({ db: h.db, llm, opzoeken }, new Date())));
    expect(uitkomsten.reduce((n, u) => n + u.opgelost, 0)).toBe(8); // elk gesprek door precies één sweeper afgehandeld
    const na = await handles[0].db.select().from(calls);
    for (const id of ids) expect(na.find((c) => c.id === id)).toMatchObject({ status: 'mislukt', fout: 'niet_verzonden' });
    expect(telling).toBeGreaterThanOrEqual(8);
  });

  it('een toestemmingsbesluit voor hetzelfde gesprek wordt onder druk maar één keer vastgelegd', async () => {
    const m = await maakMedewerker('Register');
    const [c] = await handles[0].db.insert(calls).values({ employeeId: m.id, status: 'gesproken' }).returning();
    await Promise.all(Array.from({ length: 12 }, (_, i) => handles[i % 4].db.transaction((tx) => leggToestemmingVast(tx, { employeeId: m.id, besluit: 'gegeven', bron: 'gesprek', callId: c.id, citaat: 'ja' }))));
    expect(await handles[0].db.select().from(toestemmingen).where(eq(toestemmingen.employeeId, m.id))).toHaveLength(1);
    expect((await handles[0].db.select().from(employees).where(eq(employees.id, m.id)))[0].toestemmingOp).toBeTruthy();
  });

  it('een lopende samenvatting (FOR SHARE) laat een gelijktijdige intrekking wachten tot de transactie klaar is', async () => {
    const m = (await handles[0].db.insert(employees).values({ naam: 'Lock', telefoon: '0612345678', toestemmingOp: new Date() }).returning())[0];
    const p = pool(d.url, 4);
    const a = await p.connect(); const b = await p.connect();
    try {
      await a.query('BEGIN');
      await a.query('SELECT toestemming_op FROM employees WHERE id = $1 FOR SHARE', [m.id]);
      let intrekkingKlaar = false;
      const intrekking = (async () => {
        await b.query('BEGIN');
        await b.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [m.id]);
        await b.query('UPDATE employees SET toestemming_op = NULL WHERE id = $1', [m.id]);
        await b.query('COMMIT');
        intrekkingKlaar = true;
      })();
      await new Promise((r) => setTimeout(r, 500));
      expect(intrekkingKlaar).toBe(false); // wacht op de samenvatting
      await a.query('COMMIT');
      await intrekking;
      expect(intrekkingKlaar).toBe(true);
    } finally { a.release(); b.release(); await p.end(); }
  });

  it('de unieke index op slot en poging bestaat echt in de database', async () => {
    const r = rijen(await handles[0].db.execute(sql`select indexdef from pg_indexes where indexname = 'calls_slot_poging'`));
    expect(r[0].indexdef).toMatch(/UNIQUE/i);
    const t = rijen(await handles[0].db.execute(sql`select tgname from pg_trigger where tgname in ('calls_status_overgang', 'toestemmingen_geen_update')`)).map((x) => x.tgname).sort();
    expect(t).toEqual(['calls_status_overgang', 'toestemmingen_geen_update']);
  });
});
