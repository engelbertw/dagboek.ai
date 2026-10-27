import { useState } from 'react';
import { api, datumTijd, type Gesprek, type GesprekRegel } from '../api';
import { Badge, Leeg, Melding, foutTekst, useLaden } from '../ui';

const LABEL: Record<string, string> = {
  gepland: 'gepland', belt: 'belt', gesprek: 'in gesprek', gesproken: 'gesproken', niet_bereikt: 'niet bereikt', voicemail: 'voicemail', mislukt: 'mislukt',
};

function Regel({ g }: { g: GesprekRegel }) {
  const [detail, setDetail] = useState<Gesprek | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  async function toggle() {
    if (detail) return setDetail(null);
    try { setDetail(await api<Gesprek>('GET', `/calls/${g.id}`)); } catch (e) { setFout(foutTekst(e)); }
  }
  return (
    <div className="paneel stapel">
      <div className="rij spreid">
        <div><h3>{g.employeeNaam}</h3><span className="zacht klein">{datumTijd(g.createdAt)} · {g.bron}</span></div>
        <div className="rij"><Badge soort={g.status}>{LABEL[g.status]}</Badge><button onClick={toggle} aria-expanded={!!detail}>{detail ? 'Verbergen' : 'Bekijken'}</button></div>
      </div>
      {g.fout && <p className="zacht klein">{g.fout}</p>}
      <Melding tekst={fout} />
      {detail && (detail.transcript?.length ? (
        <div className="chat" aria-label="Transcript">
          {detail.transcript.map((m, i) => <p key={i} className={m.role}><strong>{m.role === 'assistant' ? 'Assistent' : g.employeeNaam}:</strong> {m.content}</p>)}
        </div>
      ) : <Leeg>Geen transcript beschikbaar.</Leeg>)}
    </div>
  );
}

export function Gesprekken() {
  const lijst = useLaden(() => api<GesprekRegel[]>('GET', '/calls'));
  return (
    <div className="stapel">
      <div className="rij spreid">
        <div><h1>Gesprekken</h1><p className="zacht">Alle gesprekken met uitkomst en transcript.</p></div>
        <button onClick={lijst.ververs}>Verversen</button>
      </div>
      <Melding tekst={lijst.fout} />
      {lijst.data?.length === 0 && <Leeg>Nog geen gesprekken. Start er een via Medewerkers → Bel nu.</Leeg>}
      {lijst.data?.map((g) => <Regel key={g.id} g={g} />)}
    </div>
  );
}
