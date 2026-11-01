import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  KWALITEIT_LABEL, SOORT_LABEL, api, datum, linkedInZoekUrl, type ActiviteitSoort, type KwaliteitAntwoord, type KwaliteitBevinding, type KwaliteitContact, type KwaliteitSoort, type Medewerker, type SamenvoegUitkomst,
} from '../api';
import { Badge, Leeg, Melding, Veld, foutTekst, useLaden } from '../ui';

const SOORTEN = Object.keys(KWALITEIT_LABEL) as KwaliteitSoort[];

function LinkedIn({ naam, gemeente }: { naam: string; gemeente: string }) {
  // Alleen een zoeklink: er wordt niets opgehaald of bewaard; de accountmanager beoordeelt zelf.
  return <a href={linkedInZoekUrl(naam, gemeente)} target="_blank" rel="noopener noreferrer" className="klein">Zoek op LinkedIn</a>;
}

function ContactRegel({ c, gemeente, actie }: { c: KwaliteitContact; gemeente: string; actie?: React.ReactNode }) {
  return (
    <li className="rij spreid">
      <div>
        <strong>{c.naam}</strong>{[c.functie, c.rol].filter(Boolean).length > 0 && <span className="zacht"> — {[c.functie, c.rol].filter(Boolean).join(', ')}</span>}
        <div className="zacht klein">
          {c.email || 'geen e-mail'} · {c.telefoon || 'geen telefoon'} · {c.bron === 'gesprek' ? 'uit een gesprek' : 'handmatig'}, {datum(c.aangemaakt)}{c.gebruik > 0 && ` · ${c.gebruik}× gekoppeld aan punten of debriefs`}
          {' · '}<LinkedIn naam={c.naam} gemeente={gemeente} />
        </div>
      </div>
      {actie}
    </li>
  );
}

export function Kaart({ b, ververs, fout }: { b: KwaliteitBevinding; ververs: () => void; fout: (e: unknown) => void }) {
  const [uitkomst, setUitkomst] = useState<SamenvoegUitkomst | null>(null);
  const doe = async (f: () => Promise<unknown>) => { try { await f(); ververs(); } catch (e) { fout(e); } };
  const besluit = () => doe(() => api('POST', '/kwaliteit/besluiten', { sleutel: b.sleutel, soort: b.soort }));
  const terug = () => doe(() => api('POST', '/kwaliteit/besluiten/terugdraaien', { sleutel: b.sleutel }));

  async function voegSamen(behoud: string, rest: string[]) {
    if (!window.confirm('De andere contactpersonen samenvoegen met deze? Lege velden worden aangevuld en alles wat aan hen hing verhuist mee. Dit kan niet ongedaan worden gemaakt.')) return;
    try { setUitkomst(await api<SamenvoegUitkomst>('POST', '/klant-contacten/samenvoegen', { behoudId: behoud, verwijderIds: rest })); ververs(); } catch (e) { fout(e); }
  }
  async function houdOver(behoud: string) {
    const rest = (b.activiteiten ?? []).filter((a) => a.id !== behoud);
    if (!window.confirm(`${rest.length} ander(e) punt(en) verwijderen en alleen dit punt houden?`)) return;
    await doe(async () => { for (const a of rest) await api('DELETE', `/activiteiten/${a.id}`); });
  }

  return (
    <li className="paneel stapel">
      <div className="rij spreid">
        <div><Badge soort={b.ernst === 'hoog' ? 'fout' : ''}>{KWALITEIT_LABEL[b.soort]}</Badge> <Link to={`/klanten/${b.klantId}`}><strong>{b.klantNaam}</strong></Link>{b.accountmanagerNaam && <span className="zacht klein"> · accountmanager {b.accountmanagerNaam}</span>}</div>
        {b.besloten ? <button type="button" onClick={terug}>Weer tonen</button> : <button type="button" onClick={besluit}>{b.soort.startsWith('dubbel') ? 'Dit zijn verschillende' : 'Geen probleem'}</button>}
      </div>
      <p>{b.uitleg}</p>
      {b.contacten && (
        <ul className="lijst">
          {b.contacten.map((c) => (
            <ContactRegel key={c.id} c={c} gemeente={b.klantNaam} actie={b.soort === 'dubbel_contact' ? (
              <button type="button" className="primair" onClick={() => void voegSamen(c.id, b.contacten!.filter((x) => x.id !== c.id).map((x) => x.id))}>Behoud deze, voeg de rest samen</button>
            ) : <Link className="knop" to={`/contactpersonen?zoek=${encodeURIComponent(c.naam)}`}>Bewerken</Link>} />
          ))}
        </ul>
      )}
      {b.voorstel && (
        <div className="rij">
          <span>Voorstel:{b.voorstel.naam && <> naam <strong>{b.voorstel.naam}</strong></>}{b.voorstel.email && <> · e-mail <strong>{b.voorstel.email}</strong></>}{b.voorstel.telefoon && <> · telefoon <strong>{b.voorstel.telefoon}</strong></>}</span>
          <button type="button" className="primair" onClick={() => doe(() => { const { contactId, ...velden } = b.voorstel!; return api('PATCH', `/klant-contacten/${contactId}`, velden); })}>Toepassen</button>
        </div>
      )}
      {b.klanten && (
        <ul className="lijst">
          {b.klanten.map((k) => <li key={k.id}><Link to={`/klanten/${k.id}`}><strong>{k.naam}</strong></Link> <span className="zacht klein">· {k.status}{k.afasId && ` · AFAS ${k.afasId}`} · {k.aantalContacten} contactpersonen · {k.aantalPunten} punten</span></li>)}
        </ul>
      )}
      {b.activiteiten && (
        <ul className="lijst">
          {b.activiteiten.map((a) => (
            <li key={a.id} className="rij spreid">
              <div>{a.omschrijving}<div className="zacht klein">{SOORT_LABEL[a.soort as ActiviteitSoort] ?? a.soort}{a.eigenaar && ` · ${a.eigenaar}`}{a.deadline && ` · uiterlijk ${datum(a.deadline)}`} · {a.bron === 'gesprek' ? 'uit een gesprek' : 'handmatig'}, {datum(a.aangemaakt)}{a.metCitaat && ' · met citaat'}</div></div>
              <button type="button" className="primair" onClick={() => void houdOver(a.id)}>Houd dit punt over</button>
            </li>
          ))}
        </ul>
      )}
      {uitkomst && <Melding soort="ok" tekst={`Samengevoegd (${uitkomst.samengevoegd}).${uitkomst.aangevuld.length ? ` Aangevuld: ${uitkomst.aangevuld.join(', ')}.` : ''}${uitkomst.conflicten.length ? ` Niet overgenomen omdat er al een andere waarde stond: ${uitkomst.conflicten.join('; ')}.` : ''}`} />}
    </li>
  );
}

