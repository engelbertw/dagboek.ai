export interface ActieRij {
  id: string; tekst: string; topicId: string; topicTitel: string;
  eigenaarId: string | null; eigenaarNaam: string | null; eigenaarExtern: string;
  deadline: string | null; status: 'open' | 'afgerond'; createdAt: Date; afgerondOp: Date | null;
}

export interface Stand { open: number; teLaat: number; binnenkort: number; zonderDeadline: number; opTijd: number; laatAfgerond: number; nakoming: number | null }
export interface Dashboard {
  vandaag: string;
  totaal: Stand;
  perEigenaar: (Stand & { id: string | null; naam: string })[];
  teLaat: ActieRij[];
  binnenkort: ActieRij[];
}

const dag = (iso: string) => new Date(`${iso}T12:00:00Z`).getTime();
const NL = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
const NAKOMING_DAGEN = 90;
const BINNENKORT_DAGEN = 7;

function stand(rijen: ActieRij[], vandaag: string): Stand {
  const s = { open: 0, teLaat: 0, binnenkort: 0, zonderDeadline: 0, opTijd: 0, laatAfgerond: 0 };
  for (const r of rijen) {
    if (r.status === 'open') {
      s.open++;
      if (!r.deadline) s.zonderDeadline++;
      else if (r.deadline < vandaag) s.teLaat++;
      else if ((dag(r.deadline) - dag(vandaag)) / 86_400_000 <= BINNENKORT_DAGEN) s.binnenkort++;
    }
    // Nakomen telt alleen voor acties met een deadline in de afgelopen NAKOMING_DAGEN dagen.
    if (r.deadline && (dag(vandaag) - dag(r.deadline)) / 86_400_000 <= NAKOMING_DAGEN) {
      if (r.status === 'afgerond' && r.afgerondOp) { if (NL(r.afgerondOp) <= r.deadline) s.opTijd++; else s.laatAfgerond++; }
    }
  }
  const verlopenOpen = rijen.filter((r) => r.status === 'open' && r.deadline && r.deadline < vandaag && (dag(vandaag) - dag(r.deadline)) / 86_400_000 <= NAKOMING_DAGEN).length;
  const noemer = s.opTijd + s.laatAfgerond + verlopenOpen;
  return { ...s, nakoming: noemer ? Math.round((s.opTijd / noemer) * 100) : null };
}

export function berekenDashboard(rijen: ActieRij[], vandaag: string): Dashboard {
  const groepen = new Map<string, { id: string | null; naam: string; rijen: ActieRij[] }>();
  for (const r of rijen) {
    const sleutel = r.eigenaarId ?? `extern:${r.eigenaarExtern.toLowerCase()}`;
    const naam = r.eigenaarNaam ?? (r.eigenaarExtern ? `${r.eigenaarExtern} (buiten het team)` : 'Zonder eigenaar');
    if (!groepen.has(sleutel)) groepen.set(sleutel, { id: r.eigenaarId, naam, rijen: [] });
    groepen.get(sleutel)!.rijen.push(r);
  }
  const open = rijen.filter((r) => r.status === 'open' && r.deadline);
  const opDeadline = (a: ActieRij, b: ActieRij) => (a.deadline ?? '').localeCompare(b.deadline ?? '');
  return {
    vandaag,
    totaal: stand(rijen, vandaag),
    perEigenaar: [...groepen.values()].map((g) => ({ id: g.id, naam: g.naam, ...stand(g.rijen, vandaag) }))
      .sort((a, b) => b.teLaat - a.teLaat || b.open - a.open || a.naam.localeCompare(b.naam)),
    teLaat: open.filter((r) => r.deadline! < vandaag).sort(opDeadline),
    binnenkort: open.filter((r) => r.deadline! >= vandaag && (dag(r.deadline!) - dag(vandaag)) / 86_400_000 <= BINNENKORT_DAGEN).sort(opDeadline),
  };
}
