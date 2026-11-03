import { useEffect, useState, type FormEvent } from 'react';
import { api, MOTOR_LABEL, type DebriefVragen, type Houding, type JiraInstelling, type Motor, type Woord, type Woordenlijst as WoordenlijstData, type Woordvoorstel, type WoordToepassing } from '../api';
import { Melding, Systeemstatus, Veld, foutTekst, useLaden } from '../ui';

function Instelling({ titel, uitleg, label, pad, rijen }: { titel: string; uitleg: string; label: string; pad: string; rijen: number }) {
  const huidig = useLaden(() => api<Houding>('GET', pad));
  const [tekst, setTekst] = useState('');
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  useEffect(() => { if (huidig.data) setTekst(huidig.data.waarde); }, [huidig.data]);

  async function bewaar(waarde: string) {
    try {
      const r = await api<Houding>('PUT', pad, { waarde });
      setTekst(r.waarde);
      setMelding({ tekst: r.standaard ? 'De standaardtekst is teruggezet.' : 'Opgeslagen. Dit geldt vanaf het volgende gesprek.', soort: 'ok' });
      huidig.ververs();
    } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); }
  }
  return (
    <form className="paneel stapel" onSubmit={(e) => { e.preventDefault(); void bewaar(tekst); }}>
      <h2>{titel}</h2>
      <p className="zacht klein">{uitleg}</p>
      <Veld label={label}><textarea rows={rijen} value={tekst} onChange={(e) => setTekst(e.target.value)} maxLength={4000} /></Veld>
      <Melding tekst={melding?.tekst ?? huidig.fout} soort={melding?.soort} />
      <div className="rij">
        <button className="primair" type="submit">Opslaan</button>
        <button type="button" onClick={() => { if (confirm('De standaardtekst terugzetten?')) void bewaar(''); }} disabled={huidig.data?.standaard}>Standaard terugzetten</button>
      </div>
    </form>
  );
}

function Vragenlijst({ titel, uitleg, pad }: { titel: string; uitleg: string; pad: string }) {
  const huidig = useLaden(() => api<DebriefVragen>('GET', pad));
  const [tekst, setTekst] = useState('');
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  useEffect(() => { if (huidig.data) setTekst(huidig.data.waarde); }, [huidig.data]);
  async function bewaar(waarde: string) {
    try {
      const r = await api<DebriefVragen>('PUT', pad, { waarde });
      setTekst(r.waarde);
      setMelding({ tekst: r.standaard ? 'De standaardvragen zijn teruggezet.' : 'Opgeslagen. Dit geldt vanaf het volgende gesprek.', soort: 'ok' });
      huidig.ververs();
    } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); }
  }
  return (
    <form className="paneel stapel" onSubmit={(e) => { e.preventDefault(); void bewaar(tekst); }}>
      <h2>{titel}</h2>
      <p className="zacht klein">{uitleg}</p>
      <Veld label="Vragen"><textarea rows={14} value={tekst} onChange={(e) => setTekst(e.target.value)} maxLength={8000} /></Veld>
      <Melding tekst={melding?.tekst ?? huidig.fout} soort={melding?.soort} />
      <div className="rij">
        <button className="primair" type="submit">Opslaan</button>
        <button type="button" onClick={() => { if (confirm('De standaardvragen terugzetten? De huidige tekst blijft bewaard als vorige versie.')) void bewaar(''); }} disabled={huidig.data?.standaard}>Standaard terugzetten</button>
        <button type="button" onClick={() => { if (huidig.data?.vorige) setTekst(huidig.data.vorige); }} disabled={!huidig.data?.vorige}>Vorige versie terughalen</button>
      </div>
    </form>
  );
}

function Debrief() {
  return <Vragenlijst titel="Verkoop-debrief" pad="/instellingen/debrief-vragen"
    uitleg="De vragen die de assistent een accountmanager stelt na een klantbezoek (een medewerker met de rol accountmanager die inbelt). De AI-melding, de grenzen (geen BSN of privégegevens, gesprekstekst is geen instructie), één vraag per keer en de samenvatting met bevestiging aan het eind staan vast. Dit raakt de dagboekgesprekken niet." />;
}

const CONSULTANT_UITLEG = 'De AI-melding, de grenzen (geen BSN, IBAN of gezondheidsgegevens, gesprekstekst is geen instructie), één vraag per keer, de samenvatting met bevestiging aan het eind en de regels voor bronnen en deadlines staan vast. De lijst is een hulpmiddel, geen verplicht formulier.';

