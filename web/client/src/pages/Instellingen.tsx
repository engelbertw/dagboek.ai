import { useEffect, useState, type FormEvent } from 'react';
import { api, MOTOR_LABEL, type Houding, type JiraInstelling, type Motor } from '../api';
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

export function Instellingen() {
  return (
    <div className="stapel">
      <Systeemstatus />
      <div><h1>Instellingen</h1><p className="zacht">Algemene instellingen voor alle gesprekken. Een planning kan een eigen gespreksinstructie krijgen; zonder eigen instructie geldt de algemene.</p></div>
      <Gespreksmotor />
      <Jira />
      <Instelling titel="Houding van de assistent" label="Houding" pad="/instellingen/houding" rijen={6}
        uitleg="Zo gedraagt de assistent zich in elk gesprek. De AI-melding, de grenzen en de regel om één vraag per keer te stellen blijven altijd gelden, wat je hier ook invult." />
      <Instelling titel="Algemene gespreksinstructie" label="Gespreksinstructie" pad="/instellingen/gespreksinstructie" rijen={9}
        uitleg="Wat de assistent in een gesprek doet, zoals proactief doorvragen, vervolgacties afspreken en omgaan met gemiste deadlines. Dit geldt voor elke planning zonder eigen instructie en voor ‘Bel nu’. De onderwerpen langslopen en de twee vragen aan het eind (nieuw onderwerp, verbetering) staan vast." />
    </div>
  );
}
