export interface PuntVoorGesprek { tekst: string; deadline: string | null; eigenaarId: string | null; eigenaarNaam: string | null; eigenaarExtern: string }

const dagen = (a: string, b: string) => Math.round((new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 86_400_000);

/** Splitst de open acties van een onderwerp in punten die nog lopen en punten waarvan de deadline is verstreken, met uitleg voor de assistent. */
export function puntenVoorGesprek(punten: PuntVoorGesprek[], vandaag: string, gebeldeId: string): { open: string[]; teLaat: string[] } {
  const open: string[] = [];
  const teLaat: string[] = [];
  for (const p of punten) {
    const wie = p.eigenaarId && p.eigenaarId !== gebeldeId ? p.eigenaarNaam : !p.eigenaarId && p.eigenaarExtern ? p.eigenaarExtern : null;
    const delen: string[] = [];
    if (wie) delen.push(`bij ${wie}`);
    if (p.deadline && p.deadline < vandaag) {
      const n = dagen(vandaag, p.deadline);
      delen.push(`deadline ${p.deadline}, ${n} ${n === 1 ? 'dag' : 'dagen'} te laat`);
      teLaat.push(`${p.tekst} (${delen.join(', ')})`);
    } else {
      if (p.deadline) delen.push(`deadline ${p.deadline}`);
      open.push(delen.length ? `${p.tekst} (${delen.join(', ')})` : p.tekst);
    }
  }
  return { open, teLaat };
}
