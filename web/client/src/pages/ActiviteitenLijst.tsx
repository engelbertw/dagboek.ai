import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SOORT_LABEL, api, deadlineTekst, vandaagIso, type Activiteit, type ActiviteitSoort, type JiraInstelling, type JiraUitkomst, type KlantRegel, type Medewerker } from '../api';
import { Leeg, Melding, foutTekst, useLaden } from '../ui';

/** Gedeelde onderdelen van het werkregister: de regel van één punt, de controle-banner, het toevoegformulier en de indeling per soort. */

export const REDEN: Record<string, string> = {
  mogelijk_afgerond: 'Het model denkt dat dit is afgerond, maar dat is niet aantoonbaar in het gesprek. Bevestig dat het klaar is, of laat het open.',
  bron_niet_te_verifieren: 'Dit staat niet aantoonbaar in het gesprek; een genoemde deadline is weggelaten.',
  klant_niet_herkend: 'De klant is niet herkend of nog niet bevestigd. Koppel de klant of bevestig de voorgestelde klant.',
  eigenaar_onzeker: 'De genoemde eigenaar kwam niet voor in het gesprek.',
};

const JIRA_REDEN: Record<string, string> = { al_in_jira: 'staat al in Jira', afgerond: 'is afgerond', controle_nodig: 'moet eerst gecontroleerd worden', niet_gevonden: 'niet gevonden' };

const DETAIL_LABEL: Record<string, string> = {
  indicatie_bedrag: 'indicatie', fase: 'fase', beslisser: 'beslisser', verwachte_datum: 'verwacht', concurrent: 'concurrent', budget_aanwezig: 'budget', contract: 'contract',
};

/** Soorten waar iemand iets mee moet doen. */
export const TE_DOEN: ActiviteitSoort[] = ['actie', 'afspraak', 'intern'];
export const SOORT_VOLGORDE: ActiviteitSoort[] = ['actie', 'afspraak', 'intern', 'kans', 'risico', 'doel', 'resultaat'];

type Punt = Pick<Activiteit, 'id' | 'soort' | 'omschrijving' | 'status' | 'deadline' | 'createdAt'>;

export const isTeLaat = (a: Pick<Activiteit, 'status' | 'deadline'>, vandaag: string) => a.status === 'open' && !!a.deadline && a.deadline < vandaag;

/** Open voor afgerond, te laat bovenaan, dan op deadline; wat geen deadline heeft komt als laatste. */
export function sorteerPunten<T extends Punt>(punten: T[], vandaag: string): T[] {
  const rang = (a: T) => (a.status === 'afgerond' ? 3 : isTeLaat(a, vandaag) ? 0 : a.deadline ? 1 : 2);
  return [...punten].sort((x, y) => rang(x) - rang(y) || (x.deadline ?? '9999').localeCompare(y.deadline ?? '9999') || y.createdAt.localeCompare(x.createdAt));
}

export const initialen = (naam: string) => naam.split(/\s+/).filter(Boolean).slice(0, 2).map((d) => d[0]?.toUpperCase()).join('');

/** De velden van een kans die zijn genoemd; wat de accountmanager niet wist blijft weg. */
export function Details({ a }: { a: Pick<Activiteit, 'details'> }) {
  const regels = Object.entries(a.details ?? {}).filter(([, v]) => typeof v === 'string' && v).map(([k, v]) => `${DETAIL_LABEL[k] ?? k}: ${v as string}`);
  return <>{regels.map((r) => <span key={r} className="werk-chip">{r}</span>)}</>;
}

export interface Acties {
  fout: string | null; jiraKlaar: boolean;
  zet(a: Pick<Activiteit, 'id' | 'status'>): Promise<void>;
  wijzig(id: string, wijziging: Record<string, unknown>): Promise<boolean>;
  besluit(a: Pick<Activiteit, 'id'>, b: 'goedkeuren' | 'afwijzen'): Promise<void>;
  verwijder(a: Pick<Activiteit, 'id' | 'omschrijving'>): Promise<void>;
  voegToe(waarden: Record<string, unknown>): Promise<boolean>;
  jiraVoorbeeld(ids: string[]): Promise<void>;
  jiraPaneel: ReactNode;
}

