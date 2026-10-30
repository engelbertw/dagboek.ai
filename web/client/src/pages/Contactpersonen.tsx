import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type ContactRegel, type KlantRegel } from '../api';
import { Leeg, Melding, Veld, foutTekst, useLaden } from '../ui';

type Waarden = { naam: string; functie: string; rol: string; email: string; telefoon: string; klantId: string };
const NIEUW: Waarden = { naam: '', functie: '', rol: '', email: '', telefoon: '', klantId: '' };

function Formulier({ waarden, zet, klanten, opslaan, annuleer, knop }: {
  waarden: Waarden; zet: (w: Waarden) => void; klanten: KlantRegel[]; opslaan: (e: FormEvent) => void; annuleer: () => void; knop: string;
}) {
  return (
    <form className="stapel" onSubmit={opslaan}>
      <div className="raster">
        <Veld label="Naam"><input value={waarden.naam} onChange={(e) => zet({ ...waarden, naam: e.target.value })} required maxLength={100} /></Veld>
        <Veld label="Klant">
          <select value={waarden.klantId} onChange={(e) => zet({ ...waarden, klantId: e.target.value })} required>
            <option value="" disabled>Kies een klant</option>
            {klanten.map((k) => <option key={k.id} value={k.id}>{k.naam}</option>)}
          </select>
        </Veld>
        <Veld label="Functie"><input value={waarden.functie} onChange={(e) => zet({ ...waarden, functie: e.target.value })} maxLength={100} /></Veld>
        <Veld label="Rol"><input value={waarden.rol} onChange={(e) => zet({ ...waarden, rol: e.target.value })} maxLength={100} placeholder="bijv. beslisser" /></Veld>
        <Veld label="E-mailadres"><input type="email" value={waarden.email} onChange={(e) => zet({ ...waarden, email: e.target.value })} maxLength={200} /></Veld>
        <Veld label="Telefoon"><input value={waarden.telefoon} onChange={(e) => zet({ ...waarden, telefoon: e.target.value })} maxLength={30} /></Veld>
      </div>
      <div className="rij"><button className="primair" type="submit">{knop}</button><button type="button" onClick={annuleer}>Annuleren</button></div>
    </form>
  );
}

export function Contactpersonen() {
  const lijst = useLaden(() => api<ContactRegel[]>('GET', '/klant-contacten'));
  const klanten = useLaden(() => api<KlantRegel[]>('GET', '/klanten'));
  const [zoek, setZoek] = useState('');
  const [bewerk, setBewerk] = useState<{ id: string | null; waarden: Waarden } | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const q = zoek.trim().toLowerCase();
  const zichtbaar = (lijst.data ?? []).filter((c) => !q || `${c.naam} ${c.functie} ${c.rol} ${c.email} ${c.telefoon} ${c.klantNaam}`.toLowerCase().includes(q));

  async function bewaar(e: FormEvent) {
    e.preventDefault();
    if (!bewerk) return;
    try {
      await api(bewerk.id ? 'PATCH' : 'POST', bewerk.id ? `/klant-contacten/${bewerk.id}` : '/klant-contacten', bewerk.waarden);
      setBewerk(null); setFout(null); lijst.ververs();
    } catch (err) { setFout(foutTekst(err)); }
  }
  async function wis(c: ContactRegel) {
    if (!window.confirm(`${c.naam} (${c.klantNaam}) verwijderen?`)) return;
    try { await api('DELETE', `/klant-contacten/${c.id}`); setFout(null); lijst.ververs(); } catch (err) { setFout(foutTekst(err)); }
  }

  return (
    <div className="stapel">
      <div className="rij spreid">
        <div><h1>Contactpersonen</h1><p className="zacht">Alle contactpersonen van de klanten, met functie, rol en zakelijke contactgegevens. Bewerk, verplaats naar een andere klant of verwijder.</p></div>
        <button className="primair" onClick={() => setBewerk(bewerk?.id === null ? null : { id: null, waarden: NIEUW })}>{bewerk?.id === null ? 'Annuleren' : 'Contactpersoon toevoegen'}</button>
      </div>
      <Melding tekst={fout ?? lijst.fout} />
      {bewerk?.id === null && (
        <section className="paneel stapel" aria-label="Contactpersoon toevoegen">
          <Formulier waarden={bewerk.waarden} zet={(w) => setBewerk({ id: null, waarden: w })} klanten={klanten.data ?? []} opslaan={(e) => void bewaar(e)} annuleer={() => setBewerk(null)} knop="Toevoegen" />
        </section>
      )}
      <Veld label="Zoeken"><input type="search" value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Naam, klant, functie, e-mail of telefoon" /></Veld>
      <p className="zacht klein">{zichtbaar.length} van {lijst.data?.length ?? 0} contactpersonen</p>
      {lijst.data?.length === 0 && <Leeg>Nog geen contactpersonen. Importeer een lijst bij Klanten of voeg er hier een toe.</Leeg>}
      {zichtbaar.map((c) => (
        <div key={c.id} className="paneel stapel">
          {bewerk?.id === c.id ? (
            <Formulier waarden={bewerk.waarden} zet={(w) => setBewerk({ id: c.id, waarden: w })} klanten={klanten.data ?? []} opslaan={(e) => void bewaar(e)} annuleer={() => setBewerk(null)} knop="Opslaan" />
          ) : (
            <div className="rij spreid">
              <div>
                <h3>{c.naam}</h3>
                <span className="zacht klein">
                  <Link to={`/klanten/${c.klantId}`}>{c.klantNaam}</Link>
                  {[c.functie, c.rol].filter(Boolean).map((x) => ` · ${x}`)}
                </span>
                <div className="klein">
                  {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}{c.email && c.telefoon && ' · '}{c.telefoon && <a href={`tel:${c.telefoon.replace(/[^+\d]/g, '')}`}>{c.telefoon}</a>}
                </div>
              </div>
              <div className="rij">
                <button type="button" onClick={() => setBewerk({ id: c.id, waarden: { naam: c.naam, functie: c.functie, rol: c.rol, email: c.email, telefoon: c.telefoon, klantId: c.klantId } })}>Bewerken</button>
                <button type="button" className="gevaar" onClick={() => void wis(c)}>Verwijderen</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
