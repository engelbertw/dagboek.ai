import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api';
import { Melding, Veld, foutTekst } from './ui';
import { Acties } from './pages/Acties';
import { Dagboek } from './pages/Dagboek';
import { Dashboard } from './pages/Dashboard';
import { Gesprekken } from './pages/Gesprekken';
import { Instellingen } from './pages/Instellingen';
import { Klant } from './pages/Klant';
import { Klanten } from './pages/Klanten';
import { Medewerkers } from './pages/Medewerkers';
import { Onderwerp } from './pages/Onderwerp';
import { Suggesties } from './pages/Suggesties';
import { Planning } from './pages/Planning';
import { Projecten } from './pages/Projecten';
import { Verkoopregister } from './pages/Verkoopregister';
import { Gebruikers } from './pages/Gebruikers';

interface Me { ingelogd: boolean; email?: string; naam?: string; keycloak: boolean; noodlogin: boolean; gebruikersbeheer: boolean }

const INLOGFOUT: Record<string, string> = {
  geen_toegang: 'Dit account heeft geen toegang tot dagboek.ai. Vraag een beheerder om de rol beheerder.',
  ongeldig: 'De inlogpoging is verlopen of ongeldig. Probeer het opnieuw.',
  keycloak: 'Keycloak is nu niet bereikbaar. Probeer het later opnieuw.',
};

function Inloggen({ me, klaar }: { me: Me; klaar: () => void }) {
  const [email, setEmail] = useState('');
  const [wachtwoord, setWachtwoord] = useState('');
  const [fout, setFout] = useState<string | null>(INLOGFOUT[new URLSearchParams(window.location.search).get('inlogfout') ?? ''] ?? null);
  async function verstuur(e: FormEvent) {
    e.preventDefault();
    try { await api('POST', '/login', { email, wachtwoord }); klaar(); } catch (err) { setFout(foutTekst(err)); }
  }
  const nood = (
    <form className="stapel" onSubmit={verstuur}>
      <Veld label="E-mailadres"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></Veld>
      <Veld label="Wachtwoord"><input type="password" value={wachtwoord} onChange={(e) => setWachtwoord(e.target.value)} autoComplete="current-password" required /></Veld>
      <button className="primair" type="submit">Inloggen</button>
    </form>
  );
  return (
    <div className="inlog stapel">
      <h1 className="merk-groot">dagboek.ai</h1>
      <Melding tekst={fout} />
      {me.keycloak ? (
        <>
          <a className="knop primair" href="/api/auth/start">Inloggen</a>
          <p className="zacht klein">Je logt in met je eigen account en een code uit je authenticator-app.</p>
          {me.noodlogin && <details className="noodingang"><summary>Noodingang</summary>{nood}</details>}
        </>
      ) : nood}
    </div>
  );
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const controleer = () => api<Me>('GET', '/me').then(setMe).catch(() => setMe({ ingelogd: false, keycloak: false, noodlogin: true, gebruikersbeheer: false }));
  useEffect(() => { void controleer(); }, []);
  const { pathname } = useLocation();
  if (me === null) return null;
  if (!me.ingelogd) return <Inloggen me={me} klaar={() => void controleer()} />;
  return (
    <>
      <header className="kop">
        <span className="merk">Dagboek</span>
        <nav aria-label="Hoofdmenu">
          <NavLink to="/" end className={({ isActive }) => (isActive || pathname.startsWith('/onderwerp') ? 'actief' : '')}>Dagboek</NavLink>
          <NavLink to="/dashboard" className={({ isActive }) => (isActive ? 'actief' : '')}>Dashboard</NavLink>
          <NavLink to="/acties" className={({ isActive }) => (isActive ? 'actief' : '')}>Acties</NavLink>
          <NavLink to="/klanten" className={({ isActive }) => (isActive ? 'actief' : '')}>Klanten</NavLink>
          <NavLink to="/verkoopregister" className={({ isActive }) => (isActive ? 'actief' : '')}>Verkoopregister</NavLink>
          <NavLink to="/medewerkers" className={({ isActive }) => (isActive ? 'actief' : '')}>Medewerkers</NavLink>
          <NavLink to="/projecten" className={({ isActive }) => (isActive ? 'actief' : '')}>Projecten</NavLink>
          <NavLink to="/gesprekken" className={({ isActive }) => (isActive ? 'actief' : '')}>Gesprekken</NavLink>
          <NavLink to="/planning" className={({ isActive }) => (isActive ? 'actief' : '')}>Planning</NavLink>
          <NavLink to="/suggesties" className={({ isActive }) => (isActive ? 'actief' : '')}>Suggesties</NavLink>
          <NavLink to="/instellingen" className={({ isActive }) => (isActive ? 'actief' : '')}>Instellingen</NavLink>
          {me.gebruikersbeheer && <NavLink to="/gebruikers" className={({ isActive }) => (isActive ? 'actief' : '')}>Gebruikers</NavLink>}
        </nav>
        <span className="zacht klein wie">{me.naam}</span>
        <button className="tekstknop" onClick={async () => {
          const { eindUrl } = await api<{ eindUrl: string | null }>('POST', '/logout');
          if (eindUrl) window.location.href = eindUrl; else setMe({ ...me, ingelogd: false });
        }}>Uitloggen</button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dagboek />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/acties" element={<Acties />} />
          <Route path="/klanten" element={<Klanten />} />
          <Route path="/klanten/:id" element={<Klant />} />
          <Route path="/verkoopregister" element={<Verkoopregister />} />
          <Route path="/planning" element={<Planning />} />
          <Route path="/suggesties" element={<Suggesties />} />
          <Route path="/instellingen" element={<Instellingen />} />
          <Route path="/onderwerp/:id" element={<Onderwerp />} />
          <Route path="/medewerkers" element={<Medewerkers />} />
          {me.gebruikersbeheer && <Route path="/gebruikers" element={<Gebruikers ikEmail={me.email ?? ''} />} />}
          <Route path="/projecten" element={<Projecten />} />
          <Route path="/gesprekken" element={<Gesprekken />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
