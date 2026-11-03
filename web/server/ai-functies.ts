/** De functies waarvoor dagboek.ai het taalmodel aanroept. Elke aanroep noemt er één; de inventaris in ai-register.ts beschrijft ze. */
export const AI_FUNCTIES = ['dagboekverslag', 'verkoopdebrief', 'routebepaling', 'consultantdebrief', 'weekoverzicht', 'instructiesuggestie', 'woordvoorstellen', 'overig'] as const;
export type AiFunctie = (typeof AI_FUNCTIES)[number];
export interface LlmMeta { functie: AiFunctie; /** Id van het gesprek of onderwerp waar de aanroep bij hoort (geen inhoud). */ referentie?: string }
export interface LlmGebruik { functie: AiFunctie; referentie?: string; model: string; tokensIn: number; tokensUit: number; duurMs: number; uitkomst: 'ok' | 'fout'; foutCode?: string }
