import { useState } from 'react';
import { api, datumTijd, MOTOR_LABEL, type Gesprek, type GesprekRegel, type GesprekType, type SamenvattingStatus } from '../api';
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

const OPHALEN: Record<string, string> = {
  afgerond: 'Het gesprek is opgehaald. De samenvatting volgt zo.', nog_bezig: 'Het gesprek loopt bij ElevenLabs nog of wordt nog verwerkt. Probeer het zo opnieuw.',
  geen_gesprek: 'ElevenLabs kent dit gesprek niet (meer).', mislukt: 'Bij ElevenLabs is niemand aan het woord geweest, dus er is niets op te halen.',
  genegeerd: 'Dit gesprek was al afgeleverd.', onbekend: 'De voice-service kent dit gesprek niet.',
};

const BADGE: Record<SamenvattingStatus, string> = {
  geen: '', bezig: 'belt', klaar: 'afgerond', geen_inhoud: '', geweigerd: 'mislukt', onduidelijk: 'wacht', mislukt: 'mislukt',
};

function Beoordeling({ g, ververs }: { g: GesprekRegel; ververs: () => void }) {
  const [opmerking, setOpmerking] = useState(g.beoordelingOpmerking ?? '');
  const [fout, setFout] = useState<string | null>(null);
  async function zet(beoordeling: number | null) {
    try { await api('PUT', `/calls/${g.id}/beoordeling`, { beoordeling, opmerking }); setFout(null); ververs(); } catch (e) { setFout(foutTekst(e)); }
  }
  return (
    <div className="rij" role="group" aria-label="Beoordeling van het gesprek">
      <span className="zacht klein">Kwaliteit van het gesprek:</span>
      {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={g.beoordeling === n ? 'primair' : ''} aria-pressed={g.beoordeling === n} onClick={() => void zet(g.beoordeling === n ? null : n)}>{n}</button>)}
      <input value={opmerking} onChange={(e) => setOpmerking(e.target.value)} onBlur={() => { if (g.beoordeling && opmerking !== (g.beoordelingOpmerking ?? '')) void zet(g.beoordeling); }} placeholder="Opmerking (bijv. verstond hij me goed?)" maxLength={1000} style={{ flex: 1, minWidth: 180 }} aria-label="Opmerking bij de beoordeling" />
      <Melding tekst={fout} />
    </div>
  );
}

