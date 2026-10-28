import { useState, type FormEvent } from 'react';
import { DAGEN, api, type Medewerker, type Planning as PlanningData } from '../api';
import { Badge, Leeg, Melding, Systeemstatus, Veld, foutTekst, useLaden } from '../ui';

interface Waarden { naam: string; dagen: number[]; tijden: string[]; maxPogingen: number; employeeIds: string[]; gespreksinstructie: string | null }
const LEEG: Waarden = { naam: '', dagen: [1, 2, 3, 4, 5], tijden: ['09:00'], maxPogingen: 2, employeeIds: [], gespreksinstructie: null };

function Formulier({ start, medewerkers, algemeen, bewaar, annuleer, knop }: {
  start: Waarden; medewerkers: Medewerker[]; algemeen: string; bewaar: (w: Waarden) => Promise<void>; annuleer: () => void; knop: string;
}) {
  const [w, setW] = useState(start);
  const [fout, setFout] = useState<string | null>(null);
  const [suggestie, setSuggestie] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const eigen = w.gespreksinstructie !== null;

  async function vraagSuggestie() {
    setBezig(true); setSuggestie(null);
    try { setSuggestie((await api<{ tekst: string }>('POST', '/plannings/suggestie', { employeeIds: w.employeeIds })).tekst); setFout(null); }
    catch (err) { setFout(foutTekst(err)); } finally { setBezig(false); }
  }
  const zet = <K extends keyof Waarden>(k: K, v: Waarden[K]) => setW((huidig) => ({ ...huidig, [k]: v }));
  const wissel = (lijst: number[], n: number) => (lijst.includes(n) ? lijst.filter((x) => x !== n) : [...lijst, n]);
  async function verstuur(e: FormEvent) {
    e.preventDefault();
    try { await bewaar(w); } catch (err) { setFout(foutTekst(err)); }
  }
  const actieve = medewerkers.filter((m) => m.actief);
  return (
    <form className="paneel stapel" onSubmit={verstuur}>
      <Veld label="Naam van de planning (bijvoorbeeld: dagelijkse update)"><input value={w.naam} onChange={(e) => zet('naam', e.target.value)} maxLength={100} /></Veld>
      <fieldset className="stapel">
        <legend>Dagen</legend>
        <div className="dagen">{DAGEN.map((d, i) => <label key={d}><input type="checkbox" checked={w.dagen.includes(i + 1)} onChange={() => zet('dagen', wissel(w.dagen, i + 1))} />{d}</label>)}</div>
      </fieldset>
      <fieldset className="stapel">
        <legend>Tijden (Nederlandse tijd)</legend>
        <div className="rij">
          {w.tijden.map((t, i) => (
            <span key={i} className="rij" style={{ gap: '.25rem' }}>
              <input type="time" aria-label={`Tijd ${i + 1}`} value={t} required style={{ width: 'auto' }} onChange={(e) => zet('tijden', w.tijden.map((x, j) => (j === i ? e.target.value : x)))} />
              {w.tijden.length > 1 && <button type="button" className="tekstknop gevaar" aria-label={`Tijd ${i + 1} verwijderen`} onClick={() => zet('tijden', w.tijden.filter((_, j) => j !== i))}>✕</button>}
            </span>
          ))}
          {w.tijden.length < 6 && <button type="button" onClick={() => zet('tijden', [...w.tijden, '14:00'])}>Tijd toevoegen</button>}
        </div>
      </fieldset>
      <Veld label="Pogingen als iemand niet opneemt (met 30 minuten ertussen)">
        <select value={w.maxPogingen} onChange={(e) => zet('maxPogingen', Number(e.target.value))} style={{ width: 'auto' }}>
          {[1, 2, 3].map((n) => <option key={n} value={n}>{n === 1 ? '1 poging' : `${n} pogingen`}</option>)}
        </select>
      </Veld>
      <fieldset className="stapel">
        <legend>Wie wordt er gebeld?</legend>
        <div className="rij">
          <button type="button" onClick={() => zet('employeeIds', actieve.map((m) => m.id))}>Iedereen</button>
          <button type="button" onClick={() => zet('employeeIds', [])}>Niemand</button>
        </div>
        <div className="dagen">
          {medewerkers.map((m) => (
            <label key={m.id} style={{ opacity: m.actief ? 1 : .55 }}>
              <input type="checkbox" checked={w.employeeIds.includes(m.id)} onChange={() => zet('employeeIds', w.employeeIds.includes(m.id) ? w.employeeIds.filter((x) => x !== m.id) : [...w.employeeIds, m.id])} />
              {m.naam}{!m.actief && ' (niet actief)'}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="stapel">
        <legend>Gespreksinstructie</legend>
        <div className="rij">
          <label className="rij"><input type="radio" name="instructie" checked={!eigen} onChange={() => zet('gespreksinstructie', null)} style={{ width: 'auto', minHeight: 0 }} />Algemene instructie gebruiken (uit Instellingen)</label>
          <label className="rij"><input type="radio" name="instructie" checked={eigen} onChange={() => zet('gespreksinstructie', w.gespreksinstructie ?? algemeen)} style={{ width: 'auto', minHeight: 0 }} />Eigen instructie voor deze planning</label>
        </div>
        {!eigen && <details><summary className="zacht klein">Bekijk de algemene instructie</summary><p className="zacht klein" style={{ whiteSpace: 'pre-wrap' }}>{algemeen}</p></details>}
        {eigen && <textarea rows={7} aria-label="Eigen gespreksinstructie" value={w.gespreksinstructie ?? ''} onChange={(e) => zet('gespreksinstructie', e.target.value)} maxLength={4000} />}
        <div className="rij">
          <button type="button" onClick={vraagSuggestie} disabled={bezig || !w.employeeIds.length} title={w.employeeIds.length ? '' : 'Kies eerst wie er gebeld wordt'}>{bezig ? 'Bezig…' : 'Suggestie vragen'}</button>
          <span className="zacht klein">Gebaseerd op de onderwerpen van de gekozen personen. Er wordt niets opgeslagen zonder dat je het overneemt.</span>
        </div>
        {suggestie && (
          <div className="paneel stapel" role="region" aria-label="Suggestie">
            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{suggestie}</p>
            <div className="rij">
              <button type="button" className="primair" onClick={() => { zet('gespreksinstructie', suggestie); setSuggestie(null); }}>Overnemen</button>
              <button type="button" onClick={vraagSuggestie} disabled={bezig}>Opnieuw</button>
              <button type="button" className="tekstknop" onClick={() => setSuggestie(null)}>Verwerpen</button>
            </div>
          </div>
        )}
      </fieldset>
      <Melding tekst={fout} />
      <div className="rij"><button className="primair" type="submit" disabled={!w.dagen.length || !w.employeeIds.length}>{knop}</button><button type="button" onClick={annuleer}>Annuleren</button></div>
    </form>
  );
}

export function Planning() {
  const lijst = useLaden(() => api<PlanningData[]>('GET', '/plannings'));
  const medewerkers = useLaden(() => api<Medewerker[]>('GET', '/employees'));
  const algemeen = useLaden(() => api<{ waarde: string }>('GET', '/instellingen/gespreksinstructie'));
  const schakelaar = useLaden(() => api<{ aan: boolean }>('GET', '/instellingen/automatisch-bellen'));
  const [bewerk, setBewerk] = useState<string | 'nieuw' | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const naam = (id: string) => medewerkers.data?.find((m) => m.id === id)?.naam ?? '…';
  const doe = async (f: () => Promise<unknown>) => { try { await f(); setFout(null); lijst.ververs(); } catch (e) { setFout(foutTekst(e)); } };
  const alle = medewerkers.data ?? [];

  return (
    <div className="stapel">
      <Systeemstatus />
      <div className="rij spreid">
        <div><h1>Planning</h1><p className="zacht">Wanneer wie wordt gebeld. Eén planning kan meerdere personen en tijden hebben.</p></div>
        <button className="primair" onClick={() => setBewerk(bewerk === 'nieuw' ? null : 'nieuw')}>{bewerk === 'nieuw' ? 'Annuleren' : 'Nieuwe planning'}</button>
      </div>

      <section className="paneel rij spreid">
        <div>
          <h2 style={{ marginBottom: '.1rem' }}>Automatisch bellen: {schakelaar.data ? (schakelaar.data.aan ? 'aan' : 'uit') : '…'}</h2>
          <span className="zacht klein">Zet je dit uit, dan belt geen enkele planning meer. ‘Bel nu’ blijft werken.</span>
        </div>
        {schakelaar.data && (
          <button className={schakelaar.data.aan ? 'gevaar' : 'primair'} onClick={async () => { await api('PUT', '/instellingen/automatisch-bellen', { aan: !schakelaar.data!.aan }); schakelaar.ververs(); }}>
            {schakelaar.data.aan ? 'Alles stilzetten' : 'Weer aanzetten'}
          </button>
        )}
      </section>

      <Melding tekst={fout ?? lijst.fout} />
      {bewerk === 'nieuw' && <Formulier start={LEEG} medewerkers={alle} algemeen={algemeen.data?.waarde ?? ''} knop="Planning opslaan" annuleer={() => setBewerk(null)}
        bewaar={async (w) => { await api('POST', '/plannings', w); setBewerk(null); lijst.ververs(); }} />}
      {lijst.data?.length === 0 && bewerk !== 'nieuw' && <Leeg>Nog geen planning. Maak er een met ‘Nieuwe planning’.</Leeg>}
      {lijst.data?.map((p) => bewerk === p.id ? (
        <Formulier key={p.id} start={{ naam: p.naam, dagen: p.dagen, tijden: p.tijden, maxPogingen: p.maxPogingen, employeeIds: p.employeeIds, gespreksinstructie: p.gespreksinstructie }} medewerkers={alle} algemeen={algemeen.data?.waarde ?? ''} knop="Wijzigingen opslaan" annuleer={() => setBewerk(null)}
          bewaar={async (w) => { await api('PATCH', `/plannings/${p.id}`, w); setBewerk(null); lijst.ververs(); }} />
      ) : (
        <div key={p.id} className="paneel stapel">
          <div className="rij spreid">
            <div>
              <h3>{p.naam || 'Planning zonder naam'} {!p.actief && <Badge>uit</Badge>} {p.gespreksinstructie && <Badge soort="wacht">eigen instructie</Badge>}</h3>
              <span className="zacht klein">{p.dagen.map((d) => DAGEN[d - 1]).join(' ')} om {p.tijden.join(' en ')} · {p.maxPogingen === 1 ? '1 poging' : `${p.maxPogingen} pogingen`}</span>
            </div>
            <div className="rij">
              <button onClick={() => setBewerk(p.id)}>Bewerken</button>
              <button onClick={() => doe(() => api('PATCH', `/plannings/${p.id}`, { actief: !p.actief }))}>{p.actief ? 'Uitzetten' : 'Aanzetten'}</button>
              <button className="gevaar" onClick={() => { if (confirm(`Planning ‘${p.naam || 'zonder naam'}’ verwijderen? De gespreksgeschiedenis blijft bestaan.`)) void doe(() => api('DELETE', `/plannings/${p.id}`)); }}>Verwijderen</button>
            </div>
          </div>
          <div className="rij">{p.employeeIds.map((id) => <Badge key={id}>{naam(id)}</Badge>)}</div>
        </div>
      ))}
    </div>
  );
}
