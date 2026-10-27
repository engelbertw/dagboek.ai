import { useState, type FormEvent } from 'react';
import { DAGEN, api, datum, type Medewerker, type Schema } from '../api';
import { Badge, Leeg, Melding, Veld, foutTekst, useLaden } from '../ui';

function Schemas({ medewerker }: { medewerker: Medewerker }) {
  const lijst = useLaden(() => api<Schema[]>('GET', `/employees/${medewerker.id}/schedules`), [medewerker.id]);
  const [dagen, setDagen] = useState<number[]>([1, 2, 3, 4, 5]);
  const [tijd, setTijd] = useState('09:30');
  const [fout, setFout] = useState<string | null>(null);

  async function voegToe(e: FormEvent) {
    e.preventDefault();
    try { await api('POST', `/employees/${medewerker.id}/schedules`, { dagen, tijden: [tijd] }); setFout(null); lijst.ververs(); } catch (err) { setFout(foutTekst(err)); }
  }
  return (
    <div className="stapel">
      <h3>Wanneer bellen?</h3>
      <p className="zacht klein">Het schema wordt opgeslagen. Automatisch bellen volgens dit schema komt in de volgende stap; tot die tijd gebruik je ‘Bel nu’.</p>
      {lijst.data?.length === 0 && <Leeg>Nog geen schema.</Leeg>}
      {lijst.data?.map((s) => (
        <div key={s.id} className="rij spreid">
          <span>{s.dagen.map((d) => DAGEN[d - 1]).join(' ')} om {s.tijden.join(', ') || '—'} {!s.actief && <Badge>uit</Badge>}</span>
          <div className="rij">
            <button className="tekstknop" onClick={async () => { await api('PATCH', `/schedules/${s.id}`, { actief: !s.actief }); lijst.ververs(); }}>{s.actief ? 'Uitzetten' : 'Aanzetten'}</button>
            <button className="tekstknop gevaar" onClick={async () => { await api('DELETE', `/schedules/${s.id}`); lijst.ververs(); }}>Verwijderen</button>
          </div>
        </div>
      ))}
      <form className="rij" onSubmit={voegToe}>
        <div className="dagen" role="group" aria-label="Dagen">
          {DAGEN.map((naam, i) => (
            <label key={naam}><input type="checkbox" checked={dagen.includes(i + 1)} onChange={(e) => setDagen(e.target.checked ? [...dagen, i + 1] : dagen.filter((d) => d !== i + 1))} />{naam}</label>
          ))}
        </div>
        <input type="time" value={tijd} onChange={(e) => setTijd(e.target.value)} aria-label="Tijd" style={{ width: 'auto' }} required />
        <button type="submit" disabled={!dagen.length}>Schema toevoegen</button>
      </form>
      <Melding tekst={fout} />
    </div>
  );
}

