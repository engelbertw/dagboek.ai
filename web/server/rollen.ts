/**
 * Wie wat mag. `beheerder` mag alles. `accountmanager` ziet alleen het werkregister en de klanten, zodat een accountmanager zijn eigen
 * punten kan bijhouden zonder bij gesprekken, medewerkers, instellingen of gebruikers te kunnen. `administratie` beheert de stamgegevens van klanten
 * (inwoners, contactpersonen) maar ziet het werkregister niet. `consultant` leest alleen het consultancywerk (werkregister, klanten, Consultancy,
 * SamenVerder, bezoekvoorbereiding) en wijzigt niets. Wat niet is toegestaan, is verboden.
 */
export const BEHEERDER_ROL = 'beheerder';
export const ACCOUNTMANAGER_ROL = 'accountmanager';
export const ADMINISTRATIE_ROL = 'administratie';
export const CONSULTANT_ROL = 'consultant';
/** De volgorde is de voorrang als iemand in Keycloak meer dan één rol heeft: de eerste wint. */
export const ROLLEN = [BEHEERDER_ROL, ACCOUNTMANAGER_ROL, ADMINISTRATIE_ROL, CONSULTANT_ROL] as const;
export type GebruikersRol = (typeof ROLLEN)[number];

const ID = '[0-9a-fA-F-]{36}';
const ACCOUNTMANAGER_MAG: { methode: string[]; pad: RegExp }[] = [
  { methode: ['GET', 'POST'], pad: /^\/api\/activiteiten$/ },
  { methode: ['PATCH', 'DELETE'], pad: new RegExp(`^/api/activiteiten/${ID}$`) },
  { methode: ['POST'], pad: new RegExp(`^/api/activiteiten/${ID}/controle$`) },
  // Opvolging van een vervolgsignaal: lezen mag; beslissen mag alleen de accountmanager van de gemeente (dat controleert opvolging.ts).
  { methode: ['GET', 'POST'], pad: new RegExp(`^/api/activiteiten/${ID}/opvolging$`) },
  { methode: ['GET', 'POST'], pad: /^\/api\/klanten$/ },
  { methode: ['GET', 'PATCH'], pad: new RegExp(`^/api/klanten/${ID}$`) },
  { methode: ['POST'], pad: new RegExp(`^/api/klanten/${ID}/contacten$`) },
  { methode: ['GET'], pad: new RegExp(`^/api/klanten/${ID}/(voorbereiding|rapport\\.pdf)$`) },
  // Datakwaliteit: de accountmanager beoordeelt en verbetert contactpersonen en punten. Gemeenten samenvoegen blijft bij de beheerder (zie hierboven: geen /controle).
  { methode: ['GET'], pad: /^\/api\/kwaliteit$/ },
  { methode: ['POST'], pad: /^\/api\/kwaliteit\/besluiten(\/terugdraaien)?$/ },
  { methode: ['POST'], pad: /^\/api\/klant-contacten\/samenvoegen$/ },
  // Overzicht Consultancy: alleen lezen
  { methode: ['GET'], pad: /^\/api\/consultancy$/ },
  // SamenVerder: alleen lezen
  { methode: ['GET'], pad: /^\/api\/samenverder\/programmas$/ },
  { methode: ['GET'], pad: new RegExp(`^/api/samenverder/programmas/${ID}$`) },
  { methode: ['GET', 'POST'], pad: /^\/api\/klant-contacten$/ },
  { methode: ['PATCH', 'DELETE'], pad: new RegExp(`^/api/klant-contacten/${ID}$`) },
  // Dagboek-feed (verslagen van alle gemeenten, alleen samenvattingen) en de eigen RSS-links. Een RSS-link aanmaken wijzigt geen bedrijfsgegevens.
  { methode: ['GET'], pad: /^\/api\/dagboek\/(feed|digest|bezoekteller)$/ },
  { methode: ['GET', 'POST'], pad: /^\/api\/dagboek\/feed-tokens$/ },
  { methode: ['DELETE'], pad: new RegExp(`^/api/dagboek/feed-tokens/${ID}$`) },
  { methode: ['GET'], pad: /^\/api\/employees$/ },
];

