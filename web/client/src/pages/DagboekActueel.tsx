import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, datum, datumTijd, type BezoekTeller, type DigestStand, type FeedItem, type FeedToken, type GebruikersRol, type KlantRegel, type TellerPeriode } from '../api';
import { Badge, Leeg, Melding, foutTekst, useLaden } from '../ui';

const PERIODES = [[7, 'Week'], [14, '2 weken'], [30, 'Maand']] as const;
const SOORT_LABEL: Record<FeedItem['soort'], string> = { update: 'Onderwerp', bezoek: 'Bezoek', consultant: 'Consultant' };

/** De samenvatting is gewone tekst: eerste regel is de kern, elke volgende regel "Gemeente: nieuws". */
function DigestTekst({ tekst }: { tekst: string }) {
  const [kern, ...rest] = tekst.split('\n').map((r) => r.replace(/^[-•*\s]+/, '').trim()).filter(Boolean);
  return (
    <>
      <p>{kern}</p>
      {rest.length > 0 && (
        <ul className="digest">
          {rest.map((r, i) => {
            const m = /^([^:]{1,60}):\s+(.*)$/.exec(r);
            return <li key={i}>{m ? <><strong>{m[1]}:</strong> {m[2]}</> : r}</li>;
          })}
        </ul>
      )}
    </>
  );
}

function Digest({ rol }: { rol: GebruikersRol }) {
  const [stand, setStand] = useState<DigestStand | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  // De samenvatting wordt op de achtergrond gemaakt: kijk een paar keer opnieuw tot hij klaar is.
  useEffect(() => {
    let weg = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const haal = async (poging: number) => {
      try {
        const s = await api<DigestStand>('GET', '/dagboek/digest');
        if (weg) return;
        setStand(s); setFout(null);
        if (s.bezig && poging < 6) timer = setTimeout(() => void haal(poging + 1), 5000);
      } catch (e) { if (!weg) setFout(foutTekst(e)); }
    };
    void haal(0);
    return () => { weg = true; clearTimeout(timer); };
  }, []);

  async function vernieuw() {
    setBezig(true); setFout(null);
    try { setStand(await api<DigestStand>('POST', '/dagboek/digest/vernieuwen')); } catch (e) { setFout(foutTekst(e)); } finally { setBezig(false); }
  }

  return (
    <section className="paneel stapel" aria-labelledby="digest-kop">
      <div className="rij spreid">
        <h2 id="digest-kop">Actueel: afgelopen week</h2>
        {rol === 'beheerder' && <button onClick={() => void vernieuw()} disabled={bezig}>{bezig ? 'Bezig…' : 'Vernieuwen'}</button>}
      </div>
      <Melding tekst={fout} />
      {stand?.tekst
        ? <><DigestTekst tekst={stand.tekst} /><p className="zacht klein">Samengevat uit {stand.aantalItems} verslagen{stand.gemaaktOp ? `, ${datumTijd(stand.gemaaktOp)}` : ''}{stand.bezig ? ' · wordt bijgewerkt…' : ''}.</p></>
        : stand?.bezig ? <p className="zacht">De samenvatting wordt gemaakt…</p>
        : stand && stand.aantalItems === 0 && !stand.verouderd ? <p className="zacht">Er zijn de afgelopen week geen verslagen.</p>
        : stand ? <p className="zacht">Er is nog geen samenvatting.</p> : null}
    </section>
  );
}