function MedewerkerKaart({ m, ververs }: { m: Medewerker; ververs: () => void }) {
  const [open, setOpen] = useState(false);
  const [bewerk, setBewerk] = useState({ naam: m.naam, telefoon: m.telefoon, email: m.email, locgovGebruikersnaam: m.locgovGebruikersnaam, notitie: m.notitie });
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  const [bezig, setBezig] = useState(false);

  const wijzig = async (body: object) => { try { await api('PATCH', `/employees/${m.id}`, body); setMelding(null); ververs(); } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); } };

  async function bel() {
    if (!confirm(`${m.naam} nu bellen op ${m.telefoon}?`)) return;
    setBezig(true);
    try {
      const r = await api<{ onderwerpen: number }>('POST', `/employees/${m.id}/bel`);
      setMelding({ tekst: `Gesprek gestart. ${r.onderwerpen} ${r.onderwerpen === 1 ? 'onderwerp' : 'onderwerpen'} meegegeven. Zie Gesprekken voor de uitkomst.`, soort: 'ok' });
    } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); } finally { setBezig(false); }
  }
  async function wis() {
    if (!confirm(`${m.naam} verwijderen, inclusief gespreksgeschiedenis? Onderwerpen blijven bestaan, maar zonder gekoppelde medewerker.`)) return;
    try { await api('DELETE', `/employees/${m.id}`); ververs(); } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); }
  }

  return (
    <div className="paneel stapel">
      <div className="rij spreid">
        <div><h3>{m.naam} {!m.actief && <Badge>niet actief</Badge>}</h3><span className="zacht klein">{m.telefoon}{m.email && ` · ${m.email}`}{m.locgovGebruikersnaam && ` · ${m.locgovGebruikersnaam}@LOCGOV.NL`}</span></div>
        <div className="rij">
          <button className="primair" onClick={bel} disabled={bezig || !m.actief}>{bezig ? 'Bezig…' : 'Bel nu'}</button>
          <button onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Sluiten' : 'Instellingen'}</button>
        </div>
      </div>
      <label className="rij">
        <input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={!!m.toestemmingOp} onChange={(e) => wijzig({ toestemming: e.target.checked })} />
        <span>Heeft toestemming gegeven voor het bewaren van gesprekssamenvattingen{m.toestemmingOp && <span className="zacht klein"> (sinds {datum(m.toestemmingOp)})</span>}</span>
      </label>
      {open && (
        <form className="stapel" onSubmit={(e) => { e.preventDefault(); void wijzig(bewerk); }}>
          <div className="raster">
            <Veld label="Naam"><input value={bewerk.naam} onChange={(e) => setBewerk({ ...bewerk, naam: e.target.value })} required /></Veld>
            <Veld label="Telefoonnummer"><input value={bewerk.telefoon} onChange={(e) => setBewerk({ ...bewerk, telefoon: e.target.value })} required /></Veld>
          </div>
          <Veld label="E-mailadres"><input type="email" value={bewerk.email} onChange={(e) => setBewerk({ ...bewerk, email: e.target.value })} /></Veld>
          <Veld label="LOCGOV-gebruikersnaam (account wordt gebruikersnaam@LOCGOV.NL)"><input value={bewerk.locgovGebruikersnaam} onChange={(e) => setBewerk({ ...bewerk, locgovGebruikersnaam: e.target.value })} pattern="[A-Za-z0-9._\-]{1,64}" /></Veld>
          <Veld label="Notitie"><textarea value={bewerk.notitie} onChange={(e) => setBewerk({ ...bewerk, notitie: e.target.value })} /></Veld>
          <div className="rij">
            <button className="primair" type="submit">Opslaan</button>
            <button type="button" onClick={() => wijzig({ actief: !m.actief })}>{m.actief ? 'Op niet actief zetten' : 'Weer actief maken'}</button>
            <button type="button" className="gevaar" onClick={wis}>Verwijderen</button>
          </div>
          <Schemas medewerker={m} />
        </form>
      )}
      {melding && <Melding tekst={melding.tekst} soort={melding.soort} />}
    </div>
  );
}

export function Medewerkers() {
  const lijst = useLaden(() => api<Medewerker[]>('GET', '/employees'));
  const [nieuw, setNieuw] = useState<{ naam: string; telefoon: string; email: string } | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  async function maakAan(e: FormEvent) {
    e.preventDefault();
    try { await api('POST', '/employees', nieuw); setNieuw(null); setFout(null); lijst.ververs(); } catch (err) { setFout(foutTekst(err)); }
  }
  return (
    <div className="stapel">
      <div className="rij spreid">
        <div><h1>Medewerkers</h1><p className="zacht">Collega’s die we bellen voor een update.</p></div>
        <button className="primair" onClick={() => setNieuw(nieuw ? null : { naam: '', telefoon: '', email: '' })}>{nieuw ? 'Annuleren' : 'Nieuwe medewerker'}</button>
      </div>
      {nieuw && (
        <form className="paneel stapel" onSubmit={maakAan}>
          <div className="raster">
            <Veld label="Naam"><input value={nieuw.naam} onChange={(e) => setNieuw({ ...nieuw, naam: e.target.value })} required /></Veld>
            <Veld label="Mobiel nummer (bijvoorbeeld 06 12345678)"><input type="tel" value={nieuw.telefoon} onChange={(e) => setNieuw({ ...nieuw, telefoon: e.target.value })} required /></Veld>
            <Veld label="E-mailadres (niet verplicht)"><input type="email" value={nieuw.email} onChange={(e) => setNieuw({ ...nieuw, email: e.target.value })} /></Veld>
          </div>
          <Melding tekst={fout} />
          <button className="primair" type="submit">Toevoegen</button>
        </form>
      )}
      <Melding tekst={lijst.fout} />
      {lijst.data?.length === 0 && <Leeg>Nog geen medewerkers.</Leeg>}
      {lijst.data?.map((m) => <MedewerkerKaart key={m.id} m={m} ververs={lijst.ververs} />)}
    </div>
  );
}
