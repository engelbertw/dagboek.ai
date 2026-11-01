import { useState } from 'react';
import { Link } from 'react-router-dom';
import { IMPLEMENTATIE_FASE_LABEL, TEST_STATUS_LABEL, api, datum, type ConsultancyOverzicht } from '../api';
import { Badge, Leeg, Melding, useLaden } from '../ui';
import { SamenVerder } from './SamenVerder';

type Tab = 'projecten' | 'implementaties' | 'samenverder';

const teller = (n: number, enkel: string, meer: string) => `${n} ${n === 1 ? enkel : meer}`;

/** Het lopende consultancywerk op één plek: alleen feiten en tellingen uit vastgelegde records, zonder scores of rangschikking. */
export function ConsultancyWeergave({ data, alleenLezen, tab, kiesTab }: { data: ConsultancyOverzicht; alleenLezen: boolean; tab: Tab; kiesTab: (t: Tab) => void }) {
  const t = data.tellingen;
  return (
    <div className="stapel">
      <div><h1>Consultancy</h1><p className="zacht">Lopende projecten, module-implementaties en SamenVerder-programma’s. Alles komt uit wat is vastgelegd; er worden geen scores of oordelen afgeleid.</p></div>
      <p>{teller(t.projecten, 'project', 'projecten')} · {teller(t.implementaties, 'implementatie', 'implementaties')} · {teller(t.programmas, 'SamenVerder-programma', 'SamenVerder-programma’s')} · {teller(t.openBlokkades, 'open blokkade of afhankelijkheid', 'open blokkades en afhankelijkheden')} · {teller(t.openVervolgsignalen, 'open vervolgsignaal', 'open vervolgsignalen')}</p>
      <div className="werk-schakelaar" role="group" aria-label="Soort werk">
        <button type="button" aria-pressed={tab === 'projecten'} onClick={() => kiesTab('projecten')}>Projecten</button>
        <button type="button" aria-pressed={tab === 'implementaties'} onClick={() => kiesTab('implementaties')}>Implementaties</button>
        <button type="button" aria-pressed={tab === 'samenverder'} onClick={() => kiesTab('samenverder')}>SamenVerder</button>
      </div>

      {tab === 'projecten' && (data.projecten.length === 0 ? <Leeg>Geen lopende projecten.</Leeg> : (
        <ul className="lijst-kaarten">{data.projecten.map((p) => (
          <li key={p.topicId} className="paneel">
            <Link to={`/onderwerp/${p.topicId}`}><strong>{p.titel}</strong></Link> <Badge soort={p.status === 'wacht' ? 'wacht' : ''}>{p.status === 'wacht' ? 'Wacht' : 'Actief'}</Badge>
            <p className="zacht klein">{p.klantId ? <Link to={`/klanten/${p.klantId}`}>{p.klantNaam}</Link> : 'Geen gemeente'}{p.eigenaarNaam && ` · ${p.eigenaarNaam}`}</p>
            <p>{teller(p.openBlokkades, 'blokkade of afhankelijkheid', 'blokkades en afhankelijkheden')} · {teller(p.openRisicos, 'risico', 'risico’s')}{p.laatsteDebrief ? ` · laatste debrief ${datum(p.laatsteDebrief)}` : ' · nog geen debrief'}</p>
          </li>
        ))}</ul>
      ))}

      {tab === 'implementaties' && (data.implementaties.length === 0 ? <Leeg>Geen lopende implementaties.</Leeg> : (
        <ul className="lijst-kaarten">{data.implementaties.map((i) => (
          <li key={i.topicId} className="paneel">
            <Link to={`/onderwerp/${i.topicId}`}><strong>{i.titel}</strong></Link> <Badge>{IMPLEMENTATIE_FASE_LABEL[i.fase as keyof typeof IMPLEMENTATIE_FASE_LABEL] ?? i.fase}</Badge>
            <p className="zacht klein">{i.klantId ? <Link to={`/klanten/${i.klantId}`}>{i.klantNaam}</Link> : 'Geen gemeente'} · module {i.module} · test: {TEST_STATUS_LABEL[i.testStatus as keyof typeof TEST_STATUS_LABEL] ?? i.testStatus}</p>
            <p>{i.werkelijkeLivegang ? `Live sinds ${datum(i.werkelijkeLivegang)}` : i.geplandeLivegang ? `Livegang gepland op ${datum(i.geplandeLivegang)}` : 'Geen livegang gepland'} · {teller(i.openBlokkades, 'blokkade of afhankelijkheid', 'blokkades en afhankelijkheden')}{i.laatsteDebrief ? ` · laatste debrief ${datum(i.laatsteDebrief)}` : ' · nog geen debrief'}</p>
          </li>
        ))}</ul>
      ))}

      {tab === 'samenverder' && <SamenVerder alleenLezen={alleenLezen} zonderKop />}
    </div>
  );
}

export function Consultancy({ alleenLezen = false }: { alleenLezen?: boolean }) {
  const { data, fout } = useLaden(() => api<ConsultancyOverzicht>('GET', '/consultancy'));
  const [tab, setTab] = useState<Tab>('projecten');
  if (fout) return <Melding tekst={fout} />;
  return data ? <ConsultancyWeergave data={data} alleenLezen={alleenLezen} tab={tab} kiesTab={setTab} /> : null;
}
