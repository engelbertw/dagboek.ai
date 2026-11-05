import { useEffect, useState, type FormEvent } from 'react';
import { api, MOTOR_LABEL, type DebriefVragen, type Houding, type JiraInstelling, type Motor } from '../api';
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


type BegroetingVeld = 'aanloopInkomend' | 'aanloopUitgaand' | 'opening' | 'openingUitgaand';
type BegroetingTekst = Partial<Record<BegroetingVeld, string>>;
interface BegroetingData { waarde: Record<string, BegroetingTekst>; standaard: Record<string, BegroetingTekst> }
const BEGROETING_TYPES: { id: string; naam: string; velden: { veld: BegroetingVeld; label: string }[] }[] = [
  { id: 'dagboek', naam: 'Dagboek', velden: [
    { veld: 'aanloopInkomend', label: 'Aanloopzin als de medewerker belt' }, { veld: 'aanloopUitgaand', label: 'Aanloopzin als de assistent belt' },
    { veld: 'opening', label: 'Openingsvraag als de medewerker belt' }, { veld: 'openingUitgaand', label: 'Openingsvraag als de assistent belt' }] },
  { id: 'verkoop_debrief', naam: 'Verkoop-debrief', velden: [
    { veld: 'aanloopInkomend', label: 'Aanloopzin als de medewerker belt' }, { veld: 'aanloopUitgaand', label: 'Aanloopzin als de assistent belt' }, { veld: 'opening', label: 'Openingsvraag' }] },
  { id: 'consultant_debrief', naam: 'Consultantdebrief', velden: [{ veld: 'aanloopInkomend', label: 'Aanloopzin als de medewerker belt' }, { veld: 'aanloopUitgaand', label: 'Aanloopzin als de assistent belt' }] },
  { id: 'debrief_keuze', naam: 'Debrief met keuze (accountmanager en consultant)', velden: [{ veld: 'aanloopInkomend', label: 'Aanloopzin als de medewerker belt' }, { veld: 'aanloopUitgaand', label: 'Aanloopzin als de assistent belt' }] },
];

function Begroeting() {
  const huidig = useLaden(() => api<BegroetingData>('GET', '/instellingen/begroeting'));
  const [tekst, setTekst] = useState<Record<string, BegroetingTekst>>({});
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  useEffect(() => { if (huidig.data) setTekst(huidig.data.waarde); }, [huidig.data]);
  const standaard = huidig.data?.standaard ?? {};
  const wijzig = (type: string, veld: BegroetingVeld, waarde: string) => setTekst((t) => ({ ...t, [type]: { ...t[type], [veld]: waarde } }));

  async function bewaar(waarde: Record<string, BegroetingTekst>) {
    try {
      const r = await api<BegroetingData>('PUT', '/instellingen/begroeting', { waarde });
      setTekst(r.waarde); setMelding({ tekst: 'Opgeslagen. Dit geldt vanaf het volgende gesprek.', soort: 'ok' }); huidig.ververs();
    } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); }
  }
  return (
    <form className="paneel stapel" onSubmit={(e: FormEvent) => { e.preventDefault(); void bewaar(tekst); }}>
      <h2>Begroeting</h2>
      <p className="zacht klein">Zo begint de assistent het gesprek: groet, AI-melding, aanloopzin, eventueel de toestemmingsvraag en dan de openingsvraag. Je past hier de aanloopzin en de openingsvraag aan. De groet, de AI-melding en de toestemmingsvraag staan vast, want die zijn verplicht. De openingsvraag wordt pas gesteld nadat de medewerker toestemming heeft gegeven (of die al eerder gaf). Laat je een veld leeg, dan geldt de standaardtekst die erin staat als voorbeeld. Houd het kort: maximaal 200 tekens per tekst, één regel.</p>
      {BEGROETING_TYPES.map((t) => (
        <fieldset key={t.id} className="stapel">
          <legend><strong>{t.naam}</strong></legend>
          {t.velden.map(({ veld, label }) => (
            <Veld key={veld} label={label}>
              <input value={tekst[t.id]?.[veld] ?? ''} maxLength={200} placeholder={standaard[t.id]?.[veld] || '(standaard: geen aanloopzin)'} onChange={(e) => wijzig(t.id, veld, e.target.value)} />
            </Veld>
          ))}
          {(t.id === 'consultant_debrief' || t.id === 'debrief_keuze') && <p className="zacht klein">De openingsvraag hangt hier af van de gekozen variant of het planningsvoorstel en is daarom niet aanpasbaar.</p>}
        </fieldset>
      ))}
      <Melding tekst={melding?.tekst ?? huidig.fout} soort={melding?.soort} />
      <div className="rij">
        <button className="primair" type="submit">Opslaan</button>
        <button type="button" disabled={!Object.keys(huidig.data?.waarde ?? {}).length} onClick={() => { if (confirm('Alle begroetingen terugzetten naar de standaard?')) void bewaar({}); }}>Standaard terugzetten</button>
      </div>
    </form>
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
      <Begroeting />
      <Debrief />
      <Consultant />
      <Instelling titel="Houding van de assistent" label="Houding" pad="/instellingen/houding" rijen={6}
        uitleg="Zo gedraagt de assistent zich in elk gesprek. De AI-melding, de grenzen en de regel om één vraag per keer te stellen blijven altijd gelden, wat je hier ook invult." />
      <Instelling titel="Algemene gespreksinstructie" label="Gespreksinstructie" pad="/instellingen/gespreksinstructie" rijen={9}
        uitleg="Wat de assistent in een gesprek doet, zoals proactief doorvragen, vervolgacties afspreken en omgaan met gemiste deadlines. Dit geldt voor elke planning zonder eigen instructie en voor ‘Bel nu’. De onderwerpen langslopen en de twee vragen aan het eind (nieuw onderwerp, verbetering) staan vast." />
    </div>
  );
}
