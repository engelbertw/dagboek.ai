import type { Medewerker, Project, TopicStatus, TopicType } from '../api';
import { Veld } from '../ui';

export interface TopicWaarden {
  titel: string; type: TopicType; status: TopicStatus; projectId: string | null; eigenaarId: string | null; aanwijzingen: string;
}
export const LEGE_TOPIC: TopicWaarden = { titel: '', type: 'thema', status: 'actief', projectId: null, eigenaarId: null, aanwijzingen: '' };

export function TopicVelden({ waarden, zet, medewerkers, projecten }: {
  waarden: TopicWaarden; zet: (w: TopicWaarden) => void; medewerkers: Medewerker[]; projecten: Project[];
}) {
  const wijzig = <K extends keyof TopicWaarden>(k: K, v: TopicWaarden[K]) => zet({ ...waarden, [k]: v });
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
    </div>
  );
}