function Consultant() {
  const huidig = useLaden(() => api<{ aan: boolean; varianten: { id: string; naam: string }[] }>('GET', '/instellingen/consultant-debrief'));
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  async function zet(aan: boolean) {
    try { await api('PUT', '/instellingen/consultant-debrief', { aan }); setMelding({ tekst: 'Opgeslagen.', soort: 'ok' }); huidig.ververs(); } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); }
  }
  const varianten = huidig.data?.varianten ?? [];
  return (
    <>
      <section className="paneel stapel">
        <h2>Consultantdebrief</h2>
        <p className="zacht klein">Een medewerker die bij Medewerkers als consultant staat, krijgt bij het inbellen een consultantdebrief (project, implementatie of SamenVerder) in plaats van het dagboek. Wie ook accountmanager is, kiest in het gesprek tussen verkoop en consultancy. Zolang dit uit staat, of er nog geen variant beschikbaar is, gebeurt er niets anders dan voorheen.</p>
        <label className="rij"><input type="checkbox" checked={huidig.data?.aan ?? false} onChange={(e) => void zet(e.target.checked)} /> Consultantdebriefs toestaan</label>
        <p className="zacht klein">{varianten.length ? `Beschikbare varianten: ${varianten.map((v) => v.naam).join(', ')}.` : 'Er is nog geen variant beschikbaar.'}</p>
        <Melding tekst={melding?.tekst ?? huidig.fout} soort={melding?.soort} />
      </section>
      <Vragenlijst titel="Consultantdebrief: algemene lijst" pad="/instellingen/consultant-vragen/algemeen" uitleg={`De vragen die in elke consultantdebrief kunnen terugkomen. ${CONSULTANT_UITLEG}`} />
      {varianten.map((v) => <Vragenlijst key={v.id} titel={`Consultantdebrief: ${v.naam}`} pad={`/instellingen/consultant-vragen/${v.id}`} uitleg={`Aanvullende vragen voor deze variant. ${CONSULTANT_UITLEG}`} />)}
    </>
  );
}

function Gespreksmotor() {
  const huidig = useLaden(() => api<{ motor: Motor }>('GET', '/instellingen/gespreksmotor'));
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  async function kies(motor: Motor) {
    try { await api('PUT', '/instellingen/gespreksmotor', { motor }); setMelding({ tekst: 'Opgeslagen. Dit geldt vanaf het volgende gesprek.', soort: 'ok' }); huidig.ververs(); } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); }
  }
  return (
    <section className="paneel stapel">
      <h2>Gespreksmotor</h2>
      <p className="zacht klein">Pipecat is de huidige pijplijn (spraakherkenning en taalmodel bij T-Systems, stem bij ElevenLabs). De ElevenLabs-agent doet spraakherkenning, taalmodel, beurtwisseling en stem zelf. Bij ‘Bel nu’ kun je per gesprek een andere motor kiezen; beoordeel daarna de gesprekken bij Gesprekken om ze te vergelijken.</p>
      <Veld label="Standaardmotor">
        <select value={huidig.data?.motor ?? 'pipecat'} onChange={(e) => void kies(e.target.value as Motor)}>
          {(Object.keys(MOTOR_LABEL) as Motor[]).map((k) => <option key={k} value={k}>{MOTOR_LABEL[k]}</option>)}
        </select>
      </Veld>
      <Melding tekst={melding?.tekst ?? huidig.fout} soort={melding?.soort} />
    </section>
  );
}

function Inkomend() {
  const huidig = useLaden(() => api<{ aan: boolean }>('GET', '/instellingen/inkomend'));
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  async function zet(aan: boolean) {
    try { await api('PUT', '/instellingen/inkomend', { aan }); setMelding({ tekst: 'Opgeslagen.', soort: 'ok' }); huidig.ververs(); } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); }
  }
  return (
    <section className="paneel stapel">
      <h2>Inbellen</h2>
      <p className="zacht klein">Een medewerker kan zelf het nummer van de ElevenLabs-agent bellen en de update geven. De beller wordt herkend aan het telefoonnummer bij Medewerkers; een onbekend nummer krijgt een korte melding en het gesprek eindigt. Per medewerker maximaal 5 inkomende gesprekken per uur. Het nummer van de beller kan vervalst zijn, dus de assistent noemt alleen de eigen onderwerpen van die medewerker.</p>
      <label className="rij"><input type="checkbox" checked={huidig.data?.aan ?? false} onChange={(e) => void zet(e.target.checked)} /> Inbellen toestaan</label>
      <Melding tekst={melding?.tekst ?? huidig.fout} soort={melding?.soort} />
    </section>
  );
}

