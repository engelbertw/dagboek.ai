import { useState } from 'react';
import { api, type KlantRegel, type Medewerker, type Project, type TopicStatus, type TopicType } from '../api';
import { Melding, Veld, foutTekst } from '../ui';

export interface TopicWaarden {
  titel: string; type: TopicType; status: TopicStatus; projectId: string | null; eigenaarId: string | null; klantId: string | null; aanwijzingen: string;
}
export const LEGE_TOPIC: TopicWaarden = { titel: '', type: 'thema', status: 'actief', projectId: null, eigenaarId: null, klantId: null, aanwijzingen: '' };

export function TopicVelden({ waarden, zet, medewerkers, projecten, klanten }: {
  waarden: TopicWaarden; zet: (w: TopicWaarden) => void; medewerkers: Medewerker[]; projecten: Project[]; klanten: Pick<KlantRegel, 'id' | 'naam'>[];
}) {
  const wijzig = <K extends keyof TopicWaarden>(k: K, v: TopicWaarden[K]) => zet({ ...waarden, [k]: v });
  const [suggestie, setSuggestie] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  async function vraag() {
    setBezig(true); setSuggestie(null);
    try { setSuggestie((await api<{ tekst: string }>('POST', '/topics/suggestie', { titel: waarden.titel, soort: waarden.type, projectId: waarden.projectId })).tekst); setFout(null); }
    catch (e) { setFout(foutTekst(e)); } finally { setBezig(false); }
  }
  return (
    <div className="stapel">
      <Veld label="Titel"><input value={waarden.titel} onChange={(e) => wijzig('titel', e.target.value)} maxLength={200} required /></Veld>
      <div className="raster">
        <Veld label="Soort">
          <select value={waarden.type} onChange={(e) => wijzig('type', e.target.value as TopicType)}>
            <option value="project">Project</option><option value="thema">Thema</option><option value="taak">Taak</option>
          </select>
        </Veld>
        <Veld label="Status">
          <select value={waarden.status} onChange={(e) => wijzig('status', e.target.value as TopicStatus)}>
            <option value="actief">Actief</option><option value="wacht">Wacht</option><option value="afgerond">Afgerond</option>
          </select>
        </Veld>
        <Veld label="Project">
          <select value={waarden.projectId ?? ''} onChange={(e) => wijzig('projectId', e.target.value || null)}>
            <option value="">Geen project</option>
            {projecten.map((p) => <option key={p.id} value={p.id}>{p.naam}</option>)}
          </select>
        </Veld>
        <Veld label="Gemeente (klant)">
          <select value={waarden.klantId ?? ''} onChange={(e) => wijzig('klantId', e.target.value || null)}>
            <option value="">Geen gemeente</option>
            {klanten.map((k) => <option key={k.id} value={k.id}>{k.naam}</option>)}
          </select>
        </Veld>
        <Veld label="Wie bellen we hierover?">
          <select value={waarden.eigenaarId ?? ''} onChange={(e) => wijzig('eigenaarId', e.target.value || null)}>
            <option value="">Niemand</option>
            {medewerkers.filter((m) => m.actief || m.id === waarden.eigenaarId).map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
          </select>
        </Veld>
      </div>
      <Veld label="Wat willen we weten? (bijvoorbeeld: status van offertes, afstemming met klanten en intern)">
        <textarea value={waarden.aanwijzingen} onChange={(e) => wijzig('aanwijzingen', e.target.value)} maxLength={4000} />
      </Veld>
      <div className="rij">
        <button type="button" onClick={vraag} disabled={bezig || !waarden.titel.trim()} title={waarden.titel.trim() ? '' : 'Vul eerst een titel in'}>{bezig ? 'Bezig…' : 'Suggestie vragen'}</button>
        <span className="zacht klein">Een voorstel op basis van de titel en de soort.</span>
      </div>
      <Melding tekst={fout} />
      {suggestie && (
        <div className="paneel stapel" role="region" aria-label="Suggestie">
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{suggestie}</p>
          <div className="rij">
            <button type="button" className="primair" onClick={() => { wijzig('aanwijzingen', waarden.aanwijzingen.trim() ? `${waarden.aanwijzingen.trim()}\n${suggestie}` : suggestie); setSuggestie(null); }}>{waarden.aanwijzingen.trim() ? 'Toevoegen' : 'Overnemen'}</button>
            <button type="button" onClick={vraag} disabled={bezig}>Opnieuw</button>
            <button type="button" className="tekstknop" onClick={() => setSuggestie(null)}>Verwerpen</button>
          </div>
        </div>
      )}
    </div>
  );
}
