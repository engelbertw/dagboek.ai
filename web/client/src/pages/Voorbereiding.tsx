import { Link, useParams } from 'react-router-dom';
import { IMPLEMENTATIE_FASE_LABEL, KLANT_STATUS_LABEL, SOORT_LABEL, TEST_STATUS_LABEL, api, datum, type ActiviteitSoort, type Voorbereiding as VoorbereidingData } from '../api';
import { Badge, Leeg, Melding, useLaden } from '../ui';
import { REDEN } from './ActiviteitenLijst';

const GESPREK_LABEL: Record<VoorbereidingData['gesprekken'][number]['soort'], string> = {
  bezoek: 'Klantbezoek', project: 'Projectdebrief', implementatie: 'Implementatiedebrief', samenverder: 'SamenVerder-debrief', consultant: 'Consultantdebrief',
};
const BRON_LABEL: Record<string, string> = { dagboek: 'dagboek', 'verkoop-debrief': 'verkoop-debrief', 'consultant-debrief': 'consultantdebrief', werkregister: 'werkregister' };
const soortLabel = (s: string) => SOORT_LABEL[s as ActiviteitSoort] ?? s;
const STATUS_LABEL: Record<string, string> = { actief: 'actief', wacht: 'wacht', afgerond: 'afgerond' };

/** Bezoekvoorbereiding: alleen-lezen overzicht van wat er over een gemeente is vastgelegd, met datum en bron. Niets hier is door een taalmodel samengesteld. */
export function Voorbereiding() {
  const { id } = useParams();
  const { data, fout } = useLaden(() => api<VoorbereidingData>('GET', `/klanten/${id}/voorbereiding`), [id]);
  if (fout) return <div className="stapel"><Melding tekst={fout} /><Link to="/klanten">Terug naar klanten</Link></div>;
  return data ? <VoorbereidingWeergave data={data} /> : null;
}

