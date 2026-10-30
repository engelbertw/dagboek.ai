export interface ActieRij {
  id: string; tekst: string; soort?: string; topicId: string | null; topicTitel: string | null; klantId?: string | null; klantNaam?: string | null;
  eigenaarId: string | null; eigenaarNaam: string | null; eigenaarExtern: string;
  deadline: string | null; status: 'open' | 'afgerond'; createdAt: Date; afgerondOp: Date | null;
  controleNodig?: boolean; deadlineGewijzigdAantal?: number; jiraSleutel?: string | null; jiraUrl?: string | null;
}

/** Feiten over acties. Bewust geen score per persoon: dit dashboard beschrijft de stand van afspraken, het beoordeelt geen mensen. */
export interface Stand {
  open: number; teLaat: number; binnenkort: number; zonderDeadline: number;
  /** Afgerond op of vóór de deadline, resp. na de deadline (deadlines in de afgelopen 90 dagen). */
  opTijd: number; laatAfgerond: number;
  /** Acties waarvan de deadline is verschoven of weggehaald. */
  deadlineVerschoven: number;
}
export interface Team {
  /** Indicatie voor het hele team; null zolang er te weinig acties met een deadline zijn om iets te kunnen zeggen. */
  nakoming: number | null;
  basis: number;
  onvoldoendeGegevens: boolean;
  minimum: number;
}
export interface Dashboard {
  vandaag: string;
  totaal: Stand;
  team: Team;
  perEigenaar: (Stand & { id: string | null; naam: string })[];
  teLaat: ActieRij[];
  binnenkort: ActieRij[];
}

/** Onder dit aantal acties met een deadline zegt een percentage niets en tonen we het niet. */
export const MIN_BASIS_TEAM = 10;
const dag = (iso: string) => new Date(`${iso}T12:00:00Z`).getTime();
const NL = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
const NAKOMING_DAGEN = 90;
const BINNENKORT_DAGEN = 7;

const binnenVenster = (deadline: string, vandaag: string) => (dag(vandaag) - dag(deadline)) / 86_400_000 <= NAKOMING_DAGEN;

function stand(rijen: ActieRij[], vandaag: string): Stand {
  const s: Stand = { open: 0, teLaat: 0, binnenkort: 0, zonderDeadline: 0, opTijd: 0, laatAfgerond: 0, deadlineVerschoven: 0 };
  for (const r of rijen) {
    if (r.status === 'open') {
      s.open++;
      if (!r.deadline) s.zonderDeadline++;
      else if (r.deadline < vandaag) s.teLaat++;
      else if ((dag(r.deadline) - dag(vandaag)) / 86_400_000 <= BINNENKORT_DAGEN) s.binnenkort++;
    }
    if (r.deadline && binnenVenster(r.deadline, vandaag) && r.status === 'afgerond' && r.afgerondOp) {
      if (NL(r.afgerondOp) <= r.deadline) s.opTijd++; else s.laatAfgerond++;
    }
    if ((r.deadlineGewijzigdAantal ?? 0) > 0 && (r.status === 'open' || (r.deadline && binnenVenster(r.deadline, vandaag)))) s.deadlineVerschoven++;
  }
  return s;
}

/** Het teampercentage: op tijd afgerond ten opzichte van alles waarvan de deadline is bereikt (afgerond of nog open na de deadline). */
function team(rijen: ActieRij[], vandaag: string, s: Stand): Team {
  const verlopenOpen = rijen.filter((r) => r.status === 'open' && r.deadline && r.deadline < vandaag && binnenVenster(r.deadline, vandaag)).length;
  const basis = s.opTijd + s.laatAfgerond + verlopenOpen;
  const onvoldoende = basis < MIN_BASIS_TEAM;
  return { nakoming: onvoldoende ? null : Math.round((s.opTijd / basis) * 100), basis, onvoldoendeGegevens: onvoldoende, minimum: MIN_BASIS_TEAM };
}

export function berekenDashboard(rijen: ActieRij[], vandaag: string): Dashboard {
  const groepen = new Map<string, { id: string | null; naam: string; rijen: ActieRij[] }>();
  for (const r of rijen) {
    const sleutel = r.eigenaarId ?? `extern:${r.eigenaarExtern.toLowerCase()}`;
    const naam = r.eigenaarNaam ?? (r.eigenaarExtern ? `${r.eigenaarExtern} (buiten het team)` : 'Zonder eigenaar');
    if (!groepen.has(sleutel)) groepen.set(sleutel, { id: r.eigenaarId, naam, rijen: [] });
    groepen.get(sleutel)!.rijen.push(r);
  }
  const totaal = stand(rijen, vandaag);
  const open = rijen.filter((r) => r.status === 'open' && r.deadline);
  const opDeadline = (a: ActieRij, b: ActieRij) => (a.deadline ?? '').localeCompare(b.deadline ?? '');
  return {
    vandaag,
    totaal,
    team: team(rijen, vandaag, totaal),
    // Alfabetisch: geen volgorde naar prestatie.
    perEigenaar: [...groepen.values()].map((g) => ({ id: g.id, naam: g.naam, ...stand(g.rijen, vandaag) }))
      .sort((a, b) => a.naam.localeCompare(b.naam, 'nl')),
    teLaat: open.filter((r) => r.deadline! < vandaag).sort(opDeadline),
    binnenkort: open.filter((r) => r.deadline! >= vandaag && (dag(r.deadline!) - dag(vandaag)) / 86_400_000 <= BINNENKORT_DAGEN).sort(opDeadline),
  };
}
