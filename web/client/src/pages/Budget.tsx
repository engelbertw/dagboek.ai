import type { SamenverderBudget } from '../api';

export const dagen = (n: number) => `${String(n).replace('.', ',')} ${Math.abs(n) === 1 ? 'dag' : 'dagen'}`;

/**
 * De stand van het dagenbudget in vier begrippen. "Afgesproken" komt uit de vastgelegde mutaties; de rest is berekend uit de sessies.
 * Een negatieve waarde bij "nog niet gepland" is een overschrijding en wordt als zodanig getoond.
 */
export function BudgetRegel({ budget }: { budget: SamenverderBudget }) {
  const { beschikbaar, uitgevoerd, gepland, nogNietGepland, overschrijding } = budget;
  if (beschikbaar === 0 && uitgevoerd === 0 && gepland === 0) return <span className="zacht klein">Nog geen dagenbudget vastgelegd</span>;
  return (
    <span>
      Afgesproken <strong>{dagen(beschikbaar)}</strong> · uitgevoerd <strong>{dagen(uitgevoerd)}</strong> · gepland <strong>{dagen(gepland)}</strong> ·{' '}
      {overschrijding ? <strong>overschrijding van {dagen(Math.abs(nogNietGepland))}</strong> : <>nog niet gepland <strong>{dagen(nogNietGepland)}</strong></>}
    </span>
  );
}
