import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, datum, MOTOR_LABEL, type Medewerker, type Motor } from '../api';
import { Badge, Leeg, Melding, Veld, foutTekst, useLaden } from '../ui';

function Overzichtsrol({ m, heeft, ververs }: { m: Medewerker; heeft: boolean; ververs: () => void }) {
  const [codewoord, setCodewoord] = useState('');
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  // Geen eigen <form>: dit blok staat binnen het formulier met de gegevens van de medewerker en formulieren mogen niet genest worden.
  async function bewaar() {
    try { await api('PUT', `/employees/${m.id}/overzicht`, { codewoord }); setCodewoord(''); setMelding({ tekst: 'Codewoord opgeslagen.', soort: 'ok' }); ververs(); } catch (er) { setMelding({ tekst: foutTekst(er), soort: 'fout' }); }
  }
  async function intrekken() {
    try { await api('DELETE', `/employees/${m.id}/overzicht`); setMelding(null); ververs(); } catch (er) { setMelding({ tekst: foutTekst(er), soort: 'fout' }); }
  }
  return (
    <div className="stapel">
      <h4>Overzicht via de telefoon {heeft && <Badge>aan</Badge>}</h4>
      <p className="zacht klein">Een medewerker met overzichtsrol mag bij inbellen de punten van collega’s opvragen en een aandachtspunt toevoegen, na het noemen van dit codewoord (3 pogingen per gesprek). Het codewoord wordt alleen als hash bewaard; kies een woord of zin van minstens 6 letters of cijfers. Een toegevoegd aandachtspunt komt eerst bij Acties ter controle.</p>
      <div className="rij">
        <input type="password" autoComplete="new-password" placeholder={heeft ? 'Nieuw codewoord' : 'Codewoord'} value={codewoord} onChange={(e) => setCodewoord(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (codewoord.trim().length >= 6) void bewaar(); } }} />
        <button type="button" onClick={() => void bewaar()} disabled={codewoord.trim().length < 6}>{heeft ? 'Codewoord wijzigen' : 'Overzichtsrol aanzetten'}</button>
        {heeft && <button type="button" onClick={intrekken}>Rol intrekken</button>}
      </div>
      {melding && <Melding tekst={melding.tekst} soort={melding.soort} />}
    </div>
  );
}

function MedewerkerKaart({ m, ververs, overzicht }: { m: Medewerker; ververs: () => void; overzicht: { heeft: boolean; ververs: () => void } }) {
  const [open, setOpen] = useState(false);
  const [bewerk, setBewerk] = useState({ naam: m.naam, telefoon: m.telefoon, email: m.email, locgovGebruikersnaam: m.locgovGebruikersnaam, notitie: m.notitie });
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  const [bezig, setBezig] = useState(false);
  const sleutel = `motor-${m.id}`;
  const [motor, setMotorState] = useState<'' | Motor>(() => { try { return (localStorage.getItem(sleutel) as '' | Motor | null) ?? ''; } catch { return ''; } });
  const setMotor = (k: '' | Motor) => { setMotorState(k); try { k ? localStorage.setItem(sleutel, k) : localStorage.removeItem(sleutel); } catch { /* alleen een gemak */ } };

  const wijzig = async (body: object) => { try { await api('PATCH', `/employees/${m.id}`, body); setMelding(null); ververs(); } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); } };

  async function bel() {
    if (!confirm(`${m.naam} nu bellen op ${m.telefoon}?`)) return;
    setBezig(true);
    try {
      const r = await api<{ onderwerpen: number }>('POST', `/employees/${m.id}/bel`, motor ? { motor } : {});
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
          <select aria-label="Gespreksmotor voor dit gesprek" value={motor} onChange={(e) => setMotor(e.target.value as '' | Motor)}>
            <option value="">Motor: standaard (zie Instellingen)</option>
            {(Object.keys(MOTOR_LABEL) as Motor[]).map((k) => <option key={k} value={k}>{MOTOR_LABEL[k]}</option>)}
          </select>
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
          <Overzichtsrol m={m} heeft={overzicht.heeft} ververs={overzicht.ververs} />
          <p className="zacht klein">Wanneer deze collega wordt gebeld, stel je in onder <Link to="/planning">Planning</Link>.</p>
        </form>
      )}
      {melding && <Melding tekst={melding.tekst} soort={melding.soort} />}
    </div>
  );
}

export function Medewerkers() {
  const lijst = useLaden(() => api<Medewerker[]>('GET', '/employees'));
  const rollen = useLaden(() => api<string[]>('GET', '/overzicht-toegang'));
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
      {lijst.data?.map((m) => <MedewerkerKaart key={m.id} m={m} ververs={lijst.ververs} overzicht={{ heeft: !!rollen.data?.includes(m.id), ververs: rollen.ververs }} />)}
    </div>
  );
}
