import { and, eq } from 'drizzle-orm';
import type { Db } from './db.js';
import { leesConsultantDebrief, leesConsultantVragen, leesDebriefVragen, leesInstructie, STANDAARD_CONSULTANT_VRAGEN } from './instellingen.js';
import { ingeschakeldeVarianten, type VariantConfig } from './consultant-varianten.js';
import { bepaalRoute } from './routering.js';
import { toestemmingNodigVoorDoel, TOESTEMMING_CONSULTANT } from './toestemming.js';
import { klanten, samenverderProgrammas, samenverderSessieConsultants, samenverderSessies, type GesprekType } from './schema.js';
import { vandaagNL } from './samenvatten.js';

/** Wat uit de planning al bekend is: de consultant staat vandaag voor precies één SamenVerder-sessie. Alleen een voorstel: het geldt pas als de consultant het bevestigt. */
export interface Voorstel { variant: 'samenverder'; klant: string }

/** Precies één geplande sessie van vandaag waaraan deze consultant is toegewezen, anders geen voorstel (nooit gokken). */
export async function planningsVoorstel(db: Db, employeeId: string): Promise<{ klant: string } | null> {
  const rijen = await db.select({ sessie: samenverderSessies.id, klant: klanten.naam }).from(samenverderSessieConsultants)
    .innerJoin(samenverderSessies, eq(samenverderSessies.id, samenverderSessieConsultants.sessieId))
    .innerJoin(samenverderProgrammas, eq(samenverderProgrammas.id, samenverderSessies.programmaId))
    .innerJoin(klanten, eq(klanten.id, samenverderProgrammas.klantId))
    .where(and(eq(samenverderSessieConsultants.employeeId, employeeId), eq(samenverderSessies.status, 'gepland'), eq(samenverderSessies.datum, vandaagNL())));
  return rijen.length === 1 ? { klant: rijen[0].klant } : null;
}

/** De ingeschakelde consultancyvarianten; leeg zolang de schakelaar uit staat, dan gedraagt iedereen zich als voorheen. */
export async function beschikbareVarianten(db: Db): Promise<VariantConfig[]> {
  return (await leesConsultantDebrief(db)) ? ingeschakeldeVarianten() : [];
}

/** Het gesprekstype volgens de rol van de medewerker (zie routering.ts). */
export const routeVoor = (m: { rol: string; consultant: boolean }, varianten: VariantConfig[]): GesprekType => bepaalRoute(m.rol, m.consultant, varianten.length > 0);

export interface GespreksOpzet { instructie: string; toestemmingNodig: boolean; voorstel: Voorstel | null; context: Record<string, unknown> | null }

/**
 * Wat een gesprek van dit type nodig heeft: de vragenlijst, of toestemming gevraagd moet worden en een eventueel planningsvoorstel.
 * Gedeeld door inkomende en uitgaande gesprekken, zodat beide hetzelfde vragen. Voor `dagboek` is dit de algemene instructie (de onderwerpen stelt de aanroeper samen).
 */
export async function gespreksOpzet(db: Db, m: { id: string; toestemmingOp: Date | null }, type: GesprekType, varianten: VariantConfig[]): Promise<GespreksOpzet> {
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
  return { instructie, toestemmingNodig, voorstel, context };
}
