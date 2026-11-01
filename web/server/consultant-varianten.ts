/**
 * De varianten van de consultantdebrief (project, implementatie, SamenVerder) als configuratie op één gedeelde verwerking.
 * Een variant bepaalt alleen wat anders is: de checklist, de extra velden die het model teruggeeft en de promptversie. Privacy, toestemming,
 * broncontrole, klantmatching, eigenaren, deadlines, Controle nodig en het schrijven naar het werkregister zijn voor alle varianten hetzelfde
 * en staan in consultant-debrief.ts en debrief-gedeeld.ts.
 *
 * Een variant bestaat pas als hij hier is geregistreerd. Zolang er geen enkele is, is de consultantroute niet beschikbaar.
 */
import type { z } from 'zod';
import type { Db } from './db.js';
import type { DebriefVariant } from './schema.js';
import type { Beurt } from './vertrouwen.js';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface VariantConfig {
  id: DebriefVariant;
  /** Hoe de assistent de variant noemt in het gesprek. */
  naam: string;
  /** Versie van de prompt voor deze variant, bijvoorbeeld 'consultant-project-v1'. */
  promptVersie: string;
  /** Woorden waaraan een mondelinge keuze voor deze variant herkend wordt. */
  trefwoorden: readonly string[];
  /** Variant-specifieke checklist; door de beheerder te bewerken onder Instellingen. */
  standaardVragen: string;
  /** Wat het model voor deze variant extra teruggeeft (alleen beschrijving voor de prompt) en hoe dat gecontroleerd wordt. */
  promptAanvulling: string;
  schema: z.ZodType<Record<string, unknown>>;
  /** Het soort onderwerp (topics.type) waaraan deze debrief gekoppeld kan worden. Zonder waarde koppelt de variant geen onderwerp. */
  /** Haalt uit het antwoord van het model weg wat niet met een citaat uit het gesprek te bewijzen is. */
  controleer?: (data: Record<string, unknown>, transcript: Beurt[]) => Record<string, unknown>;
  onderwerpType?: 'project' | 'implementatie';
  /** Past, binnen dezelfde transactie, de bewezen gegevens toe op het gekoppelde onderwerp. Alleen aangeroepen met een gekoppeld onderwerp. */
  toepassen?: (tx: Tx, onderwerpId: string, data: Record<string, unknown>) => Promise<void>;
}

const register: Partial<Record<DebriefVariant, VariantConfig>> = {};

export const registreerVariant = (c: VariantConfig) => { register[c.id] = c; };
export const verwijderVariant = (id: DebriefVariant) => { delete register[id]; };
export const ingeschakeldeVarianten = (): VariantConfig[] => Object.values(register);
export const variantConfig = (id: string | null | undefined): VariantConfig | undefined => (id ? register[id as DebriefVariant] : undefined);
/** De trefwoorden van alle ingeschakelde varianten, voor de verificatie van een mondelinge keuze. */
export const variantTrefwoorden = (): Record<string, readonly string[]> => Object.fromEntries(Object.values(register).map((v) => [v.id, v.trefwoorden]));