function Jira() {
  const huidig = useLaden(() => api<JiraInstelling>('GET', '/instellingen/jira'));
  const [site, setSite] = useState('');
  const [project, setProject] = useState('');
  const [issuetype, setIssuetype] = useState('Task');
  const [teamId, setTeamId] = useState('');
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  useEffect(() => { if (huidig.data) { setSite(huidig.data.site); setProject(huidig.data.project); setIssuetype(huidig.data.issuetype); setTeamId(huidig.data.teamId); } }, [huidig.data]);
  async function bewaar(e: FormEvent) {
    e.preventDefault();
    try { await api('PUT', '/instellingen/jira', { site, project, issuetype, teamId }); setMelding({ tekst: 'Opgeslagen.', soort: 'ok' }); huidig.ververs(); } catch (er) { setMelding({ tekst: foutTekst(er), soort: 'fout' }); }
  }
  async function test() {
    try { const r = await api<{ naam: string; project: string }>('POST', '/instellingen/jira/test'); setMelding({ tekst: `Verbonden als ${r.naam}, project ${r.project}.`, soort: 'ok' }); } catch (er) { setMelding({ tekst: foutTekst(er), soort: 'fout' }); }
  }
  return (
    <form className="paneel stapel" onSubmit={bewaar}>
      <h2>Jira</h2>
      <p className="zacht klein">Van een open punt maak je bij Acties een Jira-ticket, na een voorbeeld en jouw bevestiging. Er gaat alleen de tekst van het punt, het onderwerp, de eigenaar en de deadline naar Jira, geen gesprek of transcript. De inloggegevens staan als <code>JIRA_EMAIL</code> en <code>JIRA_API_TOKEN</code> bij de web-service, niet hier. {huidig.data && !huidig.data.inloggegevens && <strong>Ze ontbreken nu.</strong>}</p>
      <Veld label="Jira-site"><input value={site} onChange={(e) => setSite(e.target.value)} placeholder="naam.atlassian.net" /></Veld>
      <div className="rij">
        <Veld label="Projectsleutel"><input value={project} onChange={(e) => setProject(e.target.value)} placeholder="PROJ" /></Veld>
        <Veld label="Issuetype"><input value={issuetype} onChange={(e) => setIssuetype(e.target.value)} placeholder="Task" /></Veld>
      </div>
      <Veld label="Team-id (optioneel, wordt aan elk ticket gekoppeld)"><input value={teamId} onChange={(e) => setTeamId(e.target.value)} placeholder="a9249ebd-cccb-4d5e-be27-fc98fdc877be" /></Veld>
      <Melding tekst={melding?.tekst ?? huidig.fout} soort={melding?.soort} />
      <div className="rij"><button type="submit" className="primair">Opslaan</button><button type="button" onClick={() => void test()}>Verbinding testen</button></div>
    </form>
  );
}

type WoordRij = { term: string; soort: Woord['soort']; gehoordAls: string; toelichting: string };
const naarRij = (w: Woord): WoordRij => ({ term: w.term, soort: w.soort, gehoordAls: w.gehoordAls.join(', '), toelichting: w.toelichting });
const naarWoord = (r: WoordRij): Woord => ({ term: r.term.trim(), soort: r.soort, gehoordAls: r.gehoordAls.split(/[,\n]/).map((v) => v.trim()).filter(Boolean), toelichting: r.toelichting.trim() });