/** Per motor naast elkaar: aantal gesprekken, hoeveel er zijn gesproken, de gemiddelde duur en de gemiddelde beoordeling. */
function Vergelijking({ lijst }: { lijst: GesprekRegel[] }) {
  const groepen = new Map<string, GesprekRegel[]>();
  for (const g of lijst) groepen.set(g.engine ?? 'pipecat', [...(groepen.get(g.engine ?? 'pipecat') ?? []), g]);
  if (groepen.size < 2) return null;
  const gem = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return (
    <section className="paneel stapel" aria-label="Vergelijking van gespreksmotoren">
      <h2>Vergelijking per motor</h2>
      <table>
        <thead><tr><th>Motor</th><th>Gesprekken</th><th>Gesproken</th><th>Samengevat</th><th>Gem. duur</th><th>Gem. beoordeling</th></tr></thead>
        <tbody>
          {[...groepen].map(([motor, gs]) => {
            const gesproken = gs.filter((g) => g.status === 'gesproken');
            const duur = gem(gesproken.filter((g) => g.gestartOp && g.afgerondOp).map((g) => (new Date(g.afgerondOp!).getTime() - new Date(g.gestartOp!).getTime()) / 60000));
            const score = gem(gs.filter((g) => g.beoordeling).map((g) => g.beoordeling!));
            return (
              <tr key={motor}>
                <td>{MOTOR_LABEL[motor as keyof typeof MOTOR_LABEL] ?? motor}</td><td>{gs.length}</td><td>{gesproken.length}</td>
                <td>{gesproken.filter((g) => g.samenvattingStatus === 'klaar').length}</td>
                <td>{duur === null ? '–' : `${duur.toFixed(1)} min`}</td><td>{score === null ? '–' : score.toFixed(1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Regel({ g, ververs }: { g: GesprekRegel; ververs: () => void }) {
  const [detail, setDetail] = useState<Gesprek | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const [verloop, setVerloop] = useState<{ tijd: string; bron: string; gebeurtenis: string }[]>([]);
  async function toggle() {
    if (detail) return setDetail(null);
    try {
      setDetail(await api<Gesprek>('GET', `/calls/${g.id}`));
      setVerloop(await api('GET', `/calls/${g.id}/verloop`));
    } catch (e) { setFout(foutTekst(e)); }
  }
  async function wisTranscript() {
    if (!window.confirm('Het transcript van dit gesprek definitief wissen? De samenvatting in het dagboek blijft staan.')) return;
    try { await api('DELETE', `/calls/${g.id}/transcript`); setDetail(null); setFout(null); ververs(); } catch (e) { setFout(foutTekst(e)); }
  }
  async function opnieuw() {
    setBezig(true);
    try { await api('POST', `/calls/${g.id}/samenvatten`); setFout(null); ververs(); } catch (e) { setFout(foutTekst(e)); } finally { setBezig(false); }
  }
  async function ophalen() {
    setBezig(true);
    try {
      const r = await api<{ uitkomst: string }>('POST', `/calls/${g.id}/herstel`);
      setFout(OPHALEN[r.uitkomst] ?? `Uitkomst: ${r.uitkomst}`); ververs();
    } catch (e) { setFout(foutTekst(e)); } finally { setBezig(false); }
  }
  const debrief = g.type === 'verkoop_debrief';
  const s = SAMENVATTING[g.samenvattingStatus];
  const uitleg = debrief && g.samenvattingStatus === 'klaar' ? 'Het bezoek staat in het verkoopregister, bij de klant.' : s.uitleg;
  const kanOphalen = g.engine === 'elevenlabs_agent' && !g.heeftTranscript && !g.transcriptGewist && ['belt', 'gesprek', 'onderbroken', 'niet_bereikt', 'mislukt'].includes(g.status);
  const kanOpnieuw = g.status === 'gesproken' && ['geen', 'mislukt', 'onduidelijk'].includes(g.samenvattingStatus);
  return (
    <div className="paneel stapel">
      <div className="rij spreid">
        <div><h3>{g.employeeNaam} {debrief && <Badge soort="wacht">verkoop-debrief</Badge>}</h3><span className="zacht klein">{datumTijd(g.createdAt)} · {g.bron}{g.engine && ` · ${MOTOR_LABEL[g.engine]}`}</span></div>
        <div className="rij"><Badge soort={g.status}>{LABEL[g.status]}</Badge><button onClick={toggle} aria-expanded={!!detail}>{detail ? 'Verbergen' : 'Bekijken'}</button></div>
      </div>
      {g.fout && <p className="zacht klein">{g.fout}</p>}
      {kanOphalen && (
        <div className="rij">
          <span className="zacht klein">Er is geen transcript. Bij de ElevenLabs-agent kan het gesprek daar nog staan.</span>
          <button onClick={ophalen} disabled={bezig}>{bezig ? 'Bezig…' : 'Opnieuw ophalen'}</button>
        </div>
      )}
      {g.status === 'gesproken' && (
        <div className="rij">
          <Badge soort={BADGE[g.samenvattingStatus]}>{s.label}</Badge>
          <span className="zacht klein">{g.samenvattingStatus === 'mislukt' ? g.samenvattingFout : uitleg}</span>
          {kanOpnieuw && <button onClick={opnieuw} disabled={bezig}>{bezig ? 'Bezig…' : g.samenvattingStatus === 'geen' ? 'Nu samenvatten' : 'Opnieuw proberen'}</button>}
        </div>
      )}
      {g.status === 'gesproken' && <Beoordeling g={g} ververs={ververs} />}
      <Melding tekst={fout} />
      {detail && (detail.transcript?.length ? (
        <div className="chat" aria-label="Transcript">
          {detail.transcript.map((m, i) => <p key={i} className={m.role}><strong>{m.role === 'assistant' ? 'Assistent' : g.employeeNaam}:</strong> {m.content}</p>)}
        </div>
      ) : <Leeg>Geen transcript beschikbaar.</Leeg>)}
      {detail && !!detail.transcript?.length && <div className="rij"><button type="button" onClick={wisTranscript}>Transcript wissen</button></div>}
      {detail && verloop.length > 0 && (
        <details>
          <summary>Verloop van dit gesprek</summary>
          <ul className="klein" style={{ margin: '4px 0 0', paddingLeft: 20 }}>
            {verloop.map((v, i) => <li key={i}>{datumTijd(v.tijd)} · {v.bron} · {v.gebeurtenis}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Gesprekken die waarschijnlijk niet volledig in het dagboek staan: een agent-gesprek dat blijft hangen zonder transcript, of een samenvatting die niet lukt. */
const aandachtNodig = (g: GesprekRegel) =>
  (g.engine === 'elevenlabs_agent' && !g.heeftTranscript && !g.transcriptGewist && ['belt', 'gesprek', 'onderbroken'].includes(g.status) && Date.now() - Date.parse(g.createdAt) > 15 * 60_000)
  || (g.status === 'gesproken' && ['mislukt', 'geen'].includes(g.samenvattingStatus) && Date.now() - Date.parse(g.afgerondOp ?? g.createdAt) > 5 * 60_000);

export function Gesprekken() {
  const lijst = useLaden(() => api<GesprekRegel[]>('GET', '/calls'));
  const [type, setType] = useState<'alle' | GesprekType>('alle');
  const gefilterd = (lijst.data ?? []).filter((g) => type === 'alle' || (g.type ?? 'dagboek') === type);
  const aandacht = gefilterd.filter(aandachtNodig);
  return (
    <div className="stapel">
      <div className="rij spreid">
        <div><h1>Gesprekken</h1><p className="zacht">Alle gesprekken met uitkomst en transcript.</p></div>
        <div className="rij">
          <select aria-label="Soort gesprek" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="alle">Alle gesprekken</option><option value="dagboek">Dagboek</option><option value="verkoop_debrief">Verkoop-debrief</option>
          </select>
          <button onClick={lijst.ververs}>Verversen</button>
        </div>
      </div>
      <Melding tekst={lijst.fout} />
      {lijst.data?.length === 0 && <Leeg>Nog geen gesprekken. Start er een via Medewerkers → Bel nu.</Leeg>}
      {aandacht.length > 0 && (
        <section className="paneel stapel" aria-label="Aandacht nodig">
          <h2>Aandacht nodig ({aandacht.length})</h2>
          <p className="zacht klein">Deze gesprekken staan waarschijnlijk niet volledig in het dagboek. Het systeem probeert ze ook zelf op te halen en samen te vatten; hier kun je dat direct doen.</p>
          {aandacht.map((g) => <Regel key={g.id} g={g} ververs={lijst.ververs} />)}
        </section>
      )}
      {lijst.data && <Vergelijking lijst={gefilterd} />}
      {gefilterd.map((g) => <Regel key={g.id} g={g} ververs={lijst.ververs} />)}
    </div>
  );
}
