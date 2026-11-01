import { and, eq, gt, sql } from 'drizzle-orm';
import type { Db } from './db.js';
import { logGebeurtenis } from './call-log.js';
import { leesConsultantDebrief, leesConsultantVragen, leesDebriefVragen, leesHouding, leesInstructie, STANDAARD_CONSULTANT_VRAGEN, type Motor } from './instellingen.js';
import { ingeschakeldeVarianten } from './consultant-varianten.js';
import { bepaalRoute } from './routering.js';
import { toestemmingNodigVoorDoel, TOESTEMMING_CONSULTANT } from './toestemming.js';
import { stelOnderwerpenSamen } from './gesprek-starten.js';
import { log } from './log.js';
import { calls, employees, klanten, samenverderProgrammas, samenverderSessieConsultants, samenverderSessies, type DebriefVariant, type GesprekType } from './schema.js';
import { vandaagNL } from './samenvatten.js';
import type { Onderwerp } from './voice.js';

/** Zoveel inkomende gesprekken per medewerker per uur; daarboven weigeren we, tegen misbruik van een vervalst nummer en tegen kosten. */
export const INKOMEND_MAX_PER_UUR = Number(process.env.INKOMEND_MAX_PER_UUR ?? 5) || 5;

/** Nederlands nummer naar +31…, dezelfde regels als de voice-service. Onbekende vormen blijven leeg, zodat ze nooit met een medewerker overeenkomen. */
export function normaliseerNummer(ruw: string): string {
  const cijfers = (ruw ?? '').replace(/[\s\-().]/g, '');
  const m = /^(?:\+31|0031|0)(6\d{8}|[1-9]\d{7,8})$/.exec(cijfers);
  return m ? `+31${m[1]}` : '';
}

export type { GesprekType };

export type InkomendUitkomst =
  | { ok: true; callId: string; medewerker: string; onderwerpen: Onderwerp[]; toestemmingNodig: boolean; houding: string; instructie: string; type: GesprekType; varianten: DebriefVariant[]; voorstel: Voorstel | null }
  | { ok: false; reden: 'onbekend_nummer' | 'te_vaak' };

/** Wat uit de planning al bekend is: de consultant staat vandaag voor precies één SamenVerder-sessie. Alleen een voorstel: het geldt pas als de consultant het bevestigt. */
export interface Voorstel { variant: 'samenverder'; klant: string }

/** Precies één geplande sessie van vandaag waaraan deze consultant is toegewezen, anders geen voorstel (nooit gokken). */
async function planningsVoorstel(db: Db, employeeId: string): Promise<{ klant: string } | null> {
  const rijen = await db.select({ sessie: samenverderSessies.id, klant: klanten.naam }).from(samenverderSessieConsultants)
    .innerJoin(samenverderSessies, eq(samenverderSessies.id, samenverderSessieConsultants.sessieId))
    .innerJoin(samenverderProgrammas, eq(samenverderProgrammas.id, samenverderSessies.programmaId))
    .innerJoin(klanten, eq(klanten.id, samenverderProgrammas.klantId))
    .where(and(eq(samenverderSessieConsultants.employeeId, employeeId), eq(samenverderSessies.status, 'gepland'), eq(samenverderSessies.datum, vandaagNL())));
  return rijen.length === 1 ? { klant: rijen[0].klant } : null;
}

