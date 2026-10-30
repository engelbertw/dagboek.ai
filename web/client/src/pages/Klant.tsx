import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { KLANT_STATUS_LABEL, SOORT_LABEL, api, datum, deadlineTekst, type KlantDetail, type KlantRegel, type KlantStatus, type Medewerker } from '../api';
import { Badge, Leeg, Melding, Veld, foutTekst, useLaden } from '../ui';
import { Details } from './Verkoopregister';

export function Klant() {
  const { id } = useParams();
  const navigeer = useNavigate();
  const kaart = useLaden(() => api<KlantDetail>('GET', `/klanten/${id}`), [id]);
  const medewerkers = useLaden(() => api<Medewerker[]>('GET', '/employees'));
  const klanten = useLaden(() => api<KlantRegel[]>('GET', '/klanten'));
  const [bewerk, setBewerk] = useState({ naam: '', status: 'klant' as KlantStatus, accountmanagerId: '', omschrijving: '', contractEinde: '' });
  const [samenvoegMet, setSamenvoegMet] = useState('');
  const [contact, setContact] = useState({ naam: '', functie: '', rol: '' });
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  const k = kaart.data?.klant;
  useEffect(() => {
    if (k) setBewerk({ naam: k.naam, status: k.status, accountmanagerId: k.accountmanagerId ?? '', omschrijving: k.omschrijving, contractEinde: k.contractEinde ?? '' });
  }, [k]);

  const fout = (e: unknown) => setMelding({ tekst: foutTekst(e), soort: 'fout' });
  async function bewaar(e: FormEvent) {
    e.preventDefault();
    try {
      await api('PATCH', `/klanten/${id}`, { naam: bewerk.naam, status: bewerk.status, accountmanagerId: bewerk.accountmanagerId || null, omschrijving: bewerk.omschrijving, contractEinde: bewerk.contractEinde || null });
      setMelding({ tekst: 'Opgeslagen.', soort: 'ok' }); kaart.ververs();
    } catch (er) { fout(er); }
  }
  async function bevestig(status: 'klant' | 'prospect') {
    try { await api('POST', `/klanten/${id}/controle`, { besluit: 'goedkeuren', status }); setMelding(null); kaart.ververs(); } catch (er) { fout(er); }
  }
  async function voegSamen() {
    if (!samenvoegMet || !confirm('Alle bezoeken, activiteiten en contactpersonen van deze klant verplaatsen naar de gekozen klant? Deze klant verdwijnt.')) return;
    try { await api('POST', `/klanten/${id}/controle`, { besluit: 'samenvoegen', met: samenvoegMet }); navigeer(`/klanten/${samenvoegMet}`); } catch (er) { fout(er); }
  }
  async function wis() {
    if (!confirm('Deze klant wissen, met alle bezoeken, activiteiten en contactpersonen? Dit kan niet ongedaan worden gemaakt.')) return;
    try { await api('DELETE', `/klanten/${id}`); navigeer('/klanten'); } catch (er) { fout(er); }
  }
  async function voegContactToe(e: FormEvent) {
    e.preventDefault();
    try { await api('POST', `/klanten/${id}/contacten`, contact); setContact({ naam: '', functie: '', rol: '' }); kaart.ververs(); } catch (er) { fout(er); }
  }
  async function wisContact(cid: string) {
    try { await api('DELETE', `/klant-contacten/${cid}`); kaart.ververs(); } catch (er) { fout(er); }
  }
  async function zet(aid: string, status: 'open' | 'afgerond') {
    try { await api('PATCH', `/activiteiten/${aid}`, { status: status === 'open' ? 'afgerond' : 'open' }); kaart.ververs(); } catch (er) { fout(er); }
  }

  if (kaart.fout) return <div className="stapel"><Melding tekst={kaart.fout} /><Link to="/klanten">Terug naar klanten</Link></div>;
  if (!kaart.data || !k) return null;
  const naamVan = (aid: string | null) => medewerkers.data?.find((m) => m.id === aid)?.naam;
  const andere = (klanten.data ?? []).filter((x) => x.id !== id);

  return (
    <div className="stapel">
      <div><Link to="/klanten">← Klanten</Link><h1>{k.naam} <Badge soort={k.status === 'voorgesteld' ? 'wacht' : ''}>{KLANT_STATUS_LABEL[k.status]}</Badge></h1></div>
      {k.status === 'voorgesteld' && (
        <section className="paneel stapel" aria-label="Klant bevestigen">
          <h2>Bevestig deze klant</h2>
          <p className="zacht klein">Deze klant is door een gesprek voorgesteld. Is het een bestaande klant onder een andere naam? Voeg hem dan samen om dubbelen te voorkomen.</p>
          <div className="rij">
            <button type="button" className="primair" onClick={() => void bevestig('klant')}>Is een klant</button>
            <button type="button" onClick={() => void bevestig('prospect')}>Is een prospect</button>
          </div>
          <div className="rij">
            <select aria-label="Samenvoegen met" value={samenvoegMet} onChange={(e) => setSamenvoegMet(e.target.value)}>
              <option value="">Samenvoegen met…</option>
              {andere.map((x) => <option key={x.id} value={x.id}>{x.naam}</option>)}
            </select>
            <button type="button" onClick={() => void voegSamen()} disabled={!samenvoegMet}>Samenvoegen</button>
          </div>
        </section>
      )}
      <Melding tekst={melding?.tekst ?? null} soort={melding?.soort} />

      <section className="paneel stapel" aria-label="Activiteiten">
        <h2>Tijdlijn</h2>
        {kaart.data.bezoeken.length === 0 && kaart.data.activiteiten.length === 0 && <Leeg>Nog geen bezoeken.</Leeg>}
        {kaart.data.bezoeken.map((b) => {
          const acts = kaart.data!.activiteiten.filter((a) => a.bezoekId === b.id);
          return (
            <div key={b.id} className="stapel">
              <h3>{b.datum ? datum(b.datum) : datum(b.createdAt)} · {b.soort || 'bezoek'}{b.tevredenheid !== null && <> · tevredenheid <Badge>{b.tevredenheid}/10</Badge></>}</h3>
              <span className="zacht klein">{b.accountmanagerNaam ? `Gemeld door ${b.accountmanagerNaam}` : 'Gemeld door een accountmanager'}</span>
              {b.samenvatting && <p>{b.samenvatting}</p>}
              {acts.map((a) => (
                <div key={a.id} className={`punt ${a.status === 'afgerond' ? 'klaar' : ''}`}>
                  <input type="checkbox" checked={a.status === 'afgerond'} onChange={() => void zet(a.id, a.status)} aria-label={`Afgerond: ${a.omschrijving}`} />
                  <span style={{ flex: 1, minWidth: 180 }}><Badge>{SOORT_LABEL[a.soort]}</Badge> {a.omschrijving}<Details a={a} />{a.controleNodig && <><br /><span className="zacht klein">Wacht op controle bij het Verkoopregister.</span></>}</span>
                  {(a.eigenaarId || a.eigenaarExtern) && <span className="zacht klein">{naamVan(a.eigenaarId) ?? `${a.eigenaarExtern} (extern)`}</span>}
                  {a.deadline && <Badge>{deadlineTekst(a.deadline)}</Badge>}
                </div>
              ))}
            </div>
          );
        })}
      </section>

      <section className="paneel stapel" aria-label="Contactpersonen">
        <h2>Contactpersonen</h2>
        <p className="zacht klein">Alleen naam, functie en rol. Geen privégegevens.</p>
        {kaart.data.contacten.length === 0 && <Leeg>Nog geen contactpersonen.</Leeg>}
        {kaart.data.contacten.map((c) => (
          <div key={c.id} className="punt">
            <span style={{ flex: 1 }}>{c.naam} <span className="zacht klein">{[c.functie, c.rol].filter(Boolean).join(' · ')}</span></span>
            <button type="button" onClick={() => void wisContact(c.id)}>Verwijderen</button>
          </div>
        ))}
        <form className="rij" onSubmit={voegContactToe}>
          <input value={contact.naam} onChange={(e) => setContact({ ...contact, naam: e.target.value })} placeholder="Naam" required maxLength={100} aria-label="Naam contactpersoon" />
          <input value={contact.functie} onChange={(e) => setContact({ ...contact, functie: e.target.value })} placeholder="Functie" maxLength={100} aria-label="Functie" />
          <input value={contact.rol} onChange={(e) => setContact({ ...contact, rol: e.target.value })} placeholder="Rol (bijv. beslisser)" maxLength={100} aria-label="Rol" />
          <button type="submit">Toevoegen</button>
        </form>
      </section>

      <form className="paneel stapel" onSubmit={bewaar}>
        <h2>Klantgegevens</h2>
        <div className="raster">
          <Veld label="Naam"><input value={bewerk.naam} onChange={(e) => setBewerk({ ...bewerk, naam: e.target.value })} required maxLength={200} /></Veld>
          <Veld label="Status">
            <select value={bewerk.status} onChange={(e) => setBewerk({ ...bewerk, status: e.target.value as KlantStatus })}>
              {(Object.keys(KLANT_STATUS_LABEL) as KlantStatus[]).map((s) => <option key={s} value={s}>{KLANT_STATUS_LABEL[s]}</option>)}
            </select>
          </Veld>
          <Veld label="Accountmanager">
            <select value={bewerk.accountmanagerId} onChange={(e) => setBewerk({ ...bewerk, accountmanagerId: e.target.value })}>
              <option value="">Geen</option>
              {medewerkers.data?.filter((m) => m.rol === 'accountmanager').map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
            </select>
          </Veld>
          <Veld label="Contract tot"><input type="date" value={bewerk.contractEinde} onChange={(e) => setBewerk({ ...bewerk, contractEinde: e.target.value })} /></Veld>
        </div>
        <Veld label="Omschrijving"><textarea value={bewerk.omschrijving} onChange={(e) => setBewerk({ ...bewerk, omschrijving: e.target.value })} maxLength={2000} /></Veld>
        <div className="rij">
          <button className="primair" type="submit">Opslaan</button>
          <button type="button" className="gevaar" onClick={() => void wis()}>Klant wissen</button>
        </div>
      </form>
    </div>
  );
}
