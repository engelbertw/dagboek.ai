import { api, type BusinessUnit } from '../api';
import { Veld, useLaden } from '../ui';

/** De businessunits voor een keuzelijst; een inactieve unit blijft zichtbaar als iemand er al aan gekoppeld is. */
export function useBusinessUnits() {
  return useLaden(() => api<BusinessUnit[]>('GET', '/business-units'));
}

export const unitAfkorting = (units: BusinessUnit[] | null, id: string | null | undefined) => units?.find((u) => u.id === id)?.afkorting ?? '';

/** Een rustige regel onder een naam: "functie · afkorting", leeg als er niets is ingevuld. */
export const functieRegel = (units: BusinessUnit[] | null, functie: string | undefined, id: string | null | undefined) => [functie, unitAfkorting(units, id)].filter(Boolean).join(' · ');

export interface FunctieUnit { functie: string; businessUnitId: string | null }

export function FunctieUnitVelden({ waarden, zet, units }: { waarden: FunctieUnit; zet: (w: FunctieUnit) => void; units: BusinessUnit[] }) {
  const keuzes = units.filter((u) => u.actief || u.id === waarden.businessUnitId);
  return (
    <>
      <Veld label="Functie"><input value={waarden.functie} maxLength={100} onChange={(e) => zet({ ...waarden, functie: e.target.value })} placeholder="Bijvoorbeeld consultant" /></Veld>
      <Veld label="Businessunit">
        <select value={waarden.businessUnitId ?? ''} onChange={(e) => zet({ ...waarden, businessUnitId: e.target.value || null })}>
          <option value="">Geen</option>
          {keuzes.map((u) => <option key={u.id} value={u.id}>{u.naam} ({u.afkorting})</option>)}
        </select>
      </Veld>
    </>
  );
}