/** Start de administratie van een gesprek waarbij de medewerker zelf belt. De beller wordt alleen herkend aan het nummer; er wordt geen nummer bewaard. */
export async function startInkomendGesprek(db: Db, beller: string, motor: Motor): Promise<InkomendUitkomst> {
  const nummer = normaliseerNummer(beller);
  const actieven = nummer ? await db.select().from(employees).where(eq(employees.actief, true)) : [];
  const treffers = actieven.filter((m) => normaliseerNummer(m.telefoon) === nummer);
  // Twee medewerkers op één nummer (bijvoorbeeld een gedeeld toestel): niet raden wie er belt.
  if (treffers.length !== 1) return { ok: false, reden: 'onbekend_nummer' };
  const m = treffers[0];
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(calls)
    .where(and(eq(calls.employeeId, m.id), eq(calls.bron, 'inkomend'), gt(calls.createdAt, new Date(Date.now() - 3600_000))));
  if (n >= INKOMEND_MAX_PER_UUR) return { ok: false, reden: 'te_vaak' };
  // Een accountmanager belt voor een verkoop-debrief, een consultant voor een consultantdebrief; wie beide is kiest in het gesprek (en dat wordt achteraf bewezen).
  // Voor ieder ander, en zolang de consultantroute uit staat of nog geen variant heeft, blijft alles zoals het was.
  const varianten = (await leesConsultantDebrief(db)) ? ingeschakeldeVarianten() : [];
  const type = bepaalRoute(m.rol, m.consultant, varianten.length > 0);
  const debrief = type !== 'dagboek';
  const { onderwerpen, momentopname } = debrief ? { onderwerpen: [], momentopname: [] } : await stelOnderwerpenSamen(db, m.id);
  const consultantTekst = async () => {
    const algemeen = (await leesConsultantVragen(db, 'algemeen', STANDAARD_CONSULTANT_VRAGEN)).waarde;
    const perVariant = await Promise.all(varianten.map(async (v) => `## ${v.naam}\n${(await leesConsultantVragen(db, v.id, v.standaardVragen)).waarde}`));
    return [`## Algemeen\n${algemeen}`, ...perVariant].join('\n\n');
  };
  const instructie = type === 'verkoop_debrief' ? (await leesDebriefVragen(db)).waarde
    : type === 'consultant_debrief' ? await consultantTekst()
      : type === 'debrief_keuze' ? `# Verkoop-debrief\n${(await leesDebriefVragen(db)).waarde}\n\n# Consultancy-debrief\n${await consultantTekst()}`
        : (await leesInstructie(db)).waarde;
  // Toestemming is per doel: voor de consultantdebrief staat die in het register, voor de dubbele rol is hij nodig zolang één van beide ontbreekt.
  const toestemmingNodig = type === 'consultant_debrief' ? await toestemmingNodigVoorDoel(db, m.id, TOESTEMMING_CONSULTANT.doel)
    : type === 'debrief_keuze' ? !m.toestemmingOp || (await toestemmingNodigVoorDoel(db, m.id, TOESTEMMING_CONSULTANT.doel)) : !m.toestemmingOp;
  // Het voorstel wordt bij het gesprek bewaard, zodat de verwerking achteraf kan nagaan of de consultant het echt bevestigde (context_bevestigd).
  const plan = type !== 'dagboek' && type !== 'verkoop_debrief' && varianten.some((v) => v.id === 'samenverder') ? await planningsVoorstel(db, m.id) : null;
  const voorstel: Voorstel | null = plan ? { variant: 'samenverder', klant: plan.klant } : null;
  const context = plan ? { variant: { waarde: 'samenverder', noemt: plan.klant }, ...(type === 'debrief_keuze' ? { route: { waarde: 'consultancy', noemt: plan.klant } } : {}) } : null;
  const [call] = await db.insert(calls).values({
    employeeId: m.id, status: 'gesprek', bron: 'inkomend', type, onderwerpen: momentopname, instructie, engine: motor, gestartOp: new Date(), ...(context ? { context } : {}),
  }).returning();
  await logGebeurtenis(db, call.id, 'voice', 'claim:inkomend');
  log('info', 'gesprek.inkomend', { correlatieId: call.id, type });
  return { ok: true, callId: call.id, medewerker: m.naam, onderwerpen, toestemmingNodig, houding: (await leesHouding(db)).waarde, instructie, type, varianten: varianten.map((v) => v.id), voorstel };
}