// Administratie: klantgegevens (alleen inwoners, zie magKlantveldenWijzigen) en contactpersonen, zonder werkregister, gesprekken of instellingen.
const ADMINISTRATIE_MAG: { methode: string[]; pad: RegExp }[] = [
  { methode: ['GET'], pad: /^\/api\/klanten$/ },
  { methode: ['GET', 'PATCH'], pad: new RegExp(`^/api/klanten/${ID}$`) },
  { methode: ['POST'], pad: new RegExp(`^/api/klanten/${ID}/contacten$`) },
  { methode: ['GET'], pad: new RegExp(`^/api/klanten/${ID}/(voorbereiding|rapport\\.pdf)$`) },
  { methode: ['GET'], pad: /^\/api\/kwaliteit$/ },
  { methode: ['POST'], pad: /^\/api\/kwaliteit\/besluiten(\/terugdraaien)?$/ },
  { methode: ['POST'], pad: /^\/api\/klant-contacten\/samenvoegen$/ },
  { methode: ['GET', 'POST'], pad: /^\/api\/klant-contacten$/ },
  { methode: ['PATCH', 'DELETE'], pad: new RegExp(`^/api/klant-contacten/${ID}$`) },
  { methode: ['GET'], pad: /^\/api\/employees$/ },
];

// Consultant: alleen lezen. Geen contactpersonen- of kwaliteitsscherm, geen wijzigingen, geen budget, gesprekken of instellingen.
const CONSULTANT_MAG: { methode: string[]; pad: RegExp }[] = [
  { methode: ['GET'], pad: /^\/api\/activiteiten$/ },
  { methode: ['GET'], pad: /^\/api\/klanten$/ },
  { methode: ['GET'], pad: new RegExp(`^/api/klanten/${ID}$`) },
  { methode: ['GET'], pad: new RegExp(`^/api/klanten/${ID}/(voorbereiding|rapport\\.pdf)$`) },
  { methode: ['GET'], pad: /^\/api\/topics$/ },
  { methode: ['GET'], pad: /^\/api\/consultancy$/ },
  { methode: ['GET'], pad: /^\/api\/samenverder\/programmas$/ },
  { methode: ['GET'], pad: new RegExp(`^/api/samenverder/programmas/${ID}$`) },
  // Dagboek-feed (verslagen van alle gemeenten, alleen samenvattingen) en de eigen RSS-links. Een RSS-link aanmaken wijzigt geen bedrijfsgegevens.
  { methode: ['GET'], pad: /^\/api\/dagboek\/(feed|digest|bezoekteller)$/ },
  { methode: ['GET', 'POST'], pad: /^\/api\/dagboek\/feed-tokens$/ },
  { methode: ['DELETE'], pad: new RegExp(`^/api/dagboek/feed-tokens/${ID}$`) },
  { methode: ['GET'], pad: /^\/api\/employees$/ },
];

/** Een ontbrekende rol (een oude sessie of de noodlogin) is beheerder; een onbekende rol krijgt de minste rechten. */
export const normaleRol = (rol: string | undefined): GebruikersRol => (!rol || rol === BEHEERDER_ROL ? BEHEERDER_ROL : rol === ADMINISTRATIE_ROL ? ADMINISTRATIE_ROL : rol === CONSULTANT_ROL ? CONSULTANT_ROL : ACCOUNTMANAGER_ROL);

export function magDoen(rol: string | undefined, methode: string, pad: string): boolean {
  if (rol && !(ROLLEN as readonly string[]).includes(rol)) return false;
  const normaal = normaleRol(rol);
  if (normaal === BEHEERDER_ROL) return true;
  const lijst = normaal === ADMINISTRATIE_ROL ? ADMINISTRATIE_MAG : normaal === CONSULTANT_ROL ? CONSULTANT_MAG : ACCOUNTMANAGER_MAG;
  return lijst.some((r) => r.methode.includes(methode.toUpperCase()) && r.pad.test(pad));
}

/** Wie mag het aantal inwoners van een gemeente wijzigen? Alleen beheer en administratie, niet de accountmanager. */
export const magInwonersWijzigen = (rol: string | undefined): boolean => [BEHEERDER_ROL, ADMINISTRATIE_ROL].includes(normaleRol(rol) as typeof BEHEERDER_ROL);
/** Administratie past alleen inwoners aan; de overige klantgegevens blijven bij beheerder en accountmanager. */
export const magAndereKlantveldenWijzigen = (rol: string | undefined): boolean => [BEHEERDER_ROL, ACCOUNTMANAGER_ROL].includes(normaleRol(rol) as typeof BEHEERDER_ROL);
