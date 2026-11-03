import { useState } from 'react';
import { api, datumTijd, type AiActiviteit, type AiRegisterStand, type AiVerwerking } from '../api';
import { Badge, Leeg, Melding, useLaden } from '../ui';

const getal = (n: number) => n.toLocaleString('nl-NL');

function Verwerking({ v, naam }: { v: AiVerwerking; naam: (sleutel: string) => string }) {
  const s = v.laatste30Dagen;
  const kort = 'gesprekken' in s ? `${getal(s.gesprekken)} gesprekken in 30 dagen` : `${getal(s.aanroepen)} aanroepen · ${getal(s.tokensIn + s.tokensUit)} tokens${s.fouten ? ` · ${s.fouten} fout${s.fouten === 1 ? '' : 'en'}` : ''}`;
  return (
    <li>
      <details className="ai-verwerking">
        <summary>
          <span className="gebruiker-wie"><strong>{naam(v.sleutel)}</strong><span className="zacht klein">{v.stap}</span></span>
          <span className="gebruiker-meta"><span className="zacht">{kort}</span><span aria-hidden="true" className="zacht">›</span></span>
        </summary>
        <dl className="gegevens">
          <dt>Doel</dt><dd>{v.doel}</dd>
          <dt>Leverancier</dt><dd>{v.leverancier}</dd>
          <dt>Model</dt><dd>{v.model}</dd>
          <dt>Gegevens erin</dt><dd>{v.invoer}</dd>
          <dt>Niet erin</dt><dd>{v.nietIn}</dd>
          <dt>Uitkomst</dt><dd>{v.uitvoer}</dd>
          <dt>Menselijke controle</dt><dd>{v.menselijkeControle}</dd>
          <dt>Bewaartermijn</dt><dd>{v.bewaartermijn}</dd>
          <dt>Bron in de code</dt><dd><code>{v.bron}</code></dd>
        </dl>
      </details>
    </li>
  );
}

export function AiRegister() {
  const stand = useLaden(() => api<AiRegisterStand>('GET', '/ai-register'));
  const [functie, setFunctie] = useState('');
  const [uitkomst, setUitkomst] = useState('');
  const activiteiten = useLaden(() => api<AiActiviteit[]>('GET', `/ai-register/activiteiten?limit=100${functie ? `&functie=${functie}` : ''}${uitkomst ? `&uitkomst=${uitkomst}` : ''}`), [functie, uitkomst]);
  const namen = new Map((stand.data?.verwerkingen ?? []).map((v) => [v.sleutel, v.naam]));
  const naam = (sleutel: string) => namen.get(sleutel) ?? (sleutel === 'overig' ? 'Overig' : sleutel);
  const gelogd = (stand.data?.verwerkingen ?? []).filter((v) => v.gelogd);

  return (
    <div className="stapel">
      <div><h1>AI-register</h1><p className="zacht">Waar dagboek.ai kunstmatige intelligentie voor gebruikt: de verwerkingen en elke aanroep van het taalmodel. Het logboek bevat alleen metadata, nooit gespreksinhoud.</p></div>
      <Melding tekst={stand.fout} />

      {stand.data && (
        <section className="paneel stapel" aria-label="Totalen">
          <h2>Laatste 30 dagen</h2>
          <div className="rij">
            <span><strong>{getal(stand.data.totaal.aanroepen)}</strong> <span className="zacht">aanroepen</span></span>
            <span><strong>{getal(stand.data.totaal.tokens)}</strong> <span className="zacht">tokens</span></span>
            <span><strong>{getal(stand.data.totaal.fouten)}</strong> <span className="zacht">fouten</span></span>
          </div>
        </section>
      )}

      <section className="stapel" aria-label="Verwerkingen">
        <h2>Verwerkingen</h2>
        <ul className="gebruikerslijst">{stand.data?.verwerkingen.map((v) => <Verwerking key={v.sleutel} v={v} naam={naam} />)}</ul>
      </section>

      <section className="stapel" aria-label="Activiteit">
        <h2>Activiteit</h2>
        <div className="rij">
          <label className="rij">Functie
            <select value={functie} onChange={(e) => setFunctie(e.target.value)}>
              <option value="">Alle</option>
              {gelogd.map((v) => <option key={v.sleutel} value={v.sleutel}>{v.naam}</option>)}
              <option value="overig">Overig</option>
            </select>
          </label>
          <label className="rij">Uitkomst
            <select value={uitkomst} onChange={(e) => setUitkomst(e.target.value)}>
              <option value="">Alle</option><option value="ok">Gelukt</option><option value="fout">Fout</option>
            </select>
          </label>
        </div>
        <Melding tekst={activiteiten.fout} />
        {activiteiten.data && activiteiten.data.length === 0 && <Leeg>Nog geen aanroepen vastgelegd.</Leeg>}
        <ul className="gebruikerslijst">
          {activiteiten.data?.map((a) => (
            <li key={a.id}>
              <div className="rij spreid eenheid">
                <span className="gebruiker-wie">
                  <strong>{naam(a.functie)}</strong>
                  <span className="zacht klein">{datumTijd(a.tijdstip)} · {a.model || 'model onbekend'} · {getal(a.tokensIn + a.tokensUit)} tokens · {(a.duurMs / 1000).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} s</span>
                </span>
                <span className="rij">
                  {a.referentie && <span className="zacht klein" title="Verwijzing naar het gesprek (zie Gesprekken)">gesprek {a.referentie.slice(0, 8)}</span>}
                  <Badge soort={a.uitkomst === 'ok' ? 'afgerond' : 'mislukt'}>{a.uitkomst === 'ok' ? 'gelukt' : `fout${a.foutCode ? `: ${a.foutCode}` : ''}`}</Badge>
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