export function VoorbereidingWeergave({ data }: { data: VoorbereidingData }) {
  const { klant } = data;
  const perSoort = new Map<string, VoorbereidingData['openPunten']>();
  for (const p of data.openPunten) perSoort.set(p.soort, [...(perSoort.get(p.soort) ?? []), p]);

  return (
    <div className="stapel voorbereiding">
      <div>
        <Link to={`/klanten/${klant.id}`}>← {klant.naam}</Link>
        <h1>Voorbereiding: {klant.naam} <Badge soort={klant.status === 'voorgesteld' ? 'wacht' : ''}>{KLANT_STATUS_LABEL[klant.status as keyof typeof KLANT_STATUS_LABEL] ?? klant.status}</Badge></h1>
        <p className="subtiel">Samengesteld uit wat er is vastgelegd; bij elk onderdeel staan datum en bron. <button type="button" className="knop-link" onClick={() => window.print()}>Afdrukken</button></p>
      </div>

      <section className="paneel stapel" aria-label="Kerngegevens">
        <h2>Kerngegevens</h2>
        <dl className="gegevens">
          <dt>Accountmanager</dt><dd>{klant.accountmanagerNaam ?? '—'}</dd>
          {klant.samenwerkingsverband && (<><dt>Samenwerkingsverband</dt><dd>{klant.samenwerkingsverband}</dd></>)}
          {klant.inwoners !== null && (<><dt>Inwoners</dt><dd>{klant.inwoners.toLocaleString('nl-NL')}</dd></>)}
          {klant.contractEinde && (<><dt>Contract tot</dt><dd>{datum(klant.contractEinde)}</dd></>)}
        </dl>
        {klant.omschrijving && <p>{klant.omschrijving}</p>}
      </section>

      <details className="paneel" open>
        <summary><h2>Contactpersonen ({data.contacten.length})</h2></summary>
        {data.contacten.length === 0 ? <Leeg>Nog geen contactpersonen vastgelegd.</Leeg> : (
          <ul className="lijst">
            {data.contacten.map((c) => (
              <li key={c.id}><strong>{c.naam}</strong>{[c.functie, c.rol].filter(Boolean).length > 0 && ` — ${[c.functie, c.rol].filter(Boolean).join(', ')}`}
                {c.laatstGesproken && <span className="subtiel"> · laatst gesproken {datum(c.laatstGesproken)}</span>}</li>
            ))}
          </ul>
        )}
      </details>

      <details className="paneel" open>
        <summary><h2>Dagboek per onderwerp ({data.onderwerpen.length})</h2></summary>
        {data.onderwerpen.length === 0 ? <Leeg>Geen onderwerpen bij deze gemeente.</Leeg> : (
          <ul className="lijst">
            {data.onderwerpen.map((o) => (
              <li key={o.id}>
                <Link to={`/onderwerp/${o.id}`}>{o.titel}</Link> <Badge soort={o.status === 'wacht' ? 'wacht' : ''}>{STATUS_LABEL[o.status] ?? o.status}</Badge>
                {o.eigenaarNaam && <span className="subtiel"> · {o.eigenaarNaam}</span>}
                {o.laatsteUpdate
                  ? <p>{o.laatsteUpdate.samenvatting}{o.laatsteUpdate.besluiten && <><br /><em>Besluiten:</em> {o.laatsteUpdate.besluiten}</>}<span className="subtiel"> ({datum(o.laatsteUpdate.datum)}, {BRON_LABEL[o.bron]})</span></p>
                  : <p className="subtiel">Nog geen update.</p>}
              </li>
            ))}
          </ul>
        )}
      </details>

      {data.implementaties.length > 0 && (
        <details className="paneel" open>
          <summary><h2>Implementaties ({data.implementaties.length})</h2></summary>
          <ul className="lijst">
            {data.implementaties.map((i) => (
              <li key={i.topicId}><Link to={`/onderwerp/${i.topicId}`}>{i.titel}</Link> <span className="zacht">· {i.module}</span> <Badge soort={i.status === 'wacht' ? 'wacht' : ''}>{IMPLEMENTATIE_FASE_LABEL[i.fase as keyof typeof IMPLEMENTATIE_FASE_LABEL] ?? i.fase}</Badge>
                <span className="subtiel"> · test: {(TEST_STATUS_LABEL[i.testStatus] ?? i.testStatus).toLowerCase()}{i.geplandeLivegang && ` · livegang gepland ${datum(i.geplandeLivegang)}`}{i.werkelijkeLivegang && ` · live sinds ${datum(i.werkelijkeLivegang)}`} · {BRON_LABEL[i.bron]}</span></li>
            ))}
          </ul>
        </details>
      )}

      {data.samenverder.length > 0 && (
        <details className="paneel" open>
          <summary><h2>SamenVerder ({data.samenverder.length})</h2></summary>
          <ul className="lijst">
            {data.samenverder.map((p) => (
              <li key={p.id}><Link to={`/samenverder/${p.id}`}>{p.pakket || 'Programma'}</Link> <Badge soort={p.status === 'afgerond' ? 'wacht' : ''}>{p.status === 'actief' ? 'Actief' : 'Afgerond'}</Badge>
                <span className="subtiel"> · {datum(p.periodeVan)}{p.periodeTot ? ` – ${datum(p.periodeTot)}` : ' –'} · {p.aantalUitgevoerd} uitgevoerd, {p.aantalGepland} gepland{p.volgendeSessie ? ` · volgende sessie ${datum(p.volgendeSessie)}` : ' · geen volgende sessie gepland'}{p.laatsteSessie && ` · laatste sessie ${datum(p.laatsteSessie)}`} · {BRON_LABEL[p.bron]}</span>
                {p.laatsteSamenvatting && <p>{p.laatsteSamenvatting.tekst}<span className="subtiel"> ({datum(p.laatsteSamenvatting.datum)}, laatste debrief)</span></p>}</li>
            ))}
          </ul>
        </details>
      )}

      <details className="paneel" open>
        <summary><h2>Laatste bezoeken en debriefs ({data.gesprekken.length})</h2></summary>
        {data.gesprekken.length === 0 ? <Leeg>Nog geen bezoeken of debriefs.</Leeg> : (
          <ul className="lijst">
            {data.gesprekken.map((g, i) => (
              <li key={i}><strong>{GESPREK_LABEL[g.soort]}</strong> <span className="subtiel">{datum(g.datum)}{g.door && ` · ${g.door}`} · {BRON_LABEL[g.bron]}</span>
                <p>{g.samenvatting || <span className="subtiel">Geen samenvatting.</span>}</p></li>
            ))}
          </ul>
        )}
      </details>

      <details className="paneel" open>
        <summary><h2>Openstaande punten ({data.openPunten.length})</h2></summary>
        {data.openPunten.length === 0 ? <Leeg>Geen openstaande punten.</Leeg> : [...perSoort.entries()].map(([soort, punten]) => (
          <div key={soort}>
            <h3>{soortLabel(soort)} ({punten.length})</h3>
            <ul className="lijst">
              {punten.map((p) => (
                <li key={p.id}>{p.omschrijving}
                  <span className="subtiel">{p.eigenaar && ` · ${p.eigenaar}`}{p.deadline && ` · uiterlijk ${datum(p.deadline)}`}{p.onderwerp && ` · ${p.onderwerp}`} · {datum(p.datum)}, {BRON_LABEL[p.bron]}</span>
                  {p.teLaat && <> <Badge soort="fout">te laat</Badge></>}</li>
              ))}
            </ul>
          </div>
        ))}
      </details>

      {data.nietBevestigd.length > 0 && (
        <details className="paneel">
          <summary><h2>Niet bevestigd ({data.nietBevestigd.length})</h2></summary>
          <p className="subtiel">Deze punten moeten eerst gecontroleerd worden en zijn hierboven niet meegeteld.</p>
          <ul className="lijst">
            {data.nietBevestigd.map((n, i) => (
              <li key={i}>{n.omschrijving || <span className="subtiel">Geen samenvatting.</span>}
                <span className="subtiel"> · {n.soort === 'debrief' ? 'debrief' : 'punt'}, {datum(n.datum)}, {BRON_LABEL[n.bron]}</span>
                {n.reden && <p className="subtiel">{REDEN[n.reden] ?? n.reden}</p>}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
