import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ONDERWERP_STATUS_LABEL, SESSIE_SOORT_LABEL, SESSIE_STATUS_LABEL, SOORT_LABEL, api, datum, type ActiviteitSoort, type KlantDetail, type Medewerker, type SamenverderProgramma, type SamenverderSessie, type SessieSoort,
} from '../api';
import { Badge, Leeg, Melding, Veld, foutTekst, useLaden } from '../ui';

type SessieWaarden = { soort: SessieSoort; dagnummer: string; onderwerp: string; doel: string; datum: string; omvangDagen: string; extra: boolean; contactpersoonId: string; consultantIds: string[] };
const LEEG: SessieWaarden = { soort: 'uitvoering', dagnummer: '', onderwerp: '', doel: '', datum: '', omvangDagen: '1', extra: false, contactpersoonId: '', consultantIds: [] };
const uitSessie = (s: SamenverderSessie): SessieWaarden => ({
  soort: s.soort, dagnummer: s.dagnummer === null ? '' : String(s.dagnummer), onderwerp: s.onderwerp, doel: s.doel ?? '', datum: s.datum ?? '', omvangDagen: String(s.omvangDagen), extra: s.extra,
  contactpersoonId: s.contactpersoonId ?? '', consultantIds: s.consultants.map((c) => c.id),
});
const naarBody = (w: SessieWaarden) => ({
  soort: w.soort, dagnummer: w.dagnummer.trim() ? Number(w.dagnummer) : null, onderwerp: w.onderwerp, doel: w.doel.trim() ? w.doel : null, datum: w.datum || null,
  omvangDagen: Number(w.omvangDagen.replace(',', '.')), extra: w.extra, contactpersoonId: w.contactpersoonId || null, consultantIds: w.consultantIds,
});
const dagen = (n: number) => `${String(n).replace('.', ',')} ${n === 1 ? 'dag' : 'dagen'}`;

