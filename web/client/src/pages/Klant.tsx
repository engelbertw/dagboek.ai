import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { KLANT_STATUS_LABEL, api, apiToevoegenZonderDubbel, datum, linkedInZoekUrl, type Activiteit, type TopicRegel, type KlantDetail, type KlantRegel, type KlantStatus, type GebruikersRol, type Medewerker } from '../api';
import { Badge, Leeg, Melding, Veld, foutTekst, useLaden } from '../ui';
import { ControleBanner, PuntToevoegen, Secties, useActies } from './ActiviteitenLijst';

export function Klant({ rol = 'beheerder' }: { rol?: GebruikersRol }) {
  // Administratie past alleen inwoners aan en ziet het werkregister niet; de accountmanager past inwoners niet aan (de server dwingt dat af).
  const administratie = rol === 'administratie';
  const consultant = rol === 'consultant'; // alleen lezen; de server weigert elke wijziging
  const magInwoners = rol === 'beheerder' || administratie;
  const magAnder = rol === 'beheerder' || rol === 'accountmanager';
  const { id } = useParams();
  const navigeer = useNavigate();
  const kaart = useLaden(() => api<KlantDetail>('GET', `/klanten/${id}`), [id]);
  const medewerkers = useLaden(() => api<Medewerker[]>('GET', '/employees'));
  const klanten = useLaden(() => api<KlantRegel[]>('GET', '/klanten'));
  const onderwerpen = useLaden(() => (administratie ? Promise.resolve([] as TopicRegel[]) : api<TopicRegel[]>('GET', '/topics?status=alle')));
  const punten = useLaden(() => (administratie ? Promise.resolve([] as Activiteit[]) : api<Activiteit[]>('GET', `/activiteiten?klantId=${id}`)), [id]);
  const acties = useActies(() => { void punten.ververs(); void kaart.ververs(); }, punten.data ?? [], consultant);
  const [bewerk, setBewerk] = useState({ naam: '', status: 'klant' as KlantStatus, accountmanagerId: '', omschrijving: '', contractEinde: '', samenwerkingsverband: '', inwoners: '' });
  const [samenvoegMet, setSamenvoegMet] = useState('');
  const [contact, setContact] = useState({ naam: '', functie: '', rol: '', email: '', telefoon: '' });
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  const k = kaart.data?.klant;
  useEffect(() => {
    if (k) setBewerk({ naam: k.naam, status: k.status, accountmanagerId: k.accountmanagerId ?? '', omschrijving: k.omschrijving, contractEinde: k.contractEinde ?? '', samenwerkingsverband: k.samenwerkingsverband, inwoners: k.inwoners === null ? '' : String(k.inwoners) });
  }, [k]);

  const fout = (e: unknown) => setMelding({ tekst: foutTekst(e), soort: 'fout' });
  async function bewaar(e: FormEvent) {
    e.preventDefault();
    try {
      await api('PATCH', `/klanten/${id}`, { naam: bewerk.naam, status: bewerk.status, accountmanagerId: bewerk.accountmanagerId || null, omschrijving: bewerk.omschrijving, contractEinde: bewerk.contractEinde || null, samenwerkingsverband: bewerk.samenwerkingsverband, inwoners: bewerk.inwoners.trim() ? Number(bewerk.inwoners) : null });
      setMelding({ tekst: 'Opgeslagen.', soort: 'ok' }); kaart.ververs();
    } catch (er) { fout(er); }
  }
  async function wisBezoek(bezoekId: string) {
    const n = kaart.data?.activiteiten.filter((a) => a.bezoekId === bezoekId).length ?? 0;
    if (!window.confirm(`Dit verwijdert het bezoek en ${n} bijbehorende ${n === 1 ? 'punt' : 'punten'}. Dit kan niet worden teruggedraaid.`)) return;
    try { await api('DELETE', `/bezoeken/${bezoekId}`); setMelding(null); kaart.ververs(); punten.ververs(); } catch (er) { fout(er); }
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
    try { if (await apiToevoegenZonderDubbel(`/klanten/${id}/contacten`, contact)) { setContact({ naam: '', functie: '', rol: '', email: '', telefoon: '' }); kaart.ververs(); } } catch (er) { fout(er); }
  }
  async function wisContact(cid: string) {
    try { await api('DELETE', `/klant-contacten/${cid}`); kaart.ververs(); } catch (er) { fout(er); }
  }

  if (kaart.fout) return <div className="stapel"><Melding tekst={kaart.fout} /><Link to="/klanten">Terug naar klanten</Link></div>;
  if (!kaart.data || !k) return null;
  const andere = (klanten.data ?? []).filter((x) => x.id !== id);

  return (
    <div className="stapel">
      <div><Link to="/klanten">← Klanten</Link><h1>{k.naam} <Badge soort={k.status === 'voorgesteld' ? 'wacht' : ''}>{KLANT_STATUS_LABEL[k.status]}</Badge></h1><Link to={`/klanten/${k.id}/voorbereiding`}>Bereid bezoek voor →</Link> {!administratie && <> · <Link to={`/samenverder?klant=${k.id}`}>SamenVerder</Link> · <Link to={`/dagboek?klant=${k.id}`}>Dagboek</Link></>} · <Link to={`/kwaliteit?klant=${k.id}`}>Kwaliteit</Link></div>
      {k.status === 'voorgesteld' && !consultant && (
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

      {!administratie && <section className="paneel stapel" aria-label="Werk">
        <h2>Werk</h2>
        <Melding tekst={acties.fout ?? punten.fout} />
        {acties.jiraPaneel}
        <ControleBanner punten={(punten.data ?? []).filter((p) => p.controleNodig)} acties={acties} />
        {(punten.data ?? []).filter((p) => !p.controleNodig && p.status === 'open').length === 0 && <Leeg>Geen open punten.</Leeg>}
        <Secties punten={(punten.data ?? []).filter((p) => !p.controleNodig && p.status === 'open')} acties={acties} medewerkers={medewerkers.data ?? []} />
        {(punten.data ?? []).some((p) => p.status === 'afgerond') && (
          <details className="werk-sectie"><summary>Afgerond <span className="zacht">({(punten.data ?? []).filter((p) => p.status === 'afgerond').length})</span></summary>
            <Secties punten={(punten.data ?? []).filter((p) => p.status === 'afgerond')} acties={acties} medewerkers={medewerkers.data ?? []} />
          </details>
        )}
        {!consultant && <PuntToevoegen acties={acties} medewerkers={medewerkers.data ?? []} vast={{ klantId: id }} />}
      </section>}

      {(onderwerpen.data ?? []).some((t) => t.klantId === id) && (
        <section className="paneel stapel" aria-label="Onderwerpen in het dagboek">
          <h2>Onderwerpen in het dagboek</h2>
          {(onderwerpen.data ?? []).filter((t) => t.klantId === id).map((t) => (
            <div key={t.id} className="rij spreid">
              <span><Link to={`/onderwerp/${t.id}`}>{t.titel}</Link> <span className="zacht klein">{[t.type, t.status, t.eigenaarNaam && `bellen: ${t.eigenaarNaam}`].filter(Boolean).join(' · ')}</span></span>
              <span className="zacht klein">{t.openPunten} open</span>
            </div>
          ))}
        </section>
      )}

      <section className="paneel stapel" aria-label="Bezoeken">
        <h2>Bezoeken</h2>
        {kaart.data.bezoeken.length === 0 && <Leeg>Nog geen bezoeken.</Leeg>}
        {kaart.data.bezoeken.map((b) => (
          <div key={b.id} className="stapel">
            <h3>{b.datum ? datum(b.datum) : datum(b.createdAt)} · {b.soort || 'bezoek'}{b.tevredenheid !== null && <> · tevredenheid <Badge>{b.tevredenheid}/10</Badge></>}</h3>
            <span className="zacht klein">{b.accountmanagerNaam ? `Gemeld door ${b.accountmanagerNaam}` : 'Gemeld door een accountmanager'}</span>
            {b.samenvatting && <p>{b.samenvatting}</p>}
            {rol === 'beheerder' && <div><button type="button" onClick={() => void wisBezoek(b.id)}>Verwijderen</button></div>}
          </div>
        ))}
      </section>

      <section className="paneel stapel" aria-label="Contactpersonen">
        <h2>Contactpersonen</h2>
        <p className="zacht klein">Naam, functie, rol en zakelijke contactgegevens (e-mail, telefoon). Geen privégegevens.</p>
        {kaart.data.contacten.length === 0 && <Leeg>Nog geen contactpersonen.</Leeg>}
        {kaart.data.contacten.map((c) => (
          <div key={c.id} className="punt">
            <span style={{ flex: 1 }}>{c.naam} <span className="zacht klein">{[c.functie, c.rol, c.email, c.telefoon].filter(Boolean).join(' · ')}</span></span>
            {!consultant && <button type="button" onClick={() => void wisContact(c.id)}>Verwijderen</button>}
          </div>
        ))}
        {!consultant && <form className="rij" onSubmit={voegContactToe}>
          <input value={contact.naam} onChange={(e) => setContact({ ...contact, naam: e.target.value })} placeholder="Naam" required maxLength={100} aria-label="Naam contactpersoon" />
          <input value={contact.functie} onChange={(e) => setContact({ ...contact, functie: e.target.value })} placeholder="Functie" maxLength={100} aria-label="Functie" />
          <input value={contact.rol} onChange={(e) => setContact({ ...contact, rol: e.target.value })} placeholder="Rol (bijv. beslisser)" maxLength={100} aria-label="Rol" />
          <input type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} placeholder="E-mailadres" maxLength={200} aria-label="E-mailadres" />
          <input value={contact.telefoon} onChange={(e) => setContact({ ...contact, telefoon: e.target.value })} placeholder="Telefoon" maxLength={30} aria-label="Telefoon" />
          <button type="submit">Toevoegen</button>
        </form>}
      </section>

      <form className="paneel stapel" onSubmit={bewaar}>
        <h2>Klantgegevens</h2>
        <div className="raster">
          <Veld label="Naam"><input value={bewerk.naam} onChange={(e) => setBewerk({ ...bewerk, naam: e.target.value })} required maxLength={200} disabled={!magAnder} /></Veld>
          <Veld label="Status">
            <select value={bewerk.status} disabled={!magAnder} onChange={(e) => setBewerk({ ...bewerk, status: e.target.value as KlantStatus })}>
              {(Object.keys(KLANT_STATUS_LABEL) as KlantStatus[]).map((s) => <option key={s} value={s}>{KLANT_STATUS_LABEL[s]}</option>)}
            </select>
          </Veld>
          <Veld label="Accountmanager">
            <select value={bewerk.accountmanagerId} disabled={!magAnder} onChange={(e) => setBewerk({ ...bewerk, accountmanagerId: e.target.value })}>
              <option value="">Geen</option>
              {medewerkers.data?.filter((m) => m.rol === 'accountmanager').map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
            </select>
          </Veld>
          <Veld label="Contract tot"><input type="date" value={bewerk.contractEinde} disabled={!magAnder} onChange={(e) => setBewerk({ ...bewerk, contractEinde: e.target.value })} /></Veld>
          <Veld label="Samenwerkingsverband"><input value={bewerk.samenwerkingsverband} onChange={(e) => setBewerk({ ...bewerk, samenwerkingsverband: e.target.value })} maxLength={200} disabled={!magAnder} /></Veld>
          <Veld label="Inwoners"><input type="number" min={0} value={bewerk.inwoners} onChange={(e) => setBewerk({ ...bewerk, inwoners: e.target.value })} disabled={!magInwoners} title={magInwoners ? undefined : 'Alleen administratie of beheer past het aantal inwoners aan'} /></Veld>
        </div>
        <Veld label="Omschrijving"><textarea value={bewerk.omschrijving} disabled={!magAnder} onChange={(e) => setBewerk({ ...bewerk, omschrijving: e.target.value })} maxLength={2000} /></Veld>
        {!consultant && <div className="rij">
          <button className="primair" type="submit">Opslaan</button>
          {rol === 'beheerder' && <button type="button" className="gevaar" onClick={() => void wis()}>Klant wissen</button>}
        </div>}
      </form>
    </div>
  );
}
