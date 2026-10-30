import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SOORT_LABEL, api, deadlineTekst, vandaagIso, type Activiteit, type ActiviteitSoort, type KlantRegel, type Medewerker } from '../api';
import { Leeg, Melding, useLaden } from '../ui';
import { ControleBanner, Punten, PuntToevoegen, SOORT_VOLGORDE, Secties, TE_DOEN, isTeLaat, useActies } from './ActiviteitenLijst';

type Weergave = 'klant' | 'alle';
type Status = 'open' | 'afgerond' | 'alle';

interface Groep { sleutel: string; klantId: string | null; naam: string; punten: Activiteit[]; open: number; teLaat: number; eerste: string | null }

export function Werk() {
  const lijst = useLaden(() => api<Activiteit[]>('GET', '/activiteiten'));
  const klanten = useLaden(() => api<KlantRegel[]>('GET', '/klanten'));
  const medewerkers = useLaden(() => api<Medewerker[]>('GET', '/employees'));
  const alle = useMemo(() => lijst.data ?? [], [lijst.data]);
  const acties = useActies(lijst.ververs, alle);
  const [weergave, setWeergave] = useState<Weergave>('klant');
  const [status, setStatus] = useState<Status>('open');
  const [alleenTeLaat, setAlleenTeLaat] = useState(false);
  const [soorten, setSoorten] = useState<ActiviteitSoort[]>([]);
  const [eigenaar, setEigenaar] = useState('');
  const [zoek, setZoek] = useState('');
  const [uitgeklapt, setUitgeklapt] = useState<Record<string, boolean>>({});
  const vandaag = vandaagIso();

  const teControleren = alle.filter((a) => a.controleNodig);
  const vast = alle.filter((a) => !a.controleNodig);
  const stand = { open: vast.filter((a) => a.status === 'open').length, teLaat: vast.filter((a) => isTeLaat(a, vandaag)).length };
  const q = zoek.trim().toLowerCase();
  const zichtbaar = vast.filter((a) => (status === 'alle' || a.status === status) && (!alleenTeLaat || isTeLaat(a, vandaag))
    && (!soorten.length || soorten.includes(a.soort)) && (!eigenaar || a.eigenaarId === eigenaar)
    && (!q || `${a.omschrijving} ${a.klantNaam ?? ''} ${a.topicTitel ?? ''}`.toLowerCase().includes(q)));

  const groepen = useMemo<Groep[]>(() => {
    const per = new Map<string, Activiteit[]>();
    for (const a of zichtbaar) per.set(a.klantId ?? '', [...(per.get(a.klantId ?? '') ?? []), a]);
    return [...per.entries()].map(([sleutel, punten]) => {
      const open = punten.filter((p) => p.status === 'open' && TE_DOEN.includes(p.soort));
      const deadlines = open.map((p) => p.deadline).filter((d): d is string => !!d).sort();
      return {
        sleutel, klantId: sleutel || null, naam: sleutel ? (punten[0].klantNaam ?? 'Onbekende klant') : 'Intern / zonder klant', punten, open: open.length,
        teLaat: open.filter((p) => isTeLaat(p, vandaag)).length, eerste: deadlines[0] ?? null,
      };
    }).sort((x, y) => (x.klantId === null ? 1 : 0) - (y.klantId === null ? 1 : 0) || y.teLaat - x.teLaat || (x.eerste ?? '9999').localeCompare(y.eerste ?? '9999') || x.naam.localeCompare(y.naam));
  }, [zichtbaar, vandaag]);

  const bezoekVan = (id: string | null) => klanten.data?.find((k) => k.id === id)?.laatsteBezoek ?? null;
  const naarJira = zichtbaar.filter((a) => a.status === 'open' && !a.jiraSleutel && TE_DOEN.includes(a.soort));
  const wisselSoort = (s: ActiviteitSoort) => setSoorten((huidig) => (huidig.includes(s) ? huidig.filter((x) => x !== s) : [...huidig, s]));
  const kiesStand = (open: boolean, laat: boolean) => { setStatus(open ? 'open' : 'alle'); setAlleenTeLaat(laat); };

  return (
    <div className="stapel">
      <div><h1>Werk</h1><p className="zacht">Alles wat gedaan of bijgehouden moet worden, per klant: acties, afspraken, interne acties, kansen en risico’s.</p></div>

      <div className="werk-stand" role="group" aria-label="Stand">
        <button type="button" aria-pressed={status === 'open' && !alleenTeLaat} onClick={() => kiesStand(true, false)}><strong>{stand.open}</strong> Open</button>
        <button type="button" className="laat" aria-pressed={alleenTeLaat} onClick={() => kiesStand(true, true)}><strong>{stand.teLaat}</strong> Te laat</button>
        {teControleren.length > 0 && (
          <button type="button" className="controle" onClick={() => document.getElementById('werk-controle')?.scrollIntoView({ behavior: 'smooth' })}>
            <strong>{teControleren.length}</strong> Controle nodig
          </button>
        )}
      </div>

      <div className="werk-filters">
        <div className="werk-schakelaar" role="group" aria-label="Weergave">
          <button type="button" aria-pressed={weergave === 'klant'} onClick={() => setWeergave('klant')}>Per klant</button>
          <button type="button" aria-pressed={weergave === 'alle'} onClick={() => setWeergave('alle')}>Alle punten</button>
        </div>
        <input type="search" value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Zoek op tekst of klant" aria-label="Zoeken" />
        <select value={eigenaar} onChange={(e) => setEigenaar(e.target.value)} aria-label="Eigenaar">
          <option value="">Alle eigenaren</option>
          {medewerkers.data?.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Status">
          <option value="open">Open</option><option value="afgerond">Afgerond</option><option value="alle">Alle</option>
        </select>
      </div>
      <div className="werk-soorten" role="group" aria-label="Soort">
        {SOORT_VOLGORDE.map((s) => <button key={s} type="button" className={`werk-soort ${s}`} aria-pressed={soorten.includes(s)} onClick={() => wisselSoort(s)}>{SOORT_LABEL[s]}</button>)}
      </div>

      <Melding tekst={acties.fout ?? lijst.fout} />
      {acties.jiraPaneel}
      <div id="werk-controle"><ControleBanner punten={teControleren} acties={acties} /></div>

      <PuntToevoegen acties={acties} medewerkers={medewerkers.data ?? []} klanten={klanten.data ?? []} />
      {acties.jiraKlaar && naarJira.length > 0 && !acties.jiraPaneel && (
        <div><button type="button" onClick={() => void acties.jiraVoorbeeld(naarJira.map((a) => a.id))}>Alle {naarJira.length} zichtbare open punten naar Jira…</button></div>
      )}

      {weergave === 'alle' ? (
        <section className="paneel"><Punten punten={zichtbaar} acties={acties} medewerkers={medewerkers.data ?? []} toonKlant leeg="Niets gevonden." /></section>
      ) : (
        <div className="stapel">
          {groepen.length === 0 && <section className="paneel"><Leeg>Niets gevonden.</Leeg></section>}
          {groepen.map((g, i) => {
            const open = uitgeklapt[g.sleutel] ?? (g.teLaat > 0 || i < 3 || !!q);
            const bezoek = bezoekVan(g.klantId);
            return (
              <details key={g.sleutel} className="paneel werk-klant" open={open} onToggle={(e) => { const nu = (e.currentTarget as HTMLDetailsElement).open; if (nu !== open) setUitgeklapt((u) => ({ ...u, [g.sleutel]: nu })); }}>
                <summary>
                  <span className="werk-klant-naam">{g.klantId ? <Link to={`/klanten/${g.klantId}`} onClick={(e) => e.stopPropagation()}>{g.naam}</Link> : g.naam}</span>
                  <span className="werk-klant-meta">
                    <span>{g.open} open</span>
                    {g.teLaat > 0 && <span className="werk-deadline te-laat">{g.teLaat} te laat</span>}
                    {g.eerste && <span>eerste deadline {deadlineTekst(g.eerste)}</span>}
                    {bezoek && <span>laatste bezoek {deadlineTekst(bezoek)}</span>}
                  </span>
                </summary>
                <Secties punten={g.punten} acties={acties} medewerkers={medewerkers.data ?? []} />
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
