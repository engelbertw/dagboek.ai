import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Badge, Leeg, Melding, Veld, foutTekst, useLaden } from '../ui';

type GebruikersRol = 'beheerder' | 'accountmanager';
const ROL_LABEL: Record<GebruikersRol, string> = { beheerder: 'Beheerder', accountmanager: 'Accountmanager' };

interface Gebruiker { id: string; email: string; naam: string; rol: GebruikersRol; actief: boolean; mfa: boolean; aangemaakt: string | null }

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