/** Alles wat je met een punt kunt doen, met één plek voor de foutmelding. Na elke wijziging wordt de lijst ververst. */
export function useActies(ververs: () => void, punten: Pick<Activiteit, 'id' | 'omschrijving'>[]): Acties {
  const [fout, setFout] = useState<string | null>(null);
  const [jiraMelding, setJiraMelding] = useState<string | null>(null);
  const [voorbeeld, setVoorbeeld] = useState<JiraUitkomst[] | null>(null);
  const jira = useLaden(() => api<JiraInstelling>('GET', '/instellingen/jira'));
  const doe = async (f: () => Promise<unknown>) => {
    try { await f(); setFout(null); ververs(); return true; } catch (e) { setFout(foutTekst(e)); return false; }
  };
  const tekstVan = (id: string) => punten.find((p) => p.id === id)?.omschrijving ?? id;

  async function jiraVoorbeeld(ids: string[]) {
    try {
      const r = await api<{ resultaat: JiraUitkomst[] }>('POST', '/activiteiten/jira', { ids, voorbeeld: true });
      setFout(null); setJiraMelding(null); setVoorbeeld(r.resultaat);
    } catch (e) { setFout(foutTekst(e)); }
  }
  async function jiraMaken() {
    if (!voorbeeld) return;
    const ids = voorbeeld.filter((u) => u.status === 'voorbeeld').map((u) => u.id);
    try {
      const r = await api<{ resultaat: JiraUitkomst[] }>('POST', '/activiteiten/jira', { ids });
      const gelukt = r.resultaat.filter((u) => u.sleutel && (u.status === 'aangemaakt' || u.status === 'gekoppeld')).length;
      const mislukt = r.resultaat.filter((u) => u.status === 'fout');
      setJiraMelding(`${gelukt} ticket${gelukt === 1 ? '' : 's'} in Jira.${mislukt.length ? ` ${mislukt.length} mislukt: ${mislukt[0].reden}` : ''}`);
      setVoorbeeld(null); ververs();
    } catch (e) { setFout(foutTekst(e)); }
  }

  const jiraPaneel = (voorbeeld || jiraMelding) ? (
    <>
      {jiraMelding && <Melding tekst={jiraMelding} soort="ok" />}
      {voorbeeld && (
        <section className="paneel stapel" aria-label="Voorbeeld Jira">
          <h2>Dit gaat naar Jira ({voorbeeld.filter((u) => u.status === 'voorbeeld').length})</h2>
          <p className="zacht klein">Alleen de tekst van het punt, het onderwerp, de eigenaar en de deadline. Er gaat niets naar Jira voordat je bevestigt.</p>
          <ul className="werk-lijst">
            {voorbeeld.map((u) => (
              <li key={u.id} className="werk-regel">
                <div className="werk-inhoud">
                  <p className="werk-tekst">{u.status === 'voorbeeld' ? u.samenvatting : tekstVan(u.id)}</p>
                  <p className="werk-meta">
                    {u.status === 'voorbeeld'
                      ? <span>Project {u.project} · {u.eigenaar ?? 'geen eigenaar'} · {deadlineTekst(u.deadline ?? null)}</span>
                      : <span>overgeslagen: {JIRA_REDEN[u.reden ?? ''] ?? u.reden}</span>}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <div className="rij">
            <button type="button" className="primair" disabled={!voorbeeld.some((u) => u.status === 'voorbeeld')} onClick={() => void jiraMaken()}>Maak tickets aan</button>
            <button type="button" onClick={() => setVoorbeeld(null)}>Annuleren</button>
          </div>
        </section>
      )}
    </>
  ) : null;

  return {
    fout, jiraKlaar: !!jira.data?.geconfigureerd, jiraPaneel, jiraVoorbeeld,
    zet: async (a) => { await doe(() => api('PATCH', `/activiteiten/${a.id}`, { status: a.status === 'open' ? 'afgerond' : 'open' })); },
    wijzig: (id, wijziging) => doe(() => api('PATCH', `/activiteiten/${id}`, wijziging)),
    besluit: async (a, b) => { await doe(() => api('POST', `/activiteiten/${a.id}/controle`, { besluit: b })); },
    verwijder: async (a) => { if (confirm(`Dit punt verwijderen?\n\n${a.omschrijving}`)) await doe(() => api('DELETE', `/activiteiten/${a.id}`)); },
    voegToe: (waarden) => doe(() => api('POST', '/activiteiten', waarden)),
  };
}

function Eigenaar({ a }: { a: Pick<Activiteit, 'eigenaarNaam' | 'eigenaarExtern'> }) {
  const naam = a.eigenaarNaam ?? (a.eigenaarExtern ? `${a.eigenaarExtern} (extern)` : '');
  if (!naam) return <span className="werk-eigenaar leeg-eigenaar">Geen eigenaar</span>;
  return <span className="werk-eigenaar"><span className="werk-initialen" aria-hidden="true">{initialen(a.eigenaarNaam ?? a.eigenaarExtern)}</span><span className="werk-eigenaar-naam">{naam}</span></span>;
}

export function Regel({ a, acties, medewerkers, vandaag, toonKlant = false }: { a: Activiteit; acties: Acties; medewerkers: Medewerker[]; vandaag: string; toonKlant?: boolean }) {
  const [bewerk, setBewerk] = useState(false);
  const [waarden, setWaarden] = useState({ omschrijving: a.omschrijving, eigenaarId: a.eigenaarId ?? '', deadline: a.deadline ?? '' });
  const menu = useRef<HTMLDetailsElement>(null);
  const teLaat = isTeLaat(a, vandaag);
  const klaar = a.status === 'afgerond';
  const sluitMenu = () => { if (menu.current) menu.current.open = false; };
  const doeActie = (f: () => Promise<unknown>) => () => { sluitMenu(); void f(); };

  async function bewaar(e: FormEvent) {
    e.preventDefault();
    const ok = await acties.wijzig(a.id, { omschrijving: waarden.omschrijving, eigenaarId: waarden.eigenaarId || null, deadline: waarden.deadline || null });
    if (ok) setBewerk(false);
  }

  if (bewerk) {
    return (
      <li className="werk-regel">
        <form className="werk-bewerk" onSubmit={(e) => void bewaar(e)}>
          <input value={waarden.omschrijving} onChange={(e) => setWaarden({ ...waarden, omschrijving: e.target.value })} maxLength={500} required aria-label="Omschrijving" />
          <select value={waarden.eigenaarId} onChange={(e) => setWaarden({ ...waarden, eigenaarId: e.target.value })} aria-label="Eigenaar">
            <option value="">{a.eigenaarExtern ? `${a.eigenaarExtern} (buiten het team)` : 'Geen eigenaar'}</option>
            {medewerkers.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
          </select>
          <input type="date" value={waarden.deadline} onChange={(e) => setWaarden({ ...waarden, deadline: e.target.value })} aria-label="Deadline" />
          <button className="primair" type="submit">Opslaan</button>
          <button type="button" onClick={() => setBewerk(false)}>Annuleren</button>
        </form>
      </li>
    );
  }

  return (
    <li className={`werk-regel${klaar ? ' klaar' : ''}`}>
      <input type="checkbox" className="werk-vink" checked={klaar} onChange={() => void acties.zet(a)} aria-label={`Afgerond: ${a.omschrijving}`} />
      <div className="werk-inhoud">
        <p className="werk-tekst">{a.omschrijving}</p>
        <p className="werk-meta">
          <span className={`werk-soort ${a.soort}`}>{SOORT_LABEL[a.soort]}</span>
          {(TE_DOEN.includes(a.soort) || a.eigenaarId || a.eigenaarExtern) && <Eigenaar a={a} />}
          {a.deadline && <span className={`werk-deadline${teLaat ? ' te-laat' : ''}`}>{teLaat ? 'Te laat · ' : ''}{deadlineTekst(a.deadline)}</span>}
          <Details a={a} />
          {toonKlant && (a.klantId ? <Link to={`/klanten/${a.klantId}`}>{a.klantNaam}</Link> : null)}
          {a.topicId && <Link to={`/onderwerp/${a.topicId}`}>{a.topicTitel}</Link>}
          {a.jiraSleutel && (a.jiraUrl?.startsWith('https://') ? <a href={a.jiraUrl} target="_blank" rel="noreferrer">{a.jiraSleutel}</a> : <span>{a.jiraSleutel}</span>)}
        </p>
      </div>
      <details className="werk-menu" ref={menu}>
        <summary aria-label={`Meer acties voor: ${a.omschrijving}`}>⋯</summary>
        <div className="werk-menu-lijst">
          <button type="button" onClick={doeActie(async () => setBewerk(true))}>Bewerken</button>
          {acties.jiraKlaar && !klaar && !a.jiraSleutel && <button type="button" onClick={doeActie(() => acties.jiraVoorbeeld([a.id]))}>Naar Jira…</button>}
          <button type="button" className="gevaar" onClick={doeActie(() => acties.verwijder(a))}>Verwijderen</button>
        </div>
      </details>
    </li>
  );
}

export function Punten({ punten, acties, medewerkers, toonKlant, leeg = 'Geen punten.' }: { punten: Activiteit[]; acties: Acties; medewerkers: Medewerker[]; toonKlant?: boolean; leeg?: string }) {
  const vandaag = vandaagIso();
  if (!punten.length) return <Leeg>{leeg}</Leeg>;
  return <ul className="werk-lijst">{sorteerPunten(punten, vandaag).map((a) => <Regel key={a.id} a={a} acties={acties} medewerkers={medewerkers} vandaag={vandaag} toonKlant={toonKlant} />)}</ul>;
}

/** De punten van één klant, gesorteerd op nut: eerst wat gedaan moet worden, dan kansen en risico's, en ingeklapt de context. */
export function Secties({ punten, acties, medewerkers }: { punten: Activiteit[]; acties: Acties; medewerkers: Medewerker[] }) {
  const van = (soorten: ActiviteitSoort[]) => punten.filter((p) => soorten.includes(p.soort));
  const blokken: { titel: string; soorten: ActiviteitSoort[]; ingeklapt?: boolean }[] = [
    { titel: 'Te doen', soorten: TE_DOEN }, { titel: 'Kansen', soorten: ['kans'] }, { titel: 'Risico’s', soorten: ['risico'] },
    { titel: 'Context', soorten: ['doel', 'resultaat'], ingeklapt: true },
  ];
  return (
    <div className="werk-secties">
      {blokken.map((b) => {
        const lijst = van(b.soorten);
        if (!lijst.length) return null;
        const inhoud = <Punten punten={lijst} acties={acties} medewerkers={medewerkers} />;
        return b.ingeklapt
          ? <details key={b.titel} className="werk-sectie"><summary>{b.titel} <span className="zacht">({lijst.length})</span></summary>{inhoud}</details>
          : <section key={b.titel} className="werk-sectie"><h3>{b.titel} <span className="zacht">({lijst.length})</span></h3>{inhoud}</section>;
      })}
    </div>
  );
}

/** Punten die niet te onderbouwen waren en op een besluit wachten. */
export function ControleBanner({ punten, acties }: { punten: Activiteit[]; acties: Acties }) {
  if (!punten.length) return null;
  return (
    <details className="werk-controle" open>
      <summary><strong>Controle nodig ({punten.length})</strong> <span className="zacht klein">Deze punten tellen pas mee na jouw besluit.</span></summary>
      <ul className="werk-lijst">
        {punten.map((a) => (
          <li key={a.id} className="werk-regel">
            <div className="werk-inhoud">
              <p className="werk-tekst">{a.omschrijving}</p>
              <p className="werk-meta">
                <span className={`werk-soort ${a.soort}`}>{SOORT_LABEL[a.soort]}</span>
                {a.klantId ? <Link to={`/klanten/${a.klantId}`}>{a.klantNaam}</Link> : a.topicId ? <Link to={`/onderwerp/${a.topicId}`}>{a.topicTitel}</Link> : <span>klant onbekend</span>}
                <Details a={a} />
              </p>
              <p className="werk-meta"><span>{REDEN[a.controleReden ?? ''] ?? a.controleReden ?? 'Controle nodig'}</span></p>
            </div>
            <div className="werk-controle-knoppen">
              <button type="button" className="primair" onClick={() => void acties.besluit(a, 'goedkeuren')}>{a.controleReden === 'mogelijk_afgerond' ? 'Afgerond' : 'Klopt'}</button>
              <button type="button" onClick={() => void acties.besluit(a, 'afwijzen')}>{a.controleReden === 'mogelijk_afgerond' ? 'Nog open' : 'Verwijderen'}</button>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Handmatig een punt toevoegen. `vast` legt de klant en/of het onderwerp vast (op de klantkaart en de onderwerppagina). */
export function PuntToevoegen({ acties, medewerkers, klanten = [], vast = {}, standaardSoort = 'intern' }: {
  acties: Acties; medewerkers: Medewerker[]; klanten?: Pick<KlantRegel, 'id' | 'naam'>[]; vast?: { klantId?: string; topicId?: string }; standaardSoort?: ActiviteitSoort;
}) {
  const leeg = { omschrijving: '', soort: standaardSoort, klantId: '', eigenaarId: '', deadline: '' };
  const [open, setOpen] = useState(false);
  const [w, setW] = useState(leeg);
  async function verstuur(e: FormEvent) {
    e.preventDefault();
    const ok = await acties.voegToe({
      omschrijving: w.omschrijving, soort: w.soort, ...((vast.klantId ?? w.klantId) ? { klantId: vast.klantId ?? w.klantId } : {}), ...(vast.topicId ? { topicId: vast.topicId } : {}),
      ...(w.eigenaarId ? { eigenaarId: w.eigenaarId } : {}), deadline: w.deadline || null,
    });
    if (ok) { setW(leeg); setOpen(false); }
  }
  if (!open) return <div><button type="button" onClick={() => setOpen(true)}>+ Punt toevoegen</button></div>;
  return (
    <form className="werk-toevoegen" onSubmit={(e) => void verstuur(e)} aria-label="Punt toevoegen">
      <input value={w.omschrijving} onChange={(e) => setW({ ...w, omschrijving: e.target.value })} placeholder="Wat moet er gebeuren?" aria-label="Omschrijving" maxLength={500} required autoFocus />
      <select value={w.soort} onChange={(e) => setW({ ...w, soort: e.target.value as ActiviteitSoort })} aria-label="Soort">
        {SOORT_VOLGORDE.map((s) => <option key={s} value={s}>{SOORT_LABEL[s]}</option>)}
      </select>
      {!vast.klantId && klanten.length > 0 && (
        <select value={w.klantId} onChange={(e) => setW({ ...w, klantId: e.target.value })} aria-label="Klant">
          <option value="">Zonder klant</option>
          {klanten.map((k) => <option key={k.id} value={k.id}>{k.naam}</option>)}
        </select>
      )}
      <select value={w.eigenaarId} onChange={(e) => setW({ ...w, eigenaarId: e.target.value })} aria-label="Eigenaar">
        <option value="">{vast.topicId ? 'Eigenaar van het onderwerp' : 'Geen eigenaar'}</option>
        {medewerkers.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
      </select>
      <input type="date" value={w.deadline} onChange={(e) => setW({ ...w, deadline: e.target.value })} aria-label="Deadline" />
      <button type="submit" className="primair">Toevoegen</button>
      <button type="button" onClick={() => setOpen(false)}>Annuleren</button>
    </form>
  );
}
