import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SOORT_LABEL, api, deadlineTekst, vandaagIso, type Activiteit, type ActiviteitSoort, type Medewerker } from '../api';
import { Badge, Leeg, Melding, Veld, foutTekst, useLaden } from '../ui';

export const REDEN: Record<string, string> = {
  bron_niet_te_verifieren: 'Dit staat niet aantoonbaar in het gesprek; een genoemde deadline is weggelaten.',
  klant_niet_herkend: 'De klant is niet herkend of nog niet bevestigd. Koppel de klant of bevestig de voorgestelde klant.',
  eigenaar_onzeker: 'De genoemde eigenaar kwam niet voor in het gesprek.',
};

const DETAIL_LABEL: Record<string, string> = {
  indicatie_bedrag: 'indicatie', fase: 'fase', beslisser: 'beslisser', verwachte_datum: 'verwacht', concurrent: 'concurrent', budget_aanwezig: 'budget', contract: 'contract',
};

/** De velden van een kans die zijn genoemd; wat de accountmanager niet wist blijft weg. */
export function Details({ a }: { a: Pick<Activiteit, 'details'> }) {
  const regels = Object.entries(a.details ?? {}).filter(([, v]) => typeof v === 'string' && v).map(([k, v]) => `${DETAIL_LABEL[k] ?? k}: ${v as string}`);
  return regels.length ? <><br /><span className="zacht klein">{regels.join(' · ')}</span></> : null;
}

export function Verkoopregister() {
  const lijst = useLaden(() => api<Activiteit[]>('GET', '/verkoopregister'));
  const medewerkers = useLaden(() => api<Medewerker[]>('GET', '/employees'));
  const [soort, setSoort] = useState<'' | ActiviteitSoort>('');
  const [status, setStatus] = useState<'open' | 'afgerond' | 'alle'>('open');
  const [eigenaar, setEigenaar] = useState('');
  const [klant, setKlant] = useState('');
  const [teLaat, setTeLaat] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const vandaag = vandaagIso();

  const alle = lijst.data ?? [];
  const teControleren = alle.filter((a) => a.controleNodig);
  const klanten = [...new Map(alle.filter((a) => a.klantId).map((a) => [a.klantId!, a.klantNaam ?? ''])).entries()].sort((x, y) => x[1].localeCompare(y[1]));
  const zichtbaar = alle.filter((a) => !a.controleNodig && (!soort || a.soort === soort) && (status === 'alle' || a.status === status)
    && (!eigenaar || a.eigenaarId === eigenaar) && (!klant || a.klantId === klant) && (!teLaat || (a.status === 'open' && !!a.deadline && a.deadline < vandaag)));

  async function besluit(a: Activiteit, b: 'goedkeuren' | 'afwijzen') {
    try { await api('POST', `/activiteiten/${a.id}/controle`, { besluit: b }); setFout(null); lijst.ververs(); } catch (e) { setFout(foutTekst(e)); }
  }
  async function zet(a: Activiteit) {
    try { await api('PATCH', `/activiteiten/${a.id}`, { status: a.status === 'open' ? 'afgerond' : 'open' }); setFout(null); lijst.ververs(); } catch (e) { setFout(foutTekst(e)); }
  }
  const wijsAf = (a: Activiteit) => (a.eigenaarNaam ?? (a.eigenaarExtern ? `${a.eigenaarExtern} (extern)` : 'Geen eigenaar'));

  return (
    <div className="stapel">
      <div><h1>Verkoopregister</h1><p className="zacht">Alles wat accountmanagers na een klantbezoek hebben gemeld: doelen, resultaten, afspraken, acties, kansen en risico’s, per klant.</p></div>
      <div className="rij">
        <Veld label="Soort">
          <select value={soort} onChange={(e) => setSoort(e.target.value as typeof soort)}>
            <option value="">Alle soorten</option>
            {(Object.keys(SOORT_LABEL) as ActiviteitSoort[]).map((k) => <option key={k} value={k}>{SOORT_LABEL[k]}</option>)}
          </select>
        </Veld>
        <Veld label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="open">Open</option><option value="afgerond">Afgerond</option><option value="alle">Alle</option>
          </select>
        </Veld>
        <Veld label="Eigenaar">
          <select value={eigenaar} onChange={(e) => setEigenaar(e.target.value)}>
            <option value="">Iedereen</option>
            {medewerkers.data?.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
          </select>
        </Veld>
        <Veld label="Klant">
          <select value={klant} onChange={(e) => setKlant(e.target.value)}>
            <option value="">Alle klanten</option>
            {klanten.map(([id, naam]) => <option key={id} value={id}>{naam}</option>)}
          </select>
        </Veld>
        <label className="rij"><input type="checkbox" checked={teLaat} onChange={(e) => setTeLaat(e.target.checked)} /> Alleen te laat</label>
      </div>
      <Melding tekst={fout ?? lijst.fout} />
      {teControleren.length > 0 && (
        <section className="paneel stapel" aria-label="Controle nodig">
          <h2>Controle nodig ({teControleren.length})</h2>
          <p className="zacht klein">Deze punten komen uit een verkoop-debrief, maar konden niet worden onderbouwd met wat de accountmanager zei, of de klant is niet herkend. Ze tellen pas mee na jouw besluit.</p>
          {teControleren.map((a) => (
            <div key={a.id} className="punt">
              <span style={{ flex: 1, minWidth: 180 }}>
                <Badge>{SOORT_LABEL[a.soort]}</Badge> {a.omschrijving} <span className="zacht klein">· {a.klantId ? <Link to={`/klanten/${a.klantId}`}>{a.klantNaam}</Link> : 'klant onbekend'}</span>
                <Details a={a} />
                <br /><span className="zacht klein">{REDEN[a.controleReden ?? ''] ?? 'Controle nodig'}</span>
              </span>
              <button type="button" className="primair" onClick={() => void besluit(a, 'goedkeuren')}>Klopt</button>
              <button type="button" onClick={() => void besluit(a, 'afwijzen')}>Verwijderen</button>
            </div>
          ))}
        </section>
      )}
      <section className="paneel">
        {zichtbaar.length === 0 && <Leeg>Niets gevonden.</Leeg>}
        {zichtbaar.map((a) => {
          const laat = a.status === 'open' && !!a.deadline && a.deadline < vandaag;
          return (
            <div key={a.id} className={`punt ${a.status === 'afgerond' ? 'klaar' : ''}`}>
              <input type="checkbox" checked={a.status === 'afgerond'} onChange={() => void zet(a)} aria-label={`Afgerond: ${a.omschrijving}`} />
              <span style={{ flex: 1, minWidth: 180 }}>
                <Badge>{SOORT_LABEL[a.soort]}</Badge> {a.omschrijving} <span className="zacht klein">· {a.klantId ? <Link to={`/klanten/${a.klantId}`}>{a.klantNaam}</Link> : 'klant onbekend'}</span>
                <Details a={a} />
              </span>
              {(a.soort === 'actie' || a.soort === 'afspraak') && <span className="zacht klein">{wijsAf(a)}</span>}
              {laat && <Badge soort="mislukt">te laat</Badge>}
              {a.deadline && <Badge soort={laat ? 'mislukt' : ''}>{deadlineTekst(a.deadline)}</Badge>}
            </div>
          );
        })}
      </section>
    </div>
  );
}
