import type { GesprekType } from './schema.js';

/**
 * De hoofdroute van een inkomend gesprek. Een rol bepaalt wat iemand mág doen; deze functie bepaalt waar het gesprek begint:
 * - alleen accountmanager: verkoop-debrief; alleen consultant: consultantdebrief; geen van beide: dagboek;
 * - allebei: de keuze volgt uit het gesprek (`debrief_keuze`) en wordt achteraf geverifieerd. Een voorkeur mag dat nooit afdwingen.
 * `consultancyBeschikbaar` is false zolang de schakelaar uit staat of er nog geen variant is ingeschakeld: dan gedraagt iedereen zich als voorheen.
 */
export function bepaalRoute(rol: string, consultant: boolean, consultancyBeschikbaar: boolean): GesprekType {
  const accountmanager = rol === 'accountmanager';
  const consultancy = consultant && consultancyBeschikbaar;
  if (accountmanager && consultancy) return 'debrief_keuze';
  if (consultancy) return 'consultant_debrief';
  return accountmanager ? 'verkoop_debrief' : 'dagboek';
}

/** Woorden waaraan een mondelinge routekeuze herkend wordt. */
export const ROUTE_TREFWOORDEN = { verkoop: ['verkoop', 'verkoopdebrief', 'verkoop debrief'], consultancy: ['consultancy', 'consultant', 'consultancydebrief'] } as const;
export type Route = keyof typeof ROUTE_TREFWOORDEN;
export const routeNaarType = (r: Route): 'verkoop_debrief' | 'consultant_debrief' => (r === 'verkoop' ? 'verkoop_debrief' : 'consultant_debrief');
