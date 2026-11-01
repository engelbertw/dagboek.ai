/**
 * Het dagenbudget van een SamenVerder-programma. Alleen de afgesproken dagen staan in de database (samenverder_budgetmutaties); alles hieronder wordt
 * berekend en nergens opgeslagen. Het taalmodel komt hier nooit aan te pas: een debrief kan hooguit een voorstel doen, dat een beheerder bevestigt.
 *
 * - beschikbaar          = de som van alle mutaties (start, uitbreidingen, correcties): wat contractueel of administratief is afgesproken
 * - uitgevoerd           = de omvang van sessies met status uitgevoerd én een bevestiging door een beheerder
 * - gepland              = de omvang van sessies met status gepland (die hebben altijd een datum)
 * - nog niet gepland     = beschikbaar − uitgevoerd − gepland; een negatieve waarde is een overschrijding en wordt getoond, niet geblokkeerd
 * Geannuleerde en verplaatste sessies tellen nergens mee (bij een verplaatsing telt de nieuwe sessie).
 */
export interface MutatieRegel { dagen: number | string }
export interface SessieRegel { status: string; omvangDagen: number | string; bevestigdOp: Date | string | null }
export interface Budget { beschikbaar: number; uitgevoerd: number; gepland: number; nogNietGepland: number; overschrijding: boolean }

// Rekenen in honderdsten van een dag, zodat 0,1 + 0,2 geen 0,30000000000000004 wordt.
const honderdsten = (n: number | string) => Math.round(Number(n) * 100);
const dagen = (h: number) => h / 100;

export function berekenBudget(mutaties: MutatieRegel[], sessies: SessieRegel[]): Budget {
  const beschikbaar = mutaties.reduce((som, m) => som + honderdsten(m.dagen), 0);
  const uitgevoerd = sessies.filter((s) => s.status === 'uitgevoerd' && s.bevestigdOp).reduce((som, s) => som + honderdsten(s.omvangDagen), 0);
  const gepland = sessies.filter((s) => s.status === 'gepland').reduce((som, s) => som + honderdsten(s.omvangDagen), 0);
  const nog = beschikbaar - uitgevoerd - gepland;
  return { beschikbaar: dagen(beschikbaar), uitgevoerd: dagen(uitgevoerd), gepland: dagen(gepland), nogNietGepland: dagen(nog), overschrijding: nog < 0 };
}
