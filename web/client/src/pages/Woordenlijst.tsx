import { useEffect, useState } from 'react';
import { api, type Woord, type Woordenlijst as WoordenlijstData, type Woordvoorstel, type WoordToepassing } from '../api';
import { Melding, Veld, foutTekst, useLaden } from '../ui';

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

export function WoordenlijstPagina() {
  const [versie, setVersie] = useState(0); // na goedkeuren van een voorstel opnieuw laden
  return (
    <div className="stapel">
      <div><h1>Woordenlijst</h1><p className="zacht">Producten, afdelingen en namen die de spraakherkenning vaak verkeerd schrijft. Elk gesprek wordt hiermee gecorrigeerd en het taalmodel krijgt de juiste schrijfwijze als hint.</p></div>
      <Woordenlijst key={versie} />
      <Voorstellen naLijst={() => setVersie((v) => v + 1)} />
      <ToepassenOpBestaand />
    </div>
  );
}

