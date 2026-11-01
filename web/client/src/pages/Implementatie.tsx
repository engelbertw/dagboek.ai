import { useEffect, useState, type FormEvent } from 'react';
import { IMPLEMENTATIE_FASEN, IMPLEMENTATIE_FASE_LABEL, TEST_STATUS_LABEL, api, datum, type Implementatie as ImplementatieData, type ImplementatieAntwoord, type ImplementatieVoorstel, type KlantDetail, type TopicRegel } from '../api';
import { Melding, Veld, foutTekst, useLaden } from '../ui';

const VOORSTEL_LABEL: Record<ImplementatieVoorstel['veld'], string> = { werkelijkeLivegang: 'Werkelijke livegang', acceptatieOp: 'Acceptatie door de gemeente', nazorgTot: 'Nazorg tot' };
type Waarden = { module: string; fase: ImplementatieData['fase']; testStatus: string; geplandeLivegang: string; werkelijkeLivegang: string; acceptatieOp: string; acceptatieCitaat: string; nazorgTot: string; bovenliggendTopicId: string; contactpersoonId: string };
const LEEG: Waarden = { module: '', fase: 'voorbereiding', testStatus: 'niet_gestart', geplandeLivegang: '', werkelijkeLivegang: '', acceptatieOp: '', acceptatieCitaat: '', nazorgTot: '', bovenliggendTopicId: '', contactpersoonId: '' };
const naarWaarden = (i: ImplementatieData): Waarden => ({
  module: i.module, fase: i.fase, testStatus: i.testStatus, geplandeLivegang: i.geplandeLivegang ?? '', werkelijkeLivegang: i.werkelijkeLivegang ?? '', acceptatieOp: i.acceptatieOp ?? '',
  acceptatieCitaat: i.acceptatieCitaat, nazorgTot: i.nazorgTot ?? '', bovenliggendTopicId: i.bovenliggendTopicId ?? '', contactpersoonId: i.contactpersoonId ?? '',
});
const naarBody = (w: Waarden) => ({
  module: w.module, fase: w.fase, testStatus: w.testStatus, geplandeLivegang: w.geplandeLivegang || null, werkelijkeLivegang: w.werkelijkeLivegang || null, acceptatieOp: w.acceptatieOp || null,
  acceptatieCitaat: w.acceptatieOp ? w.acceptatieCitaat : '', nazorgTot: w.nazorgTot || null, bovenliggendTopicId: w.bovenliggendTopicId || null, contactpersoonId: w.contactpersoonId || null,
});

