import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, datumTijd, type Activiteit, type Historie, type Medewerker, type Project, type TopicDetail, type Update } from '../api';
import { Badge, Leeg, Melding, Veld, foutTekst, useLaden } from '../ui';
import { Punten, PuntToevoegen, useActies } from './ActiviteitenLijst';
import { TopicVelden, type TopicWaarden } from './TopicVelden';

function UpdateRegel({ u, ververs }: { u: Update; ververs: () => void }) {
  const [bewerk, setBewerk] = useState(false);
  const [samenvatting, setSamenvatting] = useState(u.samenvatting);
  const [besluiten, setBesluiten] = useState(u.besluiten);
  const [historie, setHistorie] = useState<Historie[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  async function bewaar(e: FormEvent) {
    e.preventDefault();
    try { await api('PATCH', `/updates/${u.id}`, { samenvatting, besluiten }); setBewerk(false); ververs(); } catch (err) { setFout(foutTekst(err)); }
  }
  async function wis() {
    if (!confirm('Deze update verwijderen?')) return;
    try { await api('DELETE', `/updates/${u.id}`); ververs(); } catch (err) { setFout(foutTekst(err)); }
  }

  return (
    <li>
      <div className="rij"><strong>{datumTijd(u.createdAt)}</strong><Badge>{u.bron === 'voice' ? 'gesprek' : 'handmatig'}</Badge>{u.bewerktOp && <span className="zacht klein">bewerkt {datumTijd(u.bewerktOp)}</span>}</div>
      {bewerk ? (
        <form className="stapel" onSubmit={bewaar}>
          <Veld label="Update"><textarea value={samenvatting} onChange={(e) => setSamenvatting(e.target.value)} required /></Veld>
          <Veld label="Besluiten"><textarea value={besluiten} onChange={(e) => setBesluiten(e.target.value)} /></Veld>
          <Melding tekst={fout} />
          <div className="rij"><button className="primair" type="submit">Opslaan</button><button type="button" onClick={() => setBewerk(false)}>Annuleren</button></div>
        </form>
      ) : (
        <>
          <p style={{ whiteSpace: 'pre-wrap' }}>{u.samenvatting}</p>
          {u.besluiten && <p><strong>Besluiten:</strong> {u.besluiten}</p>}
          <Melding tekst={fout} />
          <div className="rij">
            <button className="tekstknop" onClick={() => setBewerk(true)}>Bewerken</button>
            {u.bewerktOp && <button className="tekstknop" onClick={async () => setHistorie(historie ? null : await api<Historie[]>('GET', `/updates/${u.id}/historie`))}>{historie ? 'Historie verbergen' : 'Historie'}</button>}
            <button className="tekstknop gevaar" onClick={wis}>Verwijderen</button>
          </div>
          {historie?.map((h) => <p key={h.id} className="zacht klein">Eerder ({datumTijd(h.gewijzigdOp)}): {h.vorigeSamenvatting}{h.vorigeBesluiten && ` — Besluiten: ${h.vorigeBesluiten}`}</p>)}
        </>
      )}
    </li>
  );
}

function OpenPunten({ topicId, medewerkers }: { topicId: string; medewerkers: Medewerker[] }) {
  const lijst = useLaden(() => api<Activiteit[]>('GET', `/activiteiten?topicId=${topicId}`), [topicId]);
  const acties = useActies(() => void lijst.ververs(), lijst.data ?? []);
  return (
    <section className="paneel stapel">
      <h2>Acties</h2>
      <Melding tekst={acties.fout ?? lijst.fout} />
      {acties.jiraPaneel}
      <Punten punten={lijst.data ?? []} acties={acties} medewerkers={medewerkers} leeg="Nog geen acties." />
      <PuntToevoegen acties={acties} medewerkers={medewerkers} vast={{ topicId }} />
    </section>
  );
}

export function Onderwerp() {
  const { id = '' } = useParams();
  const navigeer = useNavigate();
  const topic = useLaden(() => api<TopicDetail>('GET', `/topics/${id}`), [id]);
  const medewerkers = useLaden(() => api<Medewerker[]>('GET', '/employees'));
  const projecten = useLaden(() => api<Project[]>('GET', '/projects'));
  const [waarden, setWaarden] = useState<TopicWaarden | null>(null);
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  const [nieuweUpdate, setNieuweUpdate] = useState('');
  const [besluiten, setBesluiten] = useState('');

  useEffect(() => {
    const t = topic.data;
    if (t) setWaarden({ titel: t.titel, type: t.type, status: t.status, projectId: t.projectId, eigenaarId: t.eigenaarId, aanwijzingen: t.aanwijzingen });
  }, [topic.data]);

  if (topic.fout) return <Melding tekst={topic.fout} />;
  if (!topic.data || !waarden) return null;

  async function bewaar(e: FormEvent) {
    e.preventDefault();
    try { await api('PATCH', `/topics/${id}`, waarden); setMelding({ tekst: 'Opgeslagen', soort: 'ok' }); topic.ververs(); } catch (err) { setMelding({ tekst: foutTekst(err), soort: 'fout' }); }
  }
  async function voegUpdateToe(e: FormEvent) {
    e.preventDefault();
    try { await api('POST', `/topics/${id}/updates`, { samenvatting: nieuweUpdate, besluiten }); setNieuweUpdate(''); setBesluiten(''); topic.ververs(); } catch (err) { setMelding({ tekst: foutTekst(err), soort: 'fout' }); }
  }
  async function verwijder() {
    if (!confirm(`‘${topic.data!.titel}’ en alle updates verwijderen? Dit kan niet ongedaan worden.`)) return;
    try { await api('DELETE', `/topics/${id}`); navigeer('/'); } catch (err) { setMelding({ tekst: foutTekst(err), soort: 'fout' }); }
  }

  return (
    <div className="stapel">
      <p><Link to="/">← Dagboek</Link></p>
      <h1>{topic.data.titel}</h1>

      <section className="paneel">
        <h2>Dagboek</h2>
        {topic.data.updates.length === 0 ? <Leeg>Nog geen updates. Na het eerste gesprek verschijnt hier de samenvatting.</Leeg> : (
          <ul className="tijdlijn">{topic.data.updates.map((u) => <UpdateRegel key={u.id} u={u} ververs={topic.ververs} />)}</ul>
        )}
        <form className="stapel" onSubmit={voegUpdateToe}>
          <Veld label="Nieuwe update (handmatig)"><textarea value={nieuweUpdate} onChange={(e) => setNieuweUpdate(e.target.value)} required /></Veld>
          <Veld label="Besluiten (optioneel)"><input value={besluiten} onChange={(e) => setBesluiten(e.target.value)} /></Veld>
          <button type="submit" className="primair">Update toevoegen</button>
        </form>

      </section>

      <OpenPunten topicId={id} medewerkers={medewerkers.data ?? []} />

      <form className="paneel stapel" onSubmit={bewaar}>
        <h2>Gegevens van dit onderwerp</h2>
        <TopicVelden waarden={waarden} zet={setWaarden} medewerkers={medewerkers.data ?? []} projecten={projecten.data ?? []} />
        {melding && <Melding tekst={melding.tekst} soort={melding.soort} />}
        <div className="rij spreid"><button className="primair" type="submit">Opslaan</button><button type="button" className="gevaar" onClick={verwijder}>Onderwerp verwijderen</button></div>
      </form>
    </div>
  );
}
