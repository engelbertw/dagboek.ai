import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, deadlineTekst, vandaagIso, type Actie, type Medewerker } from '../api';
import { Badge, Leeg, Melding, Veld, foutTekst, useLaden } from '../ui';

const REDEN: Record<string, string> = {
  mogelijk_afgerond: 'Het model denkt dat dit is afgerond, maar de collega zei dat niet aantoonbaar.',
  bron_niet_te_verifieren: 'Deze actie staat niet aantoonbaar in het gesprek; een genoemde deadline is weggelaten.',
  eigenaar_onzeker: 'De genoemde eigenaar kwam niet voor in het gesprek.',
};

export function Acties() {
  const lijst = useLaden(() => api<Actie[]>('GET', '/acties'));
  const medewerkers = useLaden(() => api<Medewerker[]>('GET', '/employees'));
  const [status, setStatus] = useState<'open' | 'afgerond' | 'alle'>('open');
  const [eigenaar, setEigenaar] = useState('');
  const [fout, setFout] = useState<string | null>(null);
  const vandaag = vandaagIso();

  const teControleren = (lijst.data ?? []).filter((a) => a.controleNodig);
  const zichtbaar = (lijst.data ?? []).filter((a) => !a.controleNodig && (status === 'alle' || a.status === status) && (!eigenaar || a.eigenaarId === eigenaar));
  async function besluit(a: Actie, b: 'goedkeuren' | 'afwijzen') {
    try { await api('POST', `/open-items/${a.id}/controle`, { besluit: b }); setFout(null); lijst.ververs(); } catch (e) { setFout(foutTekst(e)); }
  }
  async function zet(a: Actie) {
    try { await api('PATCH', `/open-items/${a.id}`, { status: a.status === 'open' ? 'afgerond' : 'open' }); setFout(null); lijst.ververs(); } catch (e) { setFout(foutTekst(e)); }
  }
  return (
    <div className="stapel">
      <div><h1>Activiteitenregister</h1><p className="zacht">Alle acties uit gesprekken en handmatig toegevoegd, met eigenaar en deadline.</p></div>
      <div className="rij">
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
      </div>
      <Melding tekst={fout ?? lijst.fout} />
      {teControleren.length > 0 && (
        <section className="paneel stapel" aria-label="Controle nodig">
          <h2>Controle nodig ({teControleren.length})</h2>
          <p className="zacht klein">Deze punten komen uit een gesprek, maar het taalmodel kon ze niet onderbouwen met wat de collega zei. Ze tellen pas mee na jouw besluit en komen niet in het volgende gesprek.</p>
          {teControleren.map((a) => (
            <div key={a.id} className="punt">
              <span style={{ flex: 1, minWidth: 180 }}>
                <Link to={`/onderwerp/${a.topicId}`}>{a.tekst}</Link> <span className="zacht klein">· {a.topicTitel}</span>
                <br /><span className="zacht klein">{REDEN[a.controleReden ?? ''] ?? 'Controle nodig'}</span>
              </span>
              <button type="button" className="primair" onClick={() => besluit(a, 'goedkeuren')}>{a.controleReden === 'mogelijk_afgerond' ? 'Afgerond' : 'Klopt'}</button>
              <button type="button" onClick={() => besluit(a, 'afwijzen')}>{a.controleReden === 'mogelijk_afgerond' ? 'Nog open' : 'Verwijderen'}</button>
            </div>
          ))}
        </section>
      )}
      <section className="paneel">
        {zichtbaar.length === 0 && <Leeg>Geen acties gevonden.</Leeg>}
        {zichtbaar.map((a) => {
          const teLaat = a.status === 'open' && !!a.deadline && a.deadline < vandaag;
          return (
            <div key={a.id} className={`punt ${a.status === 'afgerond' ? 'klaar' : ''}`}>
              <input type="checkbox" checked={a.status === 'afgerond'} onChange={() => zet(a)} aria-label={`Afgerond: ${a.tekst}`} />
              <span style={{ flex: 1, minWidth: 180 }}><Link to={`/onderwerp/${a.topicId}`}>{a.tekst}</Link> <span className="zacht klein">· {a.topicTitel}</span></span>
              <span className="zacht klein">{a.eigenaarNaam ?? (a.eigenaarExtern ? `${a.eigenaarExtern} (extern)` : 'Geen eigenaar')}</span>
              {teLaat && <Badge soort="mislukt">te laat</Badge>}
              <Badge soort={teLaat ? 'mislukt' : ''}>{deadlineTekst(a.deadline)}</Badge>
            </div>
          );
        })}
      </section>
    </div>
  );
}
