import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, datum, type KlantRegel, type Medewerker, type Project, type TopicRegel } from '../api';
import { Badge, Leeg, Melding, foutTekst, useLaden } from '../ui';
import { LEGE_TOPIC, TopicVelden, type TopicWaarden } from './TopicVelden';

const FILTERS = [['actief', 'Actief'], ['wacht', 'Wacht'], ['afgerond', 'Afgerond'], ['alle', 'Alles']] as const;

export function Dagboek() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('actief');
  const lijst = useLaden(() => api<TopicRegel[]>('GET', `/topics?status=${filter}`), [filter]);
  const medewerkers = useLaden(() => api<Medewerker[]>('GET', '/employees'));
  const projecten = useLaden(() => api<Project[]>('GET', '/projects'));
  const klanten = useLaden(() => api<KlantRegel[]>('GET', '/klanten'));
  const [nieuw, setNieuw] = useState<TopicWaarden | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const navigeer = useNavigate();

  async function maakAan(e: FormEvent) {
    e.preventDefault();
    if (!nieuw) return;
    try {
      const t = await api<{ id: string }>('POST', '/topics', nieuw);
      navigeer(`/onderwerp/${t.id}`);
    } catch (err) { setFout(foutTekst(err)); }
  }

  return (
    <div className="stapel">
      <div className="rij spreid">
        <div><h1>Dagboek</h1><p className="zacht">Alle onderwerpen die we volgen tot ze zijn afgerond.</p></div>
        <button className="primair" onClick={() => { setNieuw(nieuw ? null : LEGE_TOPIC); setFout(null); }}>{nieuw ? 'Annuleren' : 'Nieuw onderwerp'}</button>
      </div>

      {nieuw && (
        <form className="paneel stapel" onSubmit={maakAan}>
          <h2>Nieuw onderwerp</h2>
          <TopicVelden waarden={nieuw} zet={setNieuw} medewerkers={medewerkers.data ?? []} projecten={projecten.data ?? []} klanten={klanten.data ?? []} />
          <Melding tekst={fout} />
          <button className="primair" type="submit">Onderwerp aanmaken</button>
        </form>
      )}

      <div className="rij" role="group" aria-label="Filter op status">
        {FILTERS.map(([waarde, label]) => (
          <button key={waarde} className={filter === waarde ? 'primair' : ''} aria-pressed={filter === waarde} onClick={() => setFilter(waarde)}>{label}</button>
        ))}
      </div>

      <Melding tekst={lijst.fout} />
      {lijst.data && lijst.data.length === 0 && <Leeg>{filter === 'actief' ? 'Nog geen actieve onderwerpen. Maak er een aan om te beginnen.' : 'Geen onderwerpen met deze status.'}</Leeg>}
      <div className="stapel">
        {lijst.data?.map((t) => (
          <Link key={t.id} to={`/onderwerp/${t.id}`} className="paneel kaart">
            <div className="rij spreid">
              <h3>{t.titel}</h3>
              <div className="rij"><Badge>{t.type}</Badge><Badge soort={t.status}>{t.status}</Badge></div>
            </div>
            <p className="zacht klein">
              {[t.klantNaam, t.projectNaam, t.eigenaarNaam ? `bellen: ${t.eigenaarNaam}` : 'nog niemand gekoppeld'].filter(Boolean).join(' · ')}
              {t.openPunten > 0 && ` · ${t.openPunten} open ${t.openPunten === 1 ? 'punt' : 'punten'}`}
            </p>
            {t.laatsteUpdate
              ? <p><span className="zacht klein">{datum(t.laatsteUpdate.createdAt)}: </span>{t.laatsteUpdate.samenvatting}</p>
              : <p className="zacht">Nog geen update.</p>}
          </Link>
        ))}
      </div>
    </div>
  );
}