function SessieFormulier({ waarden, zet, klant, medewerkers, opslaan, annuleer, knop }: {
  waarden: SessieWaarden; zet: (w: SessieWaarden) => void; klant: KlantDetail | null; medewerkers: Medewerker[]; opslaan: (e: FormEvent) => void; annuleer?: () => void; knop: string;
}) {
  const wijzig = <K extends keyof SessieWaarden>(k: K, v: SessieWaarden[K]) => zet({ ...waarden, [k]: v });
  const kiesbaar = medewerkers.filter((m) => m.actief && (m.consultant || waarden.consultantIds.includes(m.id)));
  return (
    <form className="stapel" onSubmit={opslaan}>
      <div className="raster">
        <Veld label="Soort"><select value={waarden.soort} onChange={(e) => wijzig('soort', e.target.value as SessieSoort)}>{Object.entries(SESSIE_SOORT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Veld>
        <Veld label="Dagnummer"><input type="number" min={1} max={100} value={waarden.dagnummer} onChange={(e) => wijzig('dagnummer', e.target.value)} /></Veld>
        <Veld label="Datum"><input type="date" value={waarden.datum} onChange={(e) => wijzig('datum', e.target.value)} required /></Veld>
        <Veld label="Omvang (dagen, bijvoorbeeld 0,5)"><input inputMode="decimal" value={waarden.omvangDagen} onChange={(e) => wijzig('omvangDagen', e.target.value)} required /></Veld>
        <Veld label="Contactpersoon"><select value={waarden.contactpersoonId} onChange={(e) => wijzig('contactpersoonId', e.target.value)}><option value="">Niemand</option>{(klant?.contacten ?? []).map((c) => <option key={c.id} value={c.id}>{c.naam}</option>)}</select></Veld>
      </div>
      <Veld label="Onderwerp"><input value={waarden.onderwerp} onChange={(e) => wijzig('onderwerp', e.target.value)} maxLength={300} /></Veld>
      <Veld label="Doel van de sessie"><textarea value={waarden.doel} onChange={(e) => wijzig('doel', e.target.value)} maxLength={1000} /></Veld>
      <fieldset><legend>Consultants</legend>
        {kiesbaar.length === 0 ? <p className="zacht klein">Geen consultants. Zet het vinkje bij Medewerkers.</p> : kiesbaar.map((m) => (
          <label key={m.id} className="rij"><input type="checkbox" checked={waarden.consultantIds.includes(m.id)} onChange={(e) => wijzig('consultantIds', e.target.checked ? [...waarden.consultantIds, m.id] : waarden.consultantIds.filter((x) => x !== m.id))} /> {m.naam}</label>
        ))}
      </fieldset>
      <label className="rij"><input type="checkbox" checked={waarden.extra} onChange={(e) => wijzig('extra', e.target.checked)} /> Extra dag (buiten het afgesproken pakket)</label>
      <div className="rij"><button className="primair" type="submit">{knop}</button>{annuleer && <button type="button" onClick={annuleer}>Annuleren</button>}</div>
    </form>
  );
}

function Sessie({ s, alleenLezen, klant, medewerkers, ververs, fout }: { s: SamenverderSessie; alleenLezen: boolean; klant: KlantDetail | null; medewerkers: Medewerker[]; ververs: () => void; fout: (e: unknown) => void }) {
  const [bewerk, setBewerk] = useState<SessieWaarden | null>(null);
  const [nieuwOnderwerp, setNieuwOnderwerp] = useState('');
  const doe = async (f: () => Promise<unknown>) => { try { await f(); ververs(); } catch (e) { fout(e); } };
  const actief = s.status === 'gepland';
  const punten = new Map<string, SamenverderSessie['activiteiten']>();
  for (const a of s.activiteiten) punten.set(a.soort, [...(punten.get(a.soort) ?? []), a]);
  return (
    <li className="paneel stapel">
      <div className="rij spreid">
        <strong>{s.datum ? datum(s.datum) : 'Geen datum'} · {SESSIE_SOORT_LABEL[s.soort]}{s.dagnummer ? ` ${s.dagnummer}` : ''}</strong>
        <span><Badge soort={s.status === 'gepland' ? 'wacht' : ''}>{SESSIE_STATUS_LABEL[s.status]}</Badge>{s.extra && <> <Badge>Extra</Badge></>}</span>
      </div>
      <p className="zacht klein">{dagen(s.omvangDagen)}{s.consultants.length > 0 && ` · ${s.consultants.map((c) => c.naam).join(', ')}`}{s.contactpersoonNaam && ` · contact: ${s.contactpersoonNaam}`}{s.bevestigdOp && ` · bevestigd ${datum(s.bevestigdOp)}${s.bevestigdDoor ? ` door ${s.bevestigdDoor}` : ''}`}</p>
      {s.onderwerp && <p><strong>Onderwerp:</strong> {s.onderwerp}</p>}
      {s.doel && <p><strong>Doel:</strong> {s.doel}</p>}
      {s.onderwerpen.length > 0 && <ul>{s.onderwerpen.map((o) => (
        <li key={o.id}>{o.titel} <span className="zacht klein">({ONDERWERP_STATUS_LABEL[o.status]})</span>
          {!alleenLezen && <> <button type="button" className="tekstknop gevaar" onClick={() => doe(() => api('DELETE', `/samenverder/onderwerpen/${o.id}`))}>Verwijderen</button></>}</li>
      ))}</ul>}
      {s.debriefs.map((d) => <p key={d.id}><strong>Debrief ({datum(d.createdAt)}{d.door ? `, ${d.door}` : ''}):</strong> {d.samenvatting}</p>)}
      {[...punten.entries()].map(([soort, lijst]) => (
        <div key={soort}><strong>{SOORT_LABEL[soort as ActiviteitSoort] ?? soort}</strong>
          <ul>{lijst.map((a) => <li key={a.id}>{a.omschrijving}<span className="zacht klein">{a.eigenaar && ` · ${a.eigenaar}`}{a.deadline && ` · uiterlijk ${datum(a.deadline)}`}{a.status === 'afgerond' && ' · afgerond'}</span></li>)}</ul></div>
      ))}
      {!alleenLezen && (bewerk ? (
        <SessieFormulier waarden={bewerk} zet={setBewerk} klant={klant} medewerkers={medewerkers} knop="Opslaan" annuleer={() => setBewerk(null)}
          opslaan={(e) => { e.preventDefault(); void doe(async () => { await api('PATCH', `/samenverder/sessies/${s.id}`, naarBody(bewerk)); setBewerk(null); }); }} />
      ) : (
        <>
          {s.status !== 'verplaatst' && (
            <form className="rij" onSubmit={(e) => { e.preventDefault(); void doe(() => api('POST', `/samenverder/sessies/${s.id}/onderwerpen`, { titel: nieuwOnderwerp }).then(() => setNieuwOnderwerp(''))); }}>
              <input value={nieuwOnderwerp} onChange={(e) => setNieuwOnderwerp(e.target.value)} placeholder="Onderwerp toevoegen" aria-label="Onderwerp toevoegen" maxLength={300} /><button type="submit" disabled={!nieuwOnderwerp.trim()}>Toevoegen</button>
            </form>
          )}
          <div className="rij">
            {s.status !== 'verplaatst' && <button type="button" onClick={() => setBewerk(uitSessie(s))}>Bewerken</button>}
            {actief && <button type="button" className="primair" onClick={() => { if (confirm(`Bevestigen dat deze sessie op ${datum(s.datum)} is uitgevoerd (${dagen(s.omvangDagen)})?`)) void doe(() => api('POST', `/samenverder/sessies/${s.id}/uitgevoerd`, {})); }}>Bevestig uitgevoerd</button>}
            {actief && <button type="button" onClick={() => { const d = prompt('Nieuwe datum (JJJJ-MM-DD)', s.datum ?? ''); if (d) void doe(() => api('POST', `/samenverder/sessies/${s.id}/verplaats`, { datum: d })); }}>Verplaatsen</button>}
            {actief && <button type="button" onClick={() => { if (confirm('Deze sessie annuleren?')) void doe(() => api('POST', `/samenverder/sessies/${s.id}/annuleer`, {})); }}>Annuleren</button>}
            {(s.status === 'geannuleerd' || s.status === 'uitgevoerd') && <button type="button" onClick={() => { const d = prompt('Datum van de sessie (JJJJ-MM-DD)', s.datum ?? ''); if (d) void doe(() => api('POST', `/samenverder/sessies/${s.id}/heropen`, { datum: d })); }}>Weer inplannen</button>}
            {s.status !== 'uitgevoerd' && <button type="button" className="gevaar" onClick={() => { if (confirm('Deze sessie verwijderen?')) void doe(() => api('DELETE', `/samenverder/sessies/${s.id}`)); }}>Verwijderen</button>}
          </div>
        </>
      ))}
    </li>
  );
}

/** Tijdlijn van één programma: de sessies op datum, met wat er per sessie is vastgelegd. Administratie en planning; het dagenbudget volgt later. */
export function SamenVerderProgramma({ alleenLezen = false }: { alleenLezen?: boolean }) {
  const { id = '' } = useParams();
  const navigeer = useNavigate();
  const data = useLaden(() => api<SamenverderProgramma>('GET', `/samenverder/programmas/${id}`), [id]);
  const klantId = data.data?.klant.id;
  const klant = useLaden(() => (klantId && !alleenLezen ? api<KlantDetail>('GET', `/klanten/${klantId}`) : Promise.resolve(null)), [klantId, alleenLezen]);
  const medewerkers = useLaden(() => (alleenLezen ? Promise.resolve([] as Medewerker[]) : api<Medewerker[]>('GET', '/employees')), [alleenLezen]);
  const [nieuw, setNieuw] = useState<SessieWaarden>(LEEG);
  const [melding, setMelding] = useState<string | null>(null);
  const [bewerkProgramma, setBewerkProgramma] = useState<{ pakket: string; periodeVan: string; periodeTot: string; status: string; opmerking: string } | null>(null);
  if (data.fout) return <div className="stapel"><Melding tekst={data.fout} /><Link to="/samenverder">Terug naar SamenVerder</Link></div>;
  if (!data.data) return null;
  const { programma: p, klant: k, sessies } = data.data;
  const fout = (e: unknown) => setMelding(foutTekst(e));
  const ververs = () => { setMelding(null); void data.ververs(); };
  return (
    <div className="stapel">
      <div><Link to="/samenverder">← SamenVerder</Link><h1>{k.naam} <Badge soort={p.status === 'afgerond' ? 'wacht' : ''}>{p.status === 'actief' ? 'Actief' : 'Afgerond'}</Badge></h1>
        <p className="zacht">{p.pakket || 'Geen pakket'} · {datum(p.periodeVan)}{p.periodeTot ? ` – ${datum(p.periodeTot)}` : ' –'} · <Link to={`/klanten/${k.id}`}>Gemeente</Link> · <Link to={`/klanten/${k.id}/voorbereiding`}>Bereid bezoek voor</Link></p>
        {p.opmerking && <p>{p.opmerking}</p>}</div>
      <Melding tekst={melding} />
      {!alleenLezen && (bewerkProgramma ? (
        <form className="paneel stapel" onSubmit={async (e) => { e.preventDefault(); try { await api('PATCH', `/samenverder/programmas/${id}`, { ...bewerkProgramma, periodeTot: bewerkProgramma.periodeTot || null }); setBewerkProgramma(null); ververs(); } catch (er) { fout(er); } }}>
          <div className="raster">
            <Veld label="Pakket"><input value={bewerkProgramma.pakket} onChange={(e) => setBewerkProgramma({ ...bewerkProgramma, pakket: e.target.value })} maxLength={200} /></Veld>
            <Veld label="Periode van"><input type="date" value={bewerkProgramma.periodeVan} onChange={(e) => setBewerkProgramma({ ...bewerkProgramma, periodeVan: e.target.value })} required /></Veld>
            <Veld label="Periode tot"><input type="date" value={bewerkProgramma.periodeTot} onChange={(e) => setBewerkProgramma({ ...bewerkProgramma, periodeTot: e.target.value })} /></Veld>
            <Veld label="Status"><select value={bewerkProgramma.status} onChange={(e) => setBewerkProgramma({ ...bewerkProgramma, status: e.target.value })}><option value="actief">Actief</option><option value="afgerond">Afgerond</option></select></Veld>
          </div>
          <Veld label="Opmerking"><textarea value={bewerkProgramma.opmerking} onChange={(e) => setBewerkProgramma({ ...bewerkProgramma, opmerking: e.target.value })} maxLength={2000} /></Veld>
          <div className="rij"><button className="primair" type="submit">Opslaan</button><button type="button" onClick={() => setBewerkProgramma(null)}>Annuleren</button></div>
        </form>
      ) : (
        <div className="rij">
          <button type="button" onClick={() => setBewerkProgramma({ pakket: p.pakket, periodeVan: p.periodeVan, periodeTot: p.periodeTot ?? '', status: p.status, opmerking: p.opmerking })}>Programma bewerken</button>
          <button type="button" className="gevaar" onClick={async () => { if (!confirm('Dit programma met al zijn sessies verwijderen?')) return; try { await api('DELETE', `/samenverder/programmas/${id}`); navigeer('/samenverder'); } catch (er) { fout(er); } }}>Verwijderen</button>
        </div>
      ))}
      <h2>Sessies ({sessies.length})</h2>
      {sessies.length === 0 ? <Leeg>Nog geen sessies.</Leeg> : <ul className="lijst-kaarten">{sessies.map((s) => <Sessie key={s.id} s={s} alleenLezen={alleenLezen} klant={klant.data} medewerkers={medewerkers.data ?? []} ververs={ververs} fout={fout} />)}</ul>}
      {!alleenLezen && (
        <section className="paneel stapel" aria-label="Sessie plannen">
          <h2>Sessie plannen</h2>
          <SessieFormulier waarden={nieuw} zet={setNieuw} klant={klant.data} medewerkers={medewerkers.data ?? []} knop="Sessie plannen"
            opslaan={async (e) => { e.preventDefault(); try { await api('POST', `/samenverder/programmas/${id}/sessies`, naarBody(nieuw)); setNieuw(LEEG); ververs(); } catch (er) { fout(er); } }} />
        </section>
      )}
    </div>
  );
}
