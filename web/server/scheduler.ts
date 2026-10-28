import { and, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from './db.js';
import { startGesprek } from './gesprek-starten.js';
import { LOPENDE_STATUSSEN } from './gesprek-status.js';
import { calls, employees, instellingen, scheduleEmployees, schedules } from './schema.js';
import type { VoiceClient } from './voice.js';

const TZ = 'Europe/Amsterdam';
const MINUUT = 60_000;
/** Een gesprek dat op het geplande tijdstip niet kon starten (bijvoorbeeld door een herstart) wordt nog een uur lang alsnog gestart. */
export const INHAALTIJD_MIN = 60;
/** Na een gemist, voicemail- of mislukt gesprek wordt na zoveel minuten opnieuw geprobeerd, tot het maximum aantal pogingen. */
export const HERPOGING_NA_MIN = 30;
/** Herpogingen stoppen zoveel uur na het geplande tijdstip. */
export const HERPOGING_TOT_UUR = 3;
/** Pauze tussen twee gesprekken die tegelijk gepland staan, zodat de voice-service niet alles tegelijk hoeft te doen. */
export const PAUZE_TUSSEN_GESPREKKEN_MS = 20_000;

function nlDelen(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { datum: `${p.year}-${p.month}-${p.day}`, jaar: +p.year, maand: +p.month, dag: +p.day, uur: +p.hour, minuut: +p.minute };
}

/** Weekdag in Nederland: 1 = maandag … 7 = zondag. */
export function nlWeekdag(d: Date): number {
  const { jaar, maand, dag } = nlDelen(d);
  return ((new Date(Date.UTC(jaar, maand - 1, dag)).getUTCDay() + 6) % 7) + 1;
}
export const nlDatum = (d: Date) => nlDelen(d).datum;

/** Het moment waarop het in Nederland op die datum die kloktijd is, ook rond zomer- en wintertijd. */
export function nlNaarDate(datum: string, tijd: string): Date {
  const [j, m, d] = datum.split('-').map(Number);
  const [u, min] = tijd.split(':').map(Number);
  const lokaal = Date.UTC(j, m - 1, d, u, min);
  const verschil = (t: number) => { const x = nlDelen(new Date(t)); return Date.UTC(x.jaar, x.maand - 1, x.dag, x.uur, x.minuut) - t; };
  let t = lokaal - verschil(lokaal);
  t = lokaal - verschil(t);
  return new Date(t);
}

export async function automatischBellenAan(db: Db): Promise<boolean> {
  const [rij] = await db.select().from(instellingen).where(eq(instellingen.sleutel, 'automatisch_bellen'));
  return rij?.waarde !== 'uit';
}
export async function zetAutomatischBellen(db: Db, aan: boolean): Promise<void> {
  await db.insert(instellingen).values({ sleutel: 'automatisch_bellen', waarde: aan ? 'aan' : 'uit' })
    .onConflictDoUpdate({ target: instellingen.sleutel, set: { waarde: aan ? 'aan' : 'uit', bijgewerktOp: new Date() } });
}

export interface TikUitkomst { gestart: number; mislukt: number; overgeslagen: number }

/** Start de gesprekken waarvan het tijdstip is aangebroken. Veilig om vaak (en dubbel) aan te roepen: de database bewaakt dat elk gesprek maar één keer start. */
export async function tik(
  { db, voice, wacht = (ms) => new Promise<void>((r) => setTimeout(r, ms)) }: { db: Db; voice: VoiceClient; wacht?: (ms: number) => Promise<void> },
  nu = new Date(),
): Promise<TikUitkomst> {
  const uitkomst: TikUitkomst = { gestart: 0, mislukt: 0, overgeslagen: 0 };
  if (!(await automatischBellenAan(db))) return uitkomst;

  const plannings = await db.select().from(schedules).where(eq(schedules.actief, true));
  const vandaag = nlDatum(nu);
  const weekdag = nlWeekdag(nu);
  const taken: { employeeId: string; scheduleId: string; slotStart: Date; poging: number }[] = [];

  for (const p of plannings.filter((x) => x.dagen.includes(weekdag))) {
    const leden = await db.select({ id: employees.id }).from(scheduleEmployees)
      .innerJoin(employees, eq(employees.id, scheduleEmployees.employeeId))
      .where(and(eq(scheduleEmployees.scheduleId, p.id), eq(employees.actief, true)));
    for (const tijd of p.tijden) {
      const slotStart = nlNaarDate(vandaag, tijd);
      const sindsSlot = (nu.getTime() - slotStart.getTime()) / MINUUT;
      if (sindsSlot < 0 || sindsSlot > HERPOGING_TOT_UUR * 60) continue;
      for (const { id: employeeId } of leden) {
        const eerdere = await db.select().from(calls).where(and(eq(calls.scheduleId, p.id), eq(calls.employeeId, employeeId), eq(calls.slotStart, slotStart)));
        const laatste = eerdere.sort((a, b) => b.poging - a.poging)[0];
        let poging = 1;
        if (laatste) {
          const sinds = (nu.getTime() - (laatste.afgerondOp ?? laatste.createdAt).getTime()) / MINUUT;
          if (!['niet_bereikt', 'voicemail', 'mislukt'].includes(laatste.status) || laatste.poging >= p.maxPogingen || sinds < HERPOGING_NA_MIN) { uitkomst.overgeslagen++; continue; }
          poging = laatste.poging + 1;
        } else if (sindsSlot > INHAALTIJD_MIN) { uitkomst.overgeslagen++; continue; }
        taken.push({ employeeId, scheduleId: p.id, slotStart, poging });
      }
    }
  }

  // Wie al in gesprek is (of net gebeld wordt) slaan we over, ook als dat voor een andere planning of handmatig was.
  const recent = await db.select({ employeeId: calls.employeeId }).from(calls)
    .where(and(inArray(calls.status, LOPENDE_STATUSSEN), gte(calls.createdAt, new Date(nu.getTime() - 20 * MINUUT))));
  const bezig = new Set(recent.map((r) => r.employeeId));
  const unieke = new Set<string>();
  let eerste = true;
  for (const taak of taken) {
    if (bezig.has(taak.employeeId) || unieke.has(taak.employeeId)) { uitkomst.overgeslagen++; continue; }
    unieke.add(taak.employeeId);
    if (!eerste) await wacht(PAUZE_TUSSEN_GESPREKKEN_MS);
    eerste = false;
    try {
      const r = await startGesprek({ db, voice }, taak.employeeId, { scheduleId: taak.scheduleId, slotStart: taak.slotStart, poging: taak.poging });
      if (r.ok) uitkomst.gestart++; else if (r.status === 409) uitkomst.overgeslagen++; else uitkomst.mislukt++;
    } catch (e) {
      console.error(`Planning: gesprek starten mislukt voor ${taak.employeeId}: ${(e as Error).message}`);
      uitkomst.mislukt++;
    }
  }
  return uitkomst;
}

export interface SchedulerHandle { stop(): Promise<void> }

/** Draait tik() elke halve minuut. Een tik die nog bezig is (door de pauzes) wordt niet dubbel gestart; stop() wacht op een lopende tik. */
export function startScheduler(deps: { db: Db; voice: VoiceClient }, elkeMs = 30_000): SchedulerHandle {
  let lopend: Promise<void> | null = null;
  let gestopt = false;
  const lus = () => {
    if (lopend || gestopt) return;
    lopend = (async () => {
      try {
        const r = await tik(deps, new Date());
        if (r.gestart || r.mislukt) console.log(`Planning: ${r.gestart} gesprek(ken) gestart, ${r.mislukt} mislukt`);
      } catch (e) { console.error('Planning: tik mislukt', e); } finally { lopend = null; }
    })();
  };
  const timer = setInterval(lus, elkeMs);
  timer.unref();
  return {
    // Een tik die tijdens het afsluiten nog pauzeert tussen gesprekken, wordt niet afgewacht: de rest wordt door het inhaalvenster later gestart.
    async stop() {
      gestopt = true; clearInterval(timer);
      if (lopend) await Promise.race([lopend, new Promise((r) => setTimeout(r, 25_000).unref())]);
    },
  };
}
