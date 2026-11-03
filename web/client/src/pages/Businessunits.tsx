import { useState, type FormEvent } from 'react';
import { api, type BusinessUnit } from '../api';
import { Badge, Leeg, Melding, Veld, foutTekst, useLaden } from '../ui';

const LEEG = { naam: '', afkorting: '', volgorde: 100 };

export function Businessunits() {
  const lijst = useLaden(() => api<BusinessUnit[]>('GET', '/business-units'));
  const [nieuw, setNieuw] = useState<typeof LEEG | null>(null);
  const [bewerk, setBewerk] = useState<(typeof LEEG & { id: string }) | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const doe = async (taak: () => Promise<unknown>) => { try { await taak(); setFout(null); setNieuw(null); setBewerk(null); lijst.ververs(); } catch (e) { setFout(foutTekst(e)); } };

  const velden = (w: typeof LEEG, zet: (w: typeof LEEG) => void) => (
    <div className="raster">
      <Veld label="Naam"><input value={w.naam} maxLength={100} required onChange={(e) => zet({ ...w, naam: e.target.value })} /></Veld>
      <Veld label="Afkorting"><input value={w.afkorting} maxLength={20} required onChange={(e) => zet({ ...w, afkorting: e.target.value })} /></Veld>
      <Veld label="Volgorde"><input type="number" min={0} max={999} value={w.volgorde} onChange={(e) => zet({ ...w, volgorde: Number(e.target.value) })} /></Veld>
    </div>
  );

  return (
    <div className="stapel">
      <div className="rij spreid">
        <div><h1>Businessunits</h1><p className="zacht">De organisatie-eenheden waaraan je medewerkers en gebruikers koppelt. Een unit die in gebruik is, verberg je door hem op niet-actief te zetten.</p></div>
        {!nieuw && <button type="button" className="primair" onClick={() => { setNieuw(LEEG); setBewerk(null); }}>Businessunit toevoegen</button>}
      </div>
      <Melding tekst={fout ?? lijst.fout} />
      {nieuw && (
        <form className="paneel stapel" onSubmit={(e: FormEvent) => { e.preventDefault(); void doe(() => api('POST', '/business-units', nieuw)); }}>
          <h2>Businessunit toevoegen</h2>
          {velden(nieuw, setNieuw)}
          <div className="rij"><button className="primair" type="submit">Toevoegen</button><button type="button" onClick={() => setNieuw(null)}>Annuleren</button></div>
        </form>
      )}
      {lijst.data && lijst.data.length === 0 && <Leeg>Nog geen businessunits.</Leeg>}
      <ul className="gebruikerslijst" aria-label="Businessunits">
        {lijst.data?.map((u) => (
          <li key={u.id}>
            {bewerk?.id === u.id ? (
              <form className="paneel stapel" style={{ width: '100%' }} onSubmit={(e: FormEvent) => { e.preventDefault(); void doe(() => api('PATCH', `/business-units/${u.id}`, { naam: bewerk.naam, afkorting: bewerk.afkorting, volgorde: bewerk.volgorde })); }}>
                {velden(bewerk, (w) => setBewerk({ ...bewerk, ...w }))}
                <div className="rij"><button className="primair" type="submit">Opslaan</button><button type="button" onClick={() => setBewerk(null)}>Annuleren</button></div>
              </form>
            ) : (
              <div className={`rij spreid eenheid${u.actief ? '' : ' uit'}`}>
                <span><strong>{u.naam}</strong> <span className="zacht">({u.afkorting})</span> {!u.actief && <Badge>niet actief</Badge>}</span>
                <span className="rij">
                  <button type="button" onClick={() => { setBewerk({ id: u.id, naam: u.naam, afkorting: u.afkorting, volgorde: u.volgorde }); setNieuw(null); }}>Bewerken</button>
                  <button type="button" onClick={() => void doe(() => api('PATCH', `/business-units/${u.id}`, { actief: !u.actief }))}>{u.actief ? 'Op niet actief zetten' : 'Weer actief maken'}</button>
                  <button type="button" className="gevaar" onClick={() => { if (window.confirm(`${u.naam} verwijderen?`)) void doe(() => api('DELETE', `/business-units/${u.id}`)); }}>Verwijderen</button>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
