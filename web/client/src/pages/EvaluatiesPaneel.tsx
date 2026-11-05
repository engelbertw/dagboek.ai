import { api, datum } from '../api';
import { Leeg, Melding, useLaden } from '../ui';

interface Evaluatie {
  id: string; datum: string; gemeenteNaam: string; contactNaam: string; contactFunctie: string; businessUnit: string;
  scores: { label: string; waarde: number | null }[]; toelichting: { vraag: string; antwoord: string }[]; themas: string; domeinfeedback: string;
}

/** Evaluaties uit iThermometer bij deze gemeente. Alleen voor beheerder en accountmanager: de antwoorden bevatten openhartige klantkritiek. */
export function EvaluatiesPaneel({ klantId }: { klantId: string }) {
  const lijst = useLaden(() => api<Evaluatie[]>('GET', `/klanten/${klantId}/evaluaties`), [klantId]);
  if (lijst.data && lijst.data.length === 0) return null; // geen lege sectie voor gemeenten zonder evaluaties
  return (
    <section className="paneel stapel" aria-label="Evaluaties uit iThermometer">
      <h2>Evaluaties (iThermometer)</h2>
      <Melding tekst={lijst.fout} />
      {!lijst.data && !lijst.fout && <Leeg>Laden...</Leeg>}
      {lijst.data?.map((e) => (
        <details key={e.id} className="stapel">
          <summary>
            <strong>{datum(e.datum)}</strong> · {e.contactNaam || 'Onbekende contactpersoon'}{e.contactFunctie ? `, ${e.contactFunctie}` : ''}{e.businessUnit ? ` · ${e.businessUnit}` : ''}
          </summary>
          <ul className="lijst-kaarten">{e.scores.map((s) => <li key={s.label} className="rij spreid"><span>{s.label}</span><strong>{s.waarde === null ? '-' : `${s.waarde}/10`}</strong></li>)}</ul>
          {e.toelichting.filter((t) => t.antwoord).map((t, i) => (
            <div key={i}>{t.vraag && <h4>{t.vraag}</h4>}<p style={{ whiteSpace: 'pre-line' }}>{t.antwoord}</p></div>
          ))}
          {e.themas && <div><h4>Thema's en dromen</h4><p style={{ whiteSpace: 'pre-line' }}>{e.themas}</p></div>}
          {e.domeinfeedback && <div><h4>Feedback per domein</h4><p style={{ whiteSpace: 'pre-line' }}>{e.domeinfeedback}</p></div>}
        </details>
      ))}
    </section>
  );
}