/** Levenscyclus van een module-implementatie bij een onderwerp. Voorstellen uit een debrief gelden pas na "Overnemen". */
export function ImplementatiePaneel({ topicId, klantId, topics }: { topicId: string; klantId: string | null; topics: TopicRegel[] }) {
  const data = useLaden(() => api<ImplementatieAntwoord>('GET', `/implementaties/${topicId}`), [topicId]);
  const klant = useLaden(() => (klantId ? api<KlantDetail>('GET', `/klanten/${klantId}`) : Promise.resolve(null)), [klantId]);
  const [w, setW] = useState<Waarden>(LEEG);
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  const bestaat = !!data.data?.implementatie;
  useEffect(() => { if (data.data?.implementatie) setW(naarWaarden(data.data.implementatie)); }, [data.data]);
  if (data.fout) return <Melding tekst={data.fout} />;
  if (!data.data) return null;
  const zet = <K extends keyof Waarden>(k: K, v: Waarden[K]) => setW({ ...w, [k]: v });
  const projecten = topics.filter((t) => t.type === 'project' && t.klantId === klantId && t.id !== topicId);

  async function bewaar(e?: FormEvent, nieuw: Waarden = w) {
    e?.preventDefault();
    try { await api('PUT', `/implementaties/${topicId}`, naarBody(nieuw)); setMelding({ tekst: 'Opgeslagen.', soort: 'ok' }); data.ververs(); } catch (err) { setMelding({ tekst: foutTekst(err), soort: 'fout' }); }
  }
  async function neemOver(v: ImplementatieVoorstel) {
    const nieuw = { ...w, [v.veld]: v.waarde, ...(v.veld === 'acceptatieOp' ? { acceptatieCitaat: v.citaat } : {}) };
    setW(nieuw);
    await bewaar(undefined, nieuw);
  }
  async function haalWeg() {
    if (!confirm('De markering als implementatie weghalen? Het onderwerp, het dagboek en de punten blijven bestaan.')) return;
    try { await api('DELETE', `/implementaties/${topicId}`); setW(LEEG); data.ververs(); } catch (err) { setMelding({ tekst: foutTekst(err), soort: 'fout' }); }
  }

  return (
    <form className="paneel stapel" onSubmit={bewaar} aria-label="Implementatie">
      <h2>Implementatie</h2>
      {!bestaat && <p className="zacht klein">Dit onderwerp is nog geen module-implementatie. Vul de module in om het als implementatie bij te houden; een consultantdebrief kan er dan fase, test en livegang aan koppelen.</p>}
      {bestaat && data.data.voorstellen.length > 0 && (
        <div className="stapel" role="status">
          <strong>Voorgesteld in een debrief</strong>
          {data.data.voorstellen.map((v) => (
            <div key={v.debriefId + v.veld} className="rij">
              <span>{VOORSTEL_LABEL[v.veld]}: <strong>{datum(v.waarde)}</strong>{v.citaat && <span className="zacht klein"> — “{v.citaat}” ({datum(v.datum)})</span>}</span>
              <button type="button" onClick={() => neemOver(v)}>Overnemen</button>
            </div>
          ))}
        </div>
      )}
      <div className="raster">
        <Veld label="Module"><input value={w.module} onChange={(e) => zet('module', e.target.value)} maxLength={100} required /></Veld>
        <Veld label="Fase">
          <select value={w.fase} onChange={(e) => zet('fase', e.target.value as Waarden['fase'])}>{IMPLEMENTATIE_FASEN.map((f) => <option key={f} value={f}>{IMPLEMENTATIE_FASE_LABEL[f]}</option>)}</select>
        </Veld>
        <Veld label="Test">
          <select value={w.testStatus} onChange={(e) => zet('testStatus', e.target.value)}>{Object.entries(TEST_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Veld>
        <Veld label="Geplande livegang"><input type="date" value={w.geplandeLivegang} onChange={(e) => zet('geplandeLivegang', e.target.value)} /></Veld>
        <Veld label="Werkelijke livegang"><input type="date" value={w.werkelijkeLivegang} onChange={(e) => zet('werkelijkeLivegang', e.target.value)} /></Veld>
        <Veld label="Acceptatie op"><input type="date" value={w.acceptatieOp} onChange={(e) => zet('acceptatieOp', e.target.value)} /></Veld>
        <Veld label="Nazorg tot"><input type="date" value={w.nazorgTot} onChange={(e) => zet('nazorgTot', e.target.value)} /></Veld>
        <Veld label="Onderdeel van project">
          <select value={w.bovenliggendTopicId} onChange={(e) => zet('bovenliggendTopicId', e.target.value)} disabled={!klantId}>
            <option value="">Geen project</option>{projecten.map((p) => <option key={p.id} value={p.id}>{p.titel}</option>)}
          </select>
        </Veld>
        <Veld label="Contactpersoon bij de gemeente">
          <select value={w.contactpersoonId} onChange={(e) => zet('contactpersoonId', e.target.value)} disabled={!klantId}>
            <option value="">Niemand</option>{(klant.data?.contacten ?? []).map((c) => <option key={c.id} value={c.id}>{c.naam}</option>)}
          </select>
        </Veld>
      </div>
      {!klantId && <p className="zacht klein">Koppel eerst een gemeente aan dit onderwerp om een project of contactpersoon te kiezen.</p>}
      {w.acceptatieOp && w.acceptatieCitaat && <p className="zacht klein">Acceptatie volgens de consultant: “{w.acceptatieCitaat}”</p>}
      {melding && <Melding tekst={melding.tekst} soort={melding.soort} />}
      <div className="rij spreid">
        <button className="primair" type="submit">{bestaat ? 'Implementatie opslaan' : 'Markeer als implementatie'}</button>
        {bestaat && <button type="button" className="gevaar" onClick={haalWeg}>Geen implementatie meer</button>}
      </div>
    </form>
  );
}