function RssLinks({ klantId }: { klantId: string }) {
  const lijst = useLaden(() => api<FeedToken[]>('GET', '/dagboek/feed-tokens'));
  const [label, setLabel] = useState('');
  const [nieuw, setNieuw] = useState<{ url: string } | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [gekopieerd, setGekopieerd] = useState<string | null>(null);

  async function maak(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ url: string }>('POST', '/dagboek/feed-tokens', { label });
      setNieuw({ url: r.url }); setLabel(''); setFout(null); void lijst.ververs();
    } catch (err) { setFout(foutTekst(err)); }
  }
  async function trekIn(id: string) {
    if (!window.confirm('Deze RSS-link intrekken? De lezer waarin je hem hebt geplakt krijgt dan geen updates meer.')) return;
    try { await api('DELETE', `/dagboek/feed-tokens/${id}`); setNieuw(null); void lijst.ververs(); } catch (err) { setFout(foutTekst(err)); }
  }
  async function kopieer(url: string) {
    try { await navigator.clipboard.writeText(url); setGekopieerd(url); } catch { setFout('Kopiëren lukte niet; selecteer de link en kopieer hem zelf.'); }
  }
  const metKlant = (url: string) => (klantId ? `${url}&klant=${klantId}` : url);

  return (
    <details className="paneel stapel">
      <summary><strong>RSS op je telefoon</strong></summary>
      <p className="zacht">Plak een persoonlijke link in een RSS-lezer (bijvoorbeeld Feedly, Inoreader of NetNewsWire) en je ziet alle nieuwe verslagen zonder in te loggen. Behandel de link als een wachtwoord: wie hem heeft, ziet de samenvattingen. Je kunt hem hier altijd intrekken.</p>
      <Melding tekst={fout} />
      {nieuw && (
        <div className="stapel" role="status">
          <p><strong>Je nieuwe link</strong> (alleen nu te zien):</p>
          <input readOnly value={metKlant(nieuw.url)} onFocus={(e) => e.currentTarget.select()} aria-label="RSS-link" />
          <div className="rij">
            <button className="primair" onClick={() => void kopieer(metKlant(nieuw.url))}>{gekopieerd === metKlant(nieuw.url) ? 'Gekopieerd' : klantId ? 'Kopieer link van deze gemeente' : 'Kopieer link'}</button>
            {klantId && <button onClick={() => void kopieer(nieuw.url)}>{gekopieerd === nieuw.url ? 'Gekopieerd' : 'Kopieer link met alle gemeenten'}</button>}
          </div>
          {!klantId && <p className="zacht klein">Alleen één gemeente volgen? Kies hierboven eerst die gemeente; dan krijg je ook een link voor alleen die gemeente.</p>}
        </div>
      )}
      <form className="rij" onSubmit={maak}>
        <input value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder="Naam, bijvoorbeeld Telefoon" aria-label="Naam van de link" />
        <button type="submit">Nieuwe RSS-link</button>
      </form>
      {lijst.data && lijst.data.length > 0 && (
        <ul className="lijst-kaarten">
          {lijst.data.map((t) => (
            <li key={t.id} className="rij spreid">
              <span>{t.label || 'RSS-link'} <span className="zacht klein">· aangemaakt {datumTijd(t.createdAt)}{t.laatstGebruikt ? ` · laatst gebruikt ${datumTijd(t.laatstGebruikt)}` : ' · nog niet gebruikt'}</span></span>
              <button onClick={() => void trekIn(t.id)}>Intrekken</button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

const TELLER_PERIODES: [TellerPeriode, string][] = [['jaar', 'Dit jaar'], ['kwartaal', 'Dit kwartaal'], ['maand', 'Deze maand']];
const TELLER_SLEUTEL = 'bezoekteller-periode';
const leesPeriode = (): TellerPeriode => { try { const p = localStorage.getItem(TELLER_SLEUTEL); return p === 'kwartaal' || p === 'maand' ? p : 'jaar'; } catch { return 'jaar'; } };

/** Het aantal klantbezoeken van het team in de gekozen periode, met uitsplitsing per accountmanager. */
function Bezoekteller() {
  const [periode, setPeriode] = useState<TellerPeriode>(leesPeriode);
  const teller = useLaden(() => api<BezoekTeller>('GET', `/dagboek/bezoekteller?periode=${periode}`), [periode]);
  const kies = (p: TellerPeriode) => { setPeriode(p); try { localStorage.setItem(TELLER_SLEUTEL, p); } catch { /* opslag niet beschikbaar */ } };
  const t = teller.data;
  return (
    <section className="paneel stapel" aria-labelledby="teller-kop">
      <div className="rij spreid">
        <h2 id="teller-kop">Klantbezoeken van het team</h2>
        <div className="rij" role="group" aria-label="Periode">
          {TELLER_PERIODES.map(([p, label]) => <button key={p} className={periode === p ? 'primair' : ''} aria-pressed={periode === p} onClick={() => kies(p)}>{label}</button>)}
        </div>
      </div>
      <Melding tekst={teller.fout} />
      {t && (
        <>
          <dl className="rij" style={{ gap: '2rem' }}>
            <div><dt className="zacht klein">Klantbezoeken</dt><dd style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>{t.bezoeken}</dd></div>
            <div><dt className="zacht klein">Gemeenten bezocht</dt><dd style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>{t.klanten}</dd></div>
            {t.evaluaties !== undefined && <div><dt className="zacht klein">iThermometer-evaluaties</dt><dd style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>{t.evaluaties}</dd></div>}
          </dl>
          <p className="zacht klein">{datum(t.van)} t/m {datum(t.tot)}. Geteld op de datum van het bezoek.</p>
          {t.perAccountmanager.length > 0 && (
            <details>
              <summary>Per accountmanager</summary>
              <ul className="lijst-kaarten">{t.perAccountmanager.map((a) => <li key={a.naam} className="rij spreid"><span>{a.naam}</span><strong>{a.aantal}</strong></li>)}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

export function DagboekActueel({ rol }: { rol: GebruikersRol }) {
  const [params, zetParams] = useSearchParams();
  const klantId = params.get('klant') ?? '';
  const dagen = Number(params.get('dagen')) || 14;
  const klanten = useLaden(() => api<KlantRegel[]>('GET', '/klanten'));
  const feed = useLaden(() => api<FeedItem[]>('GET', `/dagboek/feed?dagen=${dagen}&limit=100${klantId ? `&klant=${klantId}` : ''}`), [dagen, klantId]);
  const [wisFout, setWisFout] = useState<string | null>(null);
  async function wis(i: FeedItem) {
    if (!window.confirm('Dit verslag en de bijbehorende punten verwijderen? Dit kan niet worden teruggedraaid.')) return;
    try { await api('DELETE', `/${i.soort === 'bezoek' ? 'bezoeken' : 'consultant-debriefs'}/${i.id}`); setWisFout(null); void feed.ververs(); } catch (e) { setWisFout(foutTekst(e)); }
  }
  const zet = (sleutel: string, waarde: string) => { const p = new URLSearchParams(params); if (waarde) p.set(sleutel, waarde); else p.delete(sleutel); zetParams(p, { replace: true }); };

  return (
    <div className="stapel">
      <div><h1>Dagboek</h1><p className="zacht">Wat er speelt bij de gemeenten: de nieuwste verslagen, samengevat.</p></div>
      <Bezoekteller />
      <Digest rol={rol} />

      <div className="rij" role="group" aria-label="Filter">
        <label className="rij">Gemeente
          <select value={klantId} onChange={(e) => zet('klant', e.target.value)}>
            <option value="">Alle gemeenten</option>
            {(klanten.data ?? []).map((k) => <option key={k.id} value={k.id}>{k.naam}</option>)}
          </select>
        </label>
        {PERIODES.map(([d, label]) => (
          <button key={d} className={dagen === d ? 'primair' : ''} aria-pressed={dagen === d} onClick={() => zet('dagen', String(d))}>{label}</button>
        ))}
      </div>

      <Melding tekst={feed.fout ?? wisFout} />
      {feed.data && feed.data.length === 0 && <Leeg>Geen verslagen in deze periode{klantId ? ' voor deze gemeente' : ''}.</Leeg>}
      <div className="stapel">
        {feed.data?.map((i) => (
          <article key={`${i.soort}-${i.id}`} className="paneel stapel">
            <div className="rij spreid">
              <h3>{i.klantId ? <Link to={`/dagboek?klant=${i.klantId}`}>{i.klantNaam}</Link> : (i.klantNaam ?? 'Geen gemeente')}: <Link to={i.pad}>{i.titel}</Link></h3>
              <Badge>{SOORT_LABEL[i.soort]}</Badge>
            </div>
            <p style={{ whiteSpace: 'pre-line' }}>{i.tekst}</p>
            <div className="rij spreid">
              <p className="zacht klein">{datumTijd(i.datum)}{i.door ? ` · ${i.door}` : ''}</p>
              {rol === 'beheerder' && i.soort !== 'update' && <button type="button" onClick={() => void wis(i)}>Verwijderen</button>}
            </div>
          </article>
        ))}
      </div>

      <RssLinks klantId={klantId} />
    </div>
  );
}
