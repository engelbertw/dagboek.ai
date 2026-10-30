import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Badge, Leeg, Melding, Veld, foutTekst, useLaden } from '../ui';

type GebruikersRol = 'beheerder' | 'accountmanager';
const ROL_LABEL: Record<GebruikersRol, string> = { beheerder: 'Beheerder', accountmanager: 'Accountmanager' };

interface Gebruiker { id: string; email: string; naam: string; rol: GebruikersRol; actief: boolean; mfa: boolean; aangemaakt: string | null }

interface Kandidaat { id: string; naam: string; email: string; actief: boolean; status: 'kan' | 'heeft_account' | 'geen_email' }
interface BulkRegel { id: string; naam: string; email: string; status: 'aangemaakt' | 'heeft_account' | 'geen_email' | 'ongeldig_email' | 'fout'; tijdelijkWachtwoord?: string; reden?: string }
const BULK_STATUS: Record<BulkRegel['status'], string> = { aangemaakt: 'aangemaakt', heeft_account: 'had al een account', geen_email: 'geen e-mailadres', ongeldig_email: 'ongeldig e-mailadres', fout: 'mislukt' };

/** Accounts maken voor medewerkers die al in het dagboek staan. Er gaat geen mail uit: de tijdelijke wachtwoorden geef je zelf door. */
function UitMedewerkers({ klaar }: { klaar: () => void }) {
  const kandidaten = useLaden(() => api<Kandidaat[]>('GET', '/gebruikers/kandidaten'));
  const [gekozen, setGekozen] = useState<string[]>([]);
  const [rol, setRol] = useState<GebruikersRol>('accountmanager');
  const [resultaat, setResultaat] = useState<BulkRegel[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const kan = (kandidaten.data ?? []).filter((k) => k.status === 'kan');
  const wissel = (id: string) => setGekozen((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]));
  async function maak() {
    if (!window.confirm(`${gekozen.length} account${gekozen.length === 1 ? '' : 's'} aanmaken met de rol ${ROL_LABEL[rol].toLowerCase()}?`)) return;
    try {
      const r = await api<{ resultaat: BulkRegel[] }>('POST', '/gebruikers/uit-medewerkers', { employeeIds: gekozen, rol });
      setResultaat(r.resultaat); setGekozen([]); setFout(null); klaar(); void kandidaten.ververs();
    } catch (e) { setFout(foutTekst(e)); }
  }
  const nieuw = (resultaat ?? []).filter((r) => r.status === 'aangemaakt');
  const kopieer = () => void navigator.clipboard?.writeText(nieuw.map((r) => `${r.naam}\t${r.email}\t${r.tijdelijkWachtwoord}`).join('\n'));
  return (
    <section className="paneel stapel" aria-label="Gebruikers uit medewerkers">
      <h2>Medewerkers toegang geven</h2>
      <p className="zacht klein">Maak in één keer accounts voor medewerkers uit de lijst Medewerkers. Alleen medewerkers met een e-mailadres komen in aanmerking. Er gaat geen e-mail uit: je krijgt tijdelijke wachtwoorden die je zelf doorgeeft. Bij de eerste login kiest iedereen een eigen wachtwoord en koppelt een authenticator-app.</p>
      <Melding tekst={fout ?? kandidaten.fout} />
      {kandidaten.data && (
        <>
          <div className="rij">
            <button type="button" onClick={() => setGekozen(gekozen.length === kan.length ? [] : kan.map((k) => k.id))} disabled={!kan.length}>{gekozen.length === kan.length && kan.length > 0 ? 'Niemand kiezen' : `Alle ${kan.length} kiezen`}</button>
            <select aria-label="Rol" value={rol} onChange={(e) => setRol(e.target.value as GebruikersRol)}>
              {(Object.keys(ROL_LABEL) as GebruikersRol[]).map((r) => <option key={r} value={r}>{ROL_LABEL[r]}</option>)}
            </select>
            <button type="button" className="primair" disabled={!gekozen.length} onClick={() => void maak()}>{gekozen.length} account{gekozen.length === 1 ? '' : 's'} aanmaken</button>
          </div>
          {kandidaten.data.length === 0 && <Leeg>Nog geen medewerkers.</Leeg>}
          <ul className="werk-lijst">
            {kandidaten.data.map((k) => (
              <li key={k.id} className="werk-regel">
                <input type="checkbox" className="werk-vink" disabled={k.status !== 'kan'} checked={gekozen.includes(k.id)} onChange={() => wissel(k.id)} aria-label={`Account voor ${k.naam}`} />
                <div className="werk-inhoud">
                  <p className="werk-tekst">{k.naam}</p>
                  <p className="werk-meta"><span>{k.email || 'geen e-mailadres'}</span>{k.status === 'heeft_account' && <Badge soort="afgerond">heeft al een account</Badge>}{k.status === 'geen_email' && <Badge soort="wacht">vul eerst een e-mailadres in bij Medewerkers</Badge>}{!k.actief && <Badge soort="wacht">niet actief</Badge>}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {resultaat && (
        <div className="stapel" aria-live="polite">
          <h3>Resultaat</h3>
          {nieuw.length > 0 && <p className="zacht klein">De wachtwoorden worden maar één keer getoond. Geef ze veilig door; iedereen moet het wachtwoord bij de eerste login wijzigen.</p>}
          <ul className="werk-lijst">
            {resultaat.map((r) => (
              <li key={r.id} className="werk-regel">
                <div className="werk-inhoud">
                  <p className="werk-tekst">{r.naam} <span className="zacht klein">{r.email}</span></p>
                  <p className="werk-meta"><span>{BULK_STATUS[r.status]}{r.reden ? `: ${r.reden}` : ''}</span></p>
                  {r.tijdelijkWachtwoord && <div className="wachtwoordvak">{r.tijdelijkWachtwoord}</div>}
                </div>
              </li>
            ))}
          </ul>
          <div className="rij">
            {nieuw.length > 0 && <button type="button" onClick={kopieer}>Alles kopiëren</button>}
            <button type="button" onClick={() => setResultaat(null)}>Klaar, verberg</button>
          </div>
        </div>
      )}
    </section>
  );
}

export function Gebruikers({ ikEmail }: { ikEmail: string }) {
  const lijst = useLaden(() => api<Gebruiker[]>('GET', '/gebruikers'));
  const [fout, setFout] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [naam, setNaam] = useState('');
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<GebruikersRol>('beheerder');
  const [wachtwoord, setWachtwoord] = useState<{ voor: string; waarde: string } | null>(null);

  async function doe(taak: () => Promise<unknown>, melding?: string) {
    try { await taak(); setFout(null); setOk(melding ?? null); lijst.ververs(); } catch (e) { setOk(null); setFout(foutTekst(e)); }
  }

  async function voegToe(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ tijdelijkWachtwoord: string }>('POST', '/gebruikers', { naam, email, rol });
      setWachtwoord({ voor: email, waarde: r.tijdelijkWachtwoord });
      setNaam(''); setEmail(''); setFout(null); setOk(null); lijst.ververs();
    } catch (err) { setFout(foutTekst(err)); }
  }

  async function reset(g: Gebruiker) {
    if (!window.confirm(`Nieuw tijdelijk wachtwoord voor ${g.naam}? Het huidige wachtwoord werkt dan niet meer.`)) return;
    try {
      const r = await api<{ tijdelijkWachtwoord: string }>('POST', `/gebruikers/${g.id}/wachtwoord`);
      setWachtwoord({ voor: g.email, waarde: r.tijdelijkWachtwoord }); setFout(null); setOk(null);
    } catch (err) { setFout(foutTekst(err)); }
  }

  return (
    <div className="stapel">
      <h1>Gebruikers</h1>
      <p className="zacht">Een beheerder ziet alle gegevens en beheert gebruikers. Een accountmanager ziet alleen het werk en de klanten. Bij de eerste keer inloggen kiest iemand een eigen wachtwoord en koppelt een authenticator-app (MFA).</p>
      <Melding tekst={fout} />
      <Melding tekst={ok} soort="ok" />

      {wachtwoord && (
        <section className="paneel stapel" aria-live="polite">
          <h2>Tijdelijk wachtwoord voor {wachtwoord.voor}</h2>
          <div className="wachtwoordvak">{wachtwoord.waarde}</div>
          <p className="zacht klein">Dit wordt maar één keer getoond. Geef het veilig door; de gebruiker moet het bij de eerste login wijzigen.</p>
          <div className="rij">
            <button type="button" onClick={() => void navigator.clipboard?.writeText(wachtwoord.waarde)}>Kopiëren</button>
            <button type="button" onClick={() => setWachtwoord(null)}>Klaar, verberg</button>
          </div>
        </section>
      )}

      <section className="paneel">
        {lijst.fout && <Melding tekst={lijst.fout} />}
        {lijst.data && !lijst.data.length && <Leeg>Nog geen gebruikers.</Leeg>}
        {lijst.data && lijst.data.length > 0 && (
          <div className="tabelrand">
            <table>
              <thead><tr><th>Naam</th><th>E-mail</th><th>Rol</th><th>Status</th><th>MFA</th><th /></tr></thead>
              <tbody>
                {lijst.data.map((g) => {
                  const ik = g.email.toLowerCase() === ikEmail.toLowerCase();
                  return (
                    <tr key={g.id}>
                      <td>{g.naam}{ik && <> <Badge>jij</Badge></>}</td>
                      <td>{g.email}</td>
                      <td>
                        {ik ? ROL_LABEL[g.rol] : (
                          <select aria-label={`Rol van ${g.naam}`} value={g.rol}
                            onChange={(e) => { if (window.confirm(`${g.naam} wordt ${ROL_LABEL[e.target.value as GebruikersRol].toLowerCase()}. Doorgaan?`)) void doe(() => api('POST', `/gebruikers/${g.id}/rol`, { rol: e.target.value }), 'Rol gewijzigd'); }}>
                            {(Object.keys(ROL_LABEL) as GebruikersRol[]).map((r) => <option key={r} value={r}>{ROL_LABEL[r]}</option>)}
                          </select>
                        )}
                      </td>
                      <td><Badge soort={g.actief ? 'afgerond' : 'mislukt'}>{g.actief ? 'actief' : 'uitgezet'}</Badge></td>
                      <td><Badge soort={g.mfa ? 'afgerond' : 'wacht'}>{g.mfa ? 'actief' : 'nog niet ingesteld'}</Badge></td>
                      <td>
                        <div className="rij">
                          {!ik && <button type="button" onClick={() => void doe(() => api('PATCH', `/gebruikers/${g.id}`, { actief: !g.actief }), g.actief ? 'Gebruiker uitgezet' : 'Gebruiker aangezet')}>{g.actief ? 'Uitzetten' : 'Aanzetten'}</button>}
                          <button type="button" onClick={() => void reset(g)}>Wachtwoord resetten</button>
                          <button type="button" onClick={() => { if (window.confirm(`MFA van ${g.naam} resetten? Bij de volgende login moet een nieuwe authenticator worden gekoppeld.`)) void doe(() => api('POST', `/gebruikers/${g.id}/mfa-reset`), 'MFA is gereset'); }}>MFA resetten</button>
                          {!ik && <button type="button" className="gevaar" onClick={() => { if (window.confirm(`${g.naam} definitief verwijderen?`)) void doe(() => api('DELETE', `/gebruikers/${g.id}`), 'Gebruiker verwijderd'); }}>Verwijderen</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <UitMedewerkers klaar={lijst.ververs} />

      <form className="paneel stapel" onSubmit={voegToe}>
        <h2>Gebruiker toevoegen</h2>
        <div className="raster">
          <Veld label="Naam"><input value={naam} onChange={(e) => setNaam(e.target.value)} autoComplete="off" required maxLength={150} /></Veld>
          <Veld label="E-mailadres"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required maxLength={200} /></Veld>
          <Veld label="Rol">
            <select value={rol} onChange={(e) => setRol(e.target.value as GebruikersRol)}>
              {(Object.keys(ROL_LABEL) as GebruikersRol[]).map((r) => <option key={r} value={r}>{ROL_LABEL[r]}</option>)}
            </select>
          </Veld>
        </div>
        <div><button className="primair" type="submit">Toevoegen</button></div>
      </form>
    </div>
  );
}
