import { useState } from 'react';
import { api, datumTijd, type Gesprek, type GesprekRegel, type SamenvattingStatus } from '../api';
import { Badge, Leeg, Melding, foutTekst, useLaden } from '../ui';

const LABEL: Record<string, string> = {
  gepland: 'gepland', verzenden: 'wordt verzonden', onderbroken: 'onderbroken', belt: 'belt', gesprek: 'in gesprek', gesproken: 'gesproken', niet_bereikt: 'niet bereikt', voicemail: 'voicemail', mislukt: 'mislukt',
};

const SAMENVATTING: Record<SamenvattingStatus, { label: string; uitleg: string }> = {
  geen: { label: 'nog niet samengevat', uitleg: '' },
  bezig: { label: 'samenvatting bezig', uitleg: 'De samenvatting wordt gemaakt. Ververs de pagina over een halve minuut.' },
  klaar: { label: 'samengevat', uitleg: 'De updates en open punten staan in het dagboek bij de onderwerpen.' },
  geen_inhoud: { label: 'geen inhoud', uitleg: 'De collega heeft niets gezegd, dus er is niets samengevat.' },
  geweigerd: { label: 'toestemming geweigerd', uitleg: 'De collega wilde geen samenvatting. Er is niets opgeslagen en het transcript is gewist.' },
  onduidelijk: { label: 'toestemming onduidelijk', uitleg: 'Uit het gesprek bleek niet duidelijk of de collega akkoord was. Er is niets opgeslagen. Leg de toestemming vast bij Medewerkers en probeer het opnieuw.' },
  mislukt: { label: 'samenvatting mislukt', uitleg: '' },
};

const BADGE: Record<SamenvattingStatus, string> = {
  geen: '', bezig: 'belt', klaar: 'afgerond', geen_inhoud: '', geweigerd: 'mislukt', onduidelijk: 'wacht', mislukt: 'mislukt',
};

function Regel({ g, ververs }: { g: GesprekRegel; ververs: () => void }) {
  const [detail, setDetail] = useState<Gesprek | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  async function toggle() {
    if (detail) return setDetail(null);
    try { setDetail(await api<Gesprek>('GET', `/calls/${g.id}`)); } catch (e) { setFout(foutTekst(e)); }
  }
  async function opnieuw() {
    setBezig(true);
    try { await api('POST', `/calls/${g.id}/samenvatten`); setFout(null); ververs(); } catch (e) { setFout(foutTekst(e)); } finally { setBezig(false); }
  }
  const s = SAMENVATTING[g.samenvattingStatus];
  const kanOpnieuw = g.status === 'gesproken' && ['geen', 'mislukt', 'onduidelijk'].includes(g.samenvattingStatus);
  return (
    <div className="paneel stapel">
      <div className="rij spreid">
        <div><h3>{g.employeeNaam}</h3><span className="zacht klein">{datumTijd(g.createdAt)} · {g.bron}</span></div>
        <div className="rij"><Badge soort={g.status}>{LABEL[g.status]}</Badge><button onClick={toggle} aria-expanded={!!detail}>{detail ? 'Verbergen' : 'Bekijken'}</button></div>
      </div>
      {g.fout && <p className="zacht klein">{g.fout}</p>}
      {g.status === 'gesproken' && (
        <div className="rij">
          <Badge soort={BADGE[g.samenvattingStatus]}>{s.label}</Badge>
          <span className="zacht klein">{g.samenvattingStatus === 'mislukt' ? g.samenvattingFout : s.uitleg}</span>
          {kanOpnieuw && <button onClick={opnieuw} disabled={bezig}>{bezig ? 'Bezig…' : g.samenvattingStatus === 'geen' ? 'Nu samenvatten' : 'Opnieuw proberen'}</button>}
        </div>
      )}
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
      {lijst.data?.map((g) => <Regel key={g.id} g={g} ververs={lijst.ververs} />)}
    </div>
  );
}
