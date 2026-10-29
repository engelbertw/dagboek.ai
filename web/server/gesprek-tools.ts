import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { controleerWachtwoord } from './auth.js';
import { logGebeurtenis } from './call-log.js';
import type { Db } from './db.js';
import { stelOnderwerpenSamen } from './gesprek-starten.js';
import { log } from './log.js';
import { calls, employees, openItems, overzichtToegang, topics } from './schema.js';

/** Hulpmiddelen voor de gespreksmotor tijdens een inkomend gesprek. Wat een beller over collega's mag opvragen hangt af van een beheerrol met codewoord. */
export const MAX_CODEWOORD_POGINGEN = 3;
const GESPREK_MAX_UREN = 1.5;
const VERIFICATIE_MAX_MINUTEN = 60;

export const normaliseerCodewoord = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
/** Gegevens uit het dagboek zijn invoer voor het taalmodel: zonder opmaaktekens, op één regel en begrensd (zie `_schoon` in voice/prompts.py). */
const OPMAAK = new Set('<>#`*|[]{}');
const schoon = (t: unknown, max = 300) => [...(typeof t === 'string' ? t : '')]
  .map((c) => { const n = c.codePointAt(0)!; return n < 32 || (n >= 127 && n < 160) || n === 0x2028 || n === 0x2029 || OPMAAK.has(c) ? ' ' : c; })
  .join('').replace(/\s+/g, ' ').trim().slice(0, max);

type Fout = { ok: false; fout: string; [k: string]: unknown };
const fout = (f: string, extra: Record<string, unknown> = {}): Fout => ({ ok: false, fout: f, ...extra });

async function lopendGesprek(db: Db, callId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(callId)) return null;
  const [c] = await db.select().from(calls).where(and(
    eq(calls.id, callId), eq(calls.bron, 'inkomend'), eq(calls.status, 'gesprek'), gt(calls.createdAt, new Date(Date.now() - GESPREK_MAX_UREN * 3600_000)),
  ));
  if (!c) return null;
  const [beller] = await db.select().from(employees).where(eq(employees.id, c.employeeId));
  return beller?.actief ? { call: c, beller } : null;
}

const geverifieerd = (c: { overzichtGeverifieerdOp: Date | null }) =>
  !!c.overzichtGeverifieerdOp && Date.now() - c.overzichtGeverifieerdOp.getTime() < VERIFICATIE_MAX_MINUTEN * 60_000;

/** De beller noemt een codewoord. Alleen medewerkers met overzichtsrechten kunnen slagen; een mislukking zegt niet waarom, en na drie pogingen is het voor dit gesprek klaar. */
export async function bevestigCodewoord(db: Db, callId: string, codewoord: string): Promise<{ ok: true } | Fout> {
  const g = await lopendGesprek(db, callId);
  if (!g) return fout('gesprek_onbekend');
  const pogingen = await db.update(calls).set({ overzichtPogingen: sql`${calls.overzichtPogingen} + 1` })
    .where(and(eq(calls.id, callId), sql`${calls.overzichtPogingen} < ${MAX_CODEWOORD_POGINGEN}`)).returning({ n: calls.overzichtPogingen });
  if (!pogingen.length) return fout('te_vaak');
  const [toegang] = await db.select().from(overzichtToegang).where(eq(overzichtToegang.employeeId, g.beller.id));
  const norm = normaliseerCodewoord(codewoord ?? '');
  const goed = !!toegang && norm.length > 0 && controleerWachtwoord(norm, toegang.codewoordHash);
  await logGebeurtenis(db, callId, 'voice', goed ? 'tool:codewoord_goed' : 'tool:codewoord_fout');
  if (!goed) return fout('onjuist');
  await db.update(calls).set({ overzichtGeverifieerdOp: new Date() }).where(eq(calls.id, callId));
  return { ok: true };
}

async function vindMedewerker(db: Db, naam: string): Promise<{ id: string; naam: string } | Fout> {
  const q = schoon(naam, 100).toLowerCase();
  if (q.length < 2) return fout('naam_te_kort');
  const treffers = (await db.select({ id: employees.id, naam: employees.naam }).from(employees).where(eq(employees.actief, true)).orderBy(asc(employees.naam)))
    .filter((e) => e.naam.toLowerCase().includes(q));
  if (!treffers.length) return fout('niet_gevonden');
  if (treffers.length > 1) return fout('meerdere_treffers', { namen: treffers.slice(0, 5).map((t) => t.naam) });
  return treffers[0];
}

/** Onderwerpen en open punten van een collega, alleen voor een beller die het codewoord heeft genoemd. */
export async function zoekPunten(db: Db, callId: string, naam: string) {
  const g = await lopendGesprek(db, callId);
  if (!g) return fout('gesprek_onbekend');
  if (!geverifieerd(g.call)) return fout('codewoord_nodig');
  const m = await vindMedewerker(db, naam);
  if ('ok' in m) return m;
  const { onderwerpen } = await stelOnderwerpenSamen(db, m.id);
  await logGebeurtenis(db, callId, 'voice', 'tool:zoek_punten');
  log('info', 'gesprek.tool', { correlatieId: callId, tool: 'zoek_punten' });
  return {
    ok: true, medewerker: m.naam,
    onderwerpen: onderwerpen.slice(0, 10).map((o) => ({
      titel: schoon(o.titel, 200), laatste_update: o.laatste_update ? schoon(o.laatste_update, 400) : null,
      open_punten: (o.open_punten ?? []).slice(0, 10).map((p) => schoon(p)), te_laat: (o.te_laat_punten ?? []).slice(0, 10).map((p) => schoon(p)),
    })),
  };
}

/** Een aandachtspunt of actie bij een onderwerp van een collega. Het punt komt als te controleren punt in Acties en pas daarna in een volgend gesprek. */
export async function voegAandachtspuntToe(db: Db, callId: string, naam: string, onderwerp: string, tekst: string) {
  const g = await lopendGesprek(db, callId);
  if (!g) return fout('gesprek_onbekend');
  if (!geverifieerd(g.call)) return fout('codewoord_nodig');
  const punt = schoon(tekst, 300);
  if (punt.length < 3) return fout('tekst_ontbreekt');
  const m = await vindMedewerker(db, naam);
  if ('ok' in m) return m;
  const q = schoon(onderwerp, 200).toLowerCase();
  const actief = await db.select({ id: topics.id, titel: topics.titel }).from(topics).where(and(eq(topics.eigenaarId, m.id), eq(topics.status, 'actief')));
  const treffers = q ? actief.filter((t) => t.titel.toLowerCase().includes(q)) : [];
  if (treffers.length !== 1) return fout(treffers.length ? 'meerdere_onderwerpen' : 'onderwerp_niet_gevonden', { onderwerpen: actief.slice(0, 10).map((t) => schoon(t.titel, 100)) });
  await db.insert(openItems).values({
    topicId: treffers[0].id, tekst: punt, callId, eigenaarId: m.id, bron: 'gesprek', controleNodig: true,
    controleReden: `Telefonisch toegevoegd door ${g.beller.naam} (codewoord genoemd)`,
  });
  await logGebeurtenis(db, callId, 'voice', 'tool:aandachtspunt_toegevoegd');
  log('info', 'gesprek.tool', { correlatieId: callId, tool: 'aandachtspunt' });
  return { ok: true, onderwerp: schoon(treffers[0].titel, 200), medewerker: m.naam };
}