function Woordenlijst() {
  const huidig = useLaden(() => api<WoordenlijstData>('GET', '/instellingen/woordenlijst'));
  const [rijen, setRijen] = useState<WoordRij[]>([]);
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  useEffect(() => { if (huidig.data) setRijen(huidig.data.items.map(naarRij)); }, [huidig.data]);
  const zet = (i: number, wijziging: Partial<WoordRij>) => setRijen((r) => r.map((x, j) => (j === i ? { ...x, ...wijziging } : x)));
  async function bewaar() {
    try {
      const r = await api<WoordenlijstData>('PUT', '/instellingen/woordenlijst', { items: rijen.filter((x) => x.term.trim()).map(naarWoord) });
      setRijen(r.items.map(naarRij));
      setMelding({ tekst: 'Opgeslagen. Dit geldt vanaf het volgende gesprek en bij opnieuw verwerken.', soort: 'ok' });
      huidig.ververs();
    } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); }
  }
  return (
    <form className="paneel stapel" onSubmit={(e) => { e.preventDefault(); void bewaar(); }}>
      <h2>Woordenlijst</h2>
      <p className="zacht klein">Producten en afdelingen die de spraakherkenning vaak fout verstaat. Zet bij “Ook gehoord als” de verkeerde varianten (kommagescheiden, bijvoorbeeld e-burgerzaken, eburgerzaken); die worden in het transcript door de juiste term vervangen, alleen als heel woord en alleen in wat de beller zei. De lijst gaat ook als hint mee naar het taalmodel dat het verslag schrijft. Een variant is minstens 3 tekens en hoort bij één term. Het bewaarde transcript wordt aangepast; bij opnieuw verwerken geldt de actuele lijst.</p>
      {rijen.map((r, i) => (
        <div key={i} className="rij" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Veld label="Juiste term"><input value={r.term} onChange={(e) => zet(i, { term: e.target.value })} maxLength={100} placeholder="iBurgerzaken" /></Veld>
          <Veld label="Soort">
            <select value={r.soort} onChange={(e) => zet(i, { soort: e.target.value as Woord['soort'] })}>
              <option value="product">Product</option><option value="afdeling">Afdeling</option><option value="persoon">Persoon</option><option value="overig">Overig</option>
            </select>
          </Veld>
          <Veld label="Ook gehoord als"><input value={r.gehoordAls} onChange={(e) => zet(i, { gehoordAls: e.target.value })} placeholder="e-burgerzaken, eburgerzaken" /></Veld>
          <Veld label="Toelichting"><input value={r.toelichting} onChange={(e) => zet(i, { toelichting: e.target.value })} maxLength={200} placeholder="bijv. business unit Proces & Services" /></Veld>
          <button type="button" className="gevaar" onClick={() => setRijen((x) => x.filter((_, j) => j !== i))}>Verwijderen</button>
        </div>
      ))}
      {rijen.length === 0 && <p className="zacht">Nog geen woorden.</p>}
      <Melding tekst={melding?.tekst ?? huidig.fout} soort={melding?.soort} />
      <div className="rij">
        <button type="button" onClick={() => setRijen((r) => [...r, { term: '', soort: 'product', gehoordAls: '', toelichting: '' }])}>+ Woord toevoegen</button>
        <button className="primair" type="submit">Opslaan</button>
        <button type="button" onClick={() => { if (huidig.data?.vorige.length) setRijen(huidig.data.vorige.map(naarRij)); }} disabled={!huidig.data?.vorige.length}>Vorige versie terughalen</button>
      </div>
    </form>
  );
}

const BRON_UITLEG: Record<Woordvoorstel['bron'], string> = { e_voorvoegsel: 'e- voor een productnaam', naam_lijkt_op: 'lijkt op een bekende naam', model: 'voorgesteld door het taalmodel' };

function Voorstellen({ naLijst }: { naLijst: () => void }) {
  const lijst = useLaden(() => api<Woordvoorstel[]>('GET', '/instellingen/woordenlijst/voorstellen'));
  const [termen, setTermen] = useState<Record<string, string>>({});
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  async function besluit(v: Woordvoorstel, b: 'goedkeuren' | 'afwijzen') {
    try {
      await api('POST', `/instellingen/woordenlijst/voorstellen/${v.id}`, { besluit: b, ...(termen[v.id]?.trim() ? { term: termen[v.id].trim() } : {}) });
      setMelding({ tekst: b === 'goedkeuren' ? `“${v.gehoordAls}” staat nu in de woordenlijst. Pas de lijst eventueel toe op bestaande gesprekken.` : 'Voorstel afgewezen; het komt niet terug.', soort: 'ok' });
      lijst.ververs();
      if (b === 'goedkeuren') naLijst();
    } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); }
  }
  const items = lijst.data ?? [];
  if (!items.length && !melding) return null;
  return (
    <section className="paneel stapel">
      <h3>Voorstellen uit gesprekken ({items.length})</h3>
      <p className="zacht klein">Woorden die in gesprekken lijken verkeerd verstaan. Er verandert niets totdat je goedkeurt; je kunt de juiste term nog aanpassen. Een echt woord (bijvoorbeeld eHerkenning) wijs je af en komt dan niet terug.</p>
      {items.map((v) => (
        <div key={v.id} className="rij" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <span><strong>{v.gehoordAls}</strong> <span className="zacht klein">({BRON_UITLEG[v.bron]}, {v.aantal}×)</span> →</span>
          <input aria-label={`Juiste term voor ${v.gehoordAls}`} value={termen[v.id] ?? v.term} onChange={(e) => setTermen({ ...termen, [v.id]: e.target.value })} maxLength={100} />
          <button type="button" className="primair" onClick={() => void besluit(v, 'goedkeuren')}>Goedkeuren</button>
          <button type="button" onClick={() => void besluit(v, 'afwijzen')}>Afwijzen</button>
        </div>
      ))}
      <Melding tekst={melding?.tekst ?? lijst.fout} soort={melding?.soort} />
    </section>
  );
}

