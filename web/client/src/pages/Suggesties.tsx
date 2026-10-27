import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, datum, type Suggestie } from '../api';
import { Badge, Leeg, Melding, foutTekst, useLaden } from '../ui';

function Regel({ s, ververs, fout }: { s: Suggestie; ververs: () => void; fout: (t: string | null) => void }) {
  const doe = async (f: () => Promise<unknown>) => { try { await f(); fout(null); ververs(); } catch (e) { fout(foutTekst(e)); } };
  return (
    <div className="punt">
      <span style={{ flex: 1, minWidth: 200 }}>
        {s.tekst} <span className="zacht klein">· {s.employeeNaam ?? 'onbekend'}, {datum(s.createdAt)}</span>
        {s.topicId && <> <Link to={`/onderwerp/${s.topicId}`}>naar het onderwerp</Link></>}
      </span>
      {s.status !== 'nieuw' && <Badge soort={s.status === 'afgewezen' ? 'mislukt' : 'afgerond'}>{s.status}</Badge>}
      {s.status === 'nieuw' && s.soort === 'onderwerp' && <button onClick={() => doe(() => api('POST', `/suggesties/${s.id}/overnemen`))}>Als onderwerp overnemen</button>}
      {s.status === 'nieuw' && s.soort === 'verbetering' && <button onClick={() => doe(() => api('PATCH', `/suggesties/${s.id}`, { status: 'klaar' }))}>Afgehandeld</button>}
      {s.status === 'nieuw' && <button className="tekstknop gevaar" onClick={() => doe(() => api('PATCH', `/suggesties/${s.id}`, { status: 'afgewezen' }))}>Afwijzen</button>}
      {s.status !== 'nieuw' && s.status !== 'overgenomen' && <button className="tekstknop" onClick={() => doe(() => api('PATCH', `/suggesties/${s.id}`, { status: 'nieuw' }))}>Heropenen</button>}
    </div>
  );
}

export function Suggesties() {
  const lijst = useLaden(() => api<Suggestie[]>('GET', '/suggesties'));
  const [fout, setFout] = useState<string | null>(null);
  const [alles, setAlles] = useState(false);
  const zichtbaar = (soort: Suggestie['soort']) => (lijst.data ?? []).filter((s) => s.soort === soort && (alles || s.status === 'nieuw'));
  return (
    <div className="stapel">
      <div className="rij spreid">
        <div><h1>Suggesties</h1><p className="zacht">Wat collega’s aan het eind van een gesprek voorstellen: nieuwe onderwerpen om te volgen en verbeteringen voor dagboek.ai.</p></div>
        <label className="rij"><input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={alles} onChange={(e) => setAlles(e.target.checked)} /><span>Ook afgehandelde tonen</span></label>
      </div>
      <Melding tekst={fout ?? lijst.fout} />
      <section className="paneel"><h2>Nieuwe onderwerpen</h2>
        {zichtbaar('onderwerp').length === 0 && <Leeg>Geen voorgestelde onderwerpen.</Leeg>}
        {zichtbaar('onderwerp').map((s) => <Regel key={s.id} s={s} ververs={lijst.ververs} fout={setFout} />)}
      </section>
      <section className="paneel"><h2>Verbeteringen voor dagboek.ai</h2>
        {zichtbaar('verbetering').length === 0 && <Leeg>Geen verbetersuggesties.</Leeg>}
        {zichtbaar('verbetering').map((s) => <Regel key={s.id} s={s} ververs={lijst.ververs} fout={setFout} />)}
      </section>
    </div>
  );
}
