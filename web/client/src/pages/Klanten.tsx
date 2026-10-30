import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { KLANT_STATUS_LABEL, api, datum, type KlantRegel, type KlantStatus } from '../api';
import { Badge, Leeg, Melding, Veld, foutTekst, useLaden } from '../ui';

export function Klanten() {
  const lijst = useLaden(() => api<KlantRegel[]>('GET', '/klanten'));
  const [zoek, setZoek] = useState('');
  const [nieuw, setNieuw] = useState<{ naam: string; status: KlantStatus } | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const zichtbaar = (lijst.data ?? []).filter((k) => k.naam.toLowerCase().includes(zoek.trim().toLowerCase()));
  const voorgesteld = (lijst.data ?? []).filter((k) => k.status === 'voorgesteld');

  async function maakAan(e: FormEvent) {
    e.preventDefault();
    try { await api('POST', '/klanten', nieuw); setNieuw(null); setFout(null); lijst.ververs(); } catch (err) { setFout(foutTekst(err)); }
  }
  return (
    <div className="stapel">
      <div className="rij spreid">
        <div><h1>Klanten</h1><p className="zacht">Klanten uit verkoop-debriefs, met bezoeken, afspraken en kansen. Een klant die alleen uit een gesprek komt is een voorstel tot jij hem bevestigt.</p></div>
        <button className="primair" onClick={() => setNieuw(nieuw ? null : { naam: '', status: 'klant' })}>{nieuw ? 'Annuleren' : 'Nieuwe klant'}</button>
      </div>
      {nieuw && (
        <form className="paneel stapel" onSubmit={maakAan}>
          <div className="raster">
            <Veld label="Naam"><input value={nieuw.naam} onChange={(e) => setNieuw({ ...nieuw, naam: e.target.value })} required maxLength={200} /></Veld>
            <Veld label="Status">
              <select value={nieuw.status} onChange={(e) => setNieuw({ ...nieuw, status: e.target.value as KlantStatus })}>
                <option value="klant">Klant</option><option value="prospect">Prospect</option>
              </select>
            </Veld>
          </div>
          <Melding tekst={fout} />
          <button className="primair" type="submit">Toevoegen</button>
        </form>
      )}
      <Melding tekst={lijst.fout} />
      {voorgesteld.length > 0 && <p className="melding" role="status">{voorgesteld.length} {voorgesteld.length === 1 ? 'klant wacht' : 'klanten wachten'} op bevestiging of samenvoegen (status Voorgesteld).</p>}
      <Veld label="Zoeken"><input type="search" value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Naam van de klant" /></Veld>
      {lijst.data?.length === 0 && <Leeg>Nog geen klanten. Ze verschijnen na de eerste verkoop-debrief.</Leeg>}
      {zichtbaar.map((k) => (
        <div key={k.id} className="paneel rij spreid">
          <div>
            <h3><Link to={`/klanten/${k.id}`}>{k.naam}</Link> <Badge soort={k.status === 'voorgesteld' ? 'wacht' : ''}>{KLANT_STATUS_LABEL[k.status]}</Badge></h3>
            <span className="zacht klein">
              {k.accountmanagerNaam ? `Accountmanager ${k.accountmanagerNaam}` : 'Geen accountmanager'}
              {k.laatsteBezoek && ` · laatste bezoek ${datum(k.laatsteBezoek)}`}
              {k.contractEinde && ` · contract tot ${datum(k.contractEinde)}`}
            </span>
          </div>
          <span className="zacht klein">{k.openActiviteiten} open</span>
        </div>
      ))}
    </div>
  );
}