function ToepassenOpBestaand() {
  const [voorbeeld, setVoorbeeld] = useState<WoordToepassing | null>(null);
  const [klaar, setKlaar] = useState<WoordToepassing | null>(null);
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  const totaal = (t: WoordToepassing) => t.transcripten + Object.values(t.teksten).reduce((a, b) => a + b, 0);
  async function bekijk() {
    try { setKlaar(null); setMelding(null); setVoorbeeld(await api<WoordToepassing>('POST', '/instellingen/woordenlijst/toepassen', { voorbeeld: true })); } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); }
  }
  async function pasToe() {
    if (!confirm('Dit overschrijft transcripten en verslagen met de gecorrigeerde tekst en is niet terug te draaien. Doorgaan?')) return;
    try { const r = await api<WoordToepassing>('POST', '/instellingen/woordenlijst/toepassen', { voorbeeld: false }); setKlaar(r); setVoorbeeld(null); } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); }
  }
  const overzicht = (t: WoordToepassing) => [`${t.transcripten} transcripten`, ...Object.entries(t.teksten).map(([k, n]) => `${n} ${k}`)].join(', ');
  return (
    <section className="paneel stapel">
      <h3>Toepassen op bestaande gesprekken</h3>
      <p className="zacht klein">Haalt stopwoorden (uh, uhm, eh) uit bewaarde transcripten en zet de woorden uit de lijst goed in transcripten, verslagen, punten en citaten die al bestaan. Bekijk eerst het voorbeeld; toepassen is niet terug te draaien.</p>
      <div className="rij"><button type="button" onClick={() => void bekijk()}>Voorbeeld bekijken</button></div>
      {voorbeeld && (
        <div className="stapel">
          <p>{totaal(voorbeeld) === 0 ? 'Er is niets te wijzigen.' : `Zou wijzigen: ${overzicht(voorbeeld)}.`}</p>
          {voorbeeld.regels.map((r, i) => <p key={i} className="zacht klein"><strong>{r.waar}</strong>: “…{r.voor}…” → “…{r.na}…”</p>)}
          {totaal(voorbeeld) > 0 && <div className="rij"><button type="button" className="gevaar" onClick={() => void pasToe()}>Nu toepassen</button></div>}
        </div>
      )}
      {klaar && <p>Toegepast: {totaal(klaar) === 0 ? 'er was niets te wijzigen' : overzicht(klaar)}.</p>}
      <Melding tekst={melding?.tekst ?? null} soort={melding?.soort} />
    </section>
  );
}

function WoordenlijstBeheer() {
  const [versie, setVersie] = useState(0); // na goedkeuren van een voorstel opnieuw laden
  return (
    <div className="stapel">
      <Woordenlijst key={versie} />
      <Voorstellen naLijst={() => setVersie((v) => v + 1)} />
      <ToepassenOpBestaand />
    </div>
  );
}

export function Instellingen() {
  return (
    <div className="stapel">
      <Systeemstatus />
      <div><h1>Instellingen</h1><p className="zacht">Algemene instellingen voor alle gesprekken. Een planning kan een eigen gespreksinstructie krijgen; zonder eigen instructie geldt de algemene.</p></div>
      <Gespreksmotor />
      <Inkomend />
      <Jira />
      <Debrief />
      <Consultant />
      <WoordenlijstBeheer />
      <Instelling titel="Houding van de assistent" label="Houding" pad="/instellingen/houding" rijen={6}
        uitleg="Zo gedraagt de assistent zich in elk gesprek. De AI-melding, de grenzen en de regel om één vraag per keer te stellen blijven altijd gelden, wat je hier ook invult." />
      <Instelling titel="Algemene gespreksinstructie" label="Gespreksinstructie" pad="/instellingen/gespreksinstructie" rijen={9}
        uitleg="Wat de assistent in een gesprek doet, zoals proactief doorvragen, vervolgacties afspreken en omgaan met gemiste deadlines. Dit geldt voor elke planning zonder eigen instructie en voor ‘Bel nu’. De onderwerpen langslopen en de twee vragen aan het eind (nieuw onderwerp, verbetering) staan vast." />
    </div>
  );
}