/** Kwaliteit van wat al is vastgelegd. De accountmanager beoordeelt en ruimt op; er wordt niets automatisch samengevoegd of verwijderd. */
export function Kwaliteit() {
  const [zoek, setZoek] = useSearchParams();
  const soort = (zoek.get('soort') ?? '') as KwaliteitSoort | '';
  const am = zoek.get('am') ?? '';
  const klant = zoek.get('klant') ?? '';
  const besloten = zoek.get('besloten') === '1';
  const vraag = [soort && `soort=${soort}`, am && `accountmanagerId=${am}`, /^[0-9a-f-]{36}$/i.test(klant) ? `klantId=${klant}` : '', besloten && 'besloten=1'].filter(Boolean).join('&');
  const data = useLaden(() => api<KwaliteitAntwoord>('GET', `/kwaliteit${vraag ? `?${vraag}` : ''}`), [vraag]);
  const medewerkers = useLaden(() => api<Medewerker[]>('GET', '/employees'));
  const [melding, setMelding] = useState<string | null>(null);
  const zet = (k: string, v: string) => { const n = new URLSearchParams(zoek); if (v) n.set(k, v); else n.delete(k); setZoek(n, { replace: true }); };
  const accountmanagers = (medewerkers.data ?? []).filter((m) => m.rol === 'accountmanager');
  return (
    <div className="stapel">
      <div><h1>Kwaliteit</h1><p className="zacht">Wat al is vastgelegd, gecontroleerd op dubbelen en onvolledige gegevens. De accountmanager beoordeelt: samenvoegen, verbeteren, of aangeven dat het geen probleem is. Er wordt niets automatisch gewijzigd.</p></div>
      <Melding tekst={melding ?? data.fout} />
      <div className="raster">
        <Veld label="Soort"><select value={soort} onChange={(e) => zet('soort', e.target.value)}><option value="">Alles{data.data ? ` (${data.data.totaal})` : ''}</option>{SOORTEN.map((s) => <option key={s} value={s}>{KWALITEIT_LABEL[s]}{data.data?.perSoort[s] ? ` (${data.data.perSoort[s]})` : ''}</option>)}</select></Veld>
        <Veld label="Accountmanager"><select value={am} onChange={(e) => zet('am', e.target.value)}><option value="">Alle</option>{accountmanagers.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}</select></Veld>
      </div>
      <label className="rij"><input type="checkbox" checked={besloten} onChange={(e) => zet('besloten', e.target.checked ? '1' : '')} /> Ook meldingen tonen die als geen probleem zijn aangemerkt</label>
      {klant && <Link to="/kwaliteit">Alle gemeenten tonen</Link>}
      {data.data && data.data.bevindingen.length === 0 && <Leeg>Niets te verbeteren.</Leeg>}
      <ul className="lijst-kaarten">{(data.data?.bevindingen ?? []).map((b) => <Kaart key={b.sleutel} b={b} ververs={() => { setMelding(null); void data.ververs(); }} fout={(e) => setMelding(foutTekst(e))} />)}</ul>
    </div>
  );
}
