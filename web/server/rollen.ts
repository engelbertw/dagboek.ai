/**
 * Wie wat mag. `beheerder` mag alles. `accountmanager` ziet alleen het werkregister en de klanten, zodat een accountmanager zijn eigen
 * punten kan bijhouden zonder bij gesprekken, medewerkers, instellingen of gebruikers te kunnen. Wat niet is toegestaan, is verboden.
 */
export const BEHEERDER_ROL = 'beheerder';
export const ACCOUNTMANAGER_ROL = 'accountmanager';
export const ROLLEN = [BEHEERDER_ROL, ACCOUNTMANAGER_ROL] as const;
export type GebruikersRol = (typeof ROLLEN)[number];

const ID = '[0-9a-fA-F-]{36}';
const ACCOUNTMANAGER_MAG: { methode: string[]; pad: RegExp }[] = [
  { methode: ['GET', 'POST'], pad: /^\/api\/activiteiten$/ },
  { methode: ['PATCH', 'DELETE'], pad: new RegExp(`^/api/activiteiten/${ID}$`) },
  { methode: ['POST'], pad: new RegExp(`^/api/activiteiten/${ID}/controle$`) },
  { methode: ['GET', 'POST'], pad: /^\/api\/klanten$/ },
  { methode: ['GET', 'PATCH'], pad: new RegExp(`^/api/klanten/${ID}$`) },
  { methode: ['POST'], pad: new RegExp(`^/api/klanten/${ID}/contacten$`) },
  { methode: ['GET', 'POST'], pad: /^\/api\/klant-contacten$/ },
  { methode: ['PATCH', 'DELETE'], pad: new RegExp(`^/api/klant-contacten/${ID}$`) },
  { methode: ['GET'], pad: /^\/api\/employees$/ },
];

export const normaleRol = (rol: string | undefined): GebruikersRol => (rol === ACCOUNTMANAGER_ROL ? ACCOUNTMANAGER_ROL : BEHEERDER_ROL);

export function magDoen(rol: string | undefined, methode: string, pad: string): boolean {
  if (normaleRol(rol) === BEHEERDER_ROL) return true;
  return ACCOUNTMANAGER_MAG.some((r) => r.methode.includes(methode.toUpperCase()) && r.pad.test(pad));
}
