import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, datum, type KlantRegel, type SamenverderProgrammaRegel } from '../api';
import { Badge, Leeg, Melding, Veld, foutTekst, useLaden } from '../ui';
import { BudgetRegel } from './Budget';

const periode = (p: { periodeVan: string; periodeTot: string | null }) => `${datum(p.periodeVan)}${p.periodeTot ? ` – ${datum(p.periodeTot)}` : ' –'}`;

/** Overzicht van de SamenVerder-programma's per gemeente. Een accountmanager kan lezen; een beheerder maakt programma's aan. */
export function SamenVerder({ alleenLezen = false }: { alleenLezen?: boolean }) {
  const [status, setStatus] = useState<'actief' | 'afgerond' | ''>('actief');
  const [zoek] = useSearchParams();
  const klantFilter = zoek.get('klant') ?? '';
  const vraag = [status ? `status=${status}` : '', /^[0-9a-f-]{36}$/i.test(klantFilter) ? `klantId=${klantFilter}` : ''].filter(Boolean).join('&');
  const lijst = useLaden(() => api<SamenverderProgrammaRegel[]>('GET', `/samenverder/programmas${vraag ? `?${vraag}` : ''}`), [vraag]);
  const klanten = useLaden(() => (alleenLezen ? Promise.resolve([] as KlantRegel[]) : api<KlantRegel[]>('GET', '/klanten')), [alleenLezen]);
  const [nieuw, setNieuw] = useState({ klantId: '', pakket: '', periodeVan: '', periodeTot: '' });
  const [melding, setMelding] = useState<string | null>(null);
  async function maakAan(e: FormEvent) {
    e.preventDefault();
    try {
      await api('POST', '/samenverder/programmas', { klantId: nieuw.klantId, pakket: nieuw.pakket, periodeVan: nieuw.periodeVan, periodeTot: nieuw.periodeTot || null });
      setNieuw({ klantId: '', pakket: '', periodeVan: '', periodeTot: '' }); setMelding(null); void lijst.ververs();
    } catch (er) { setMelding(foutTekst(er)); }
  }
  return (
    <div className="stapel">
      <h1>SamenVerder</h1>
      <Melding tekst={lijst.fout} />
      <div className="rij">
        {klantFilter && <Link to="/samenverder">Alle gemeenten tonen</Link>}
        <label>Status <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="actief">Actief</option><option value="afgerond">Afgerond</option><option value="">Alle</option></select></label>
      </div>
      {lijst.data && lijst.data.length === 0 ? <Leeg>Geen programma’s.</Leeg> : (
        <ul className="lijst-kaarten">
          {(lijst.data ?? []).map((p) => (
            <li key={p.id} className="paneel">
              <Link to={`/samenverder/${p.id}`}><strong>{p.klantNaam}</strong></Link> <Badge soort={p.status === 'afgerond' ? 'wacht' : ''}>{p.status === 'actief' ? 'Actief' : 'Afgerond'}</Badge>
              <p className="zacht klein">{p.pakket || 'Geen pakket'} · {periode(p)}</p>
              <p>{p.aantalUitgevoerd} uitgevoerd · {p.aantalGepland} gepland{p.volgendeSessie ? ` · volgende sessie ${datum(p.volgendeSessie)}` : ' · geen volgende sessie gepland'}</p>
              <p><BudgetRegel budget={p.budget} /></p>
            </li>
          ))}
        </ul>
      )}
      {!alleenLezen && (
        <form className="paneel stapel" onSubmit={maakAan} aria-label="Nieuw programma">
          <h2>Nieuw programma</h2>
          <div className="raster">
            <Veld label="Gemeente"><select value={nieuw.klantId} onChange={(e) => setNieuw({ ...nieuw, klantId: e.target.value })} required><option value="">Kies een gemeente</option>{(klanten.data ?? []).map((k) => <option key={k.id} value={k.id}>{k.naam}</option>)}</select></Veld>
            <Veld label="Pakket"><input value={nieuw.pakket} onChange={(e) => setNieuw({ ...nieuw, pakket: e.target.value })} maxLength={200} /></Veld>
            <Veld label="Periode van"><input type="date" value={nieuw.periodeVan} onChange={(e) => setNieuw({ ...nieuw, periodeVan: e.target.value })} required /></Veld>
            <Veld label="Periode tot"><input type="date" value={nieuw.periodeTot} onChange={(e) => setNieuw({ ...nieuw, periodeTot: e.target.value })} /></Veld>
          </div>
          <Melding tekst={melding} />
          <button className="primair" type="submit">Programma aanmaken</button>
        </form>
      )}
    </div>
  );
}
