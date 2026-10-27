import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api';
import { Melding, Veld, foutTekst } from './ui';
import { Acties } from './pages/Acties';
import { Dagboek } from './pages/Dagboek';
import { Dashboard } from './pages/Dashboard';
import { Gesprekken } from './pages/Gesprekken';
import { Instellingen } from './pages/Instellingen';
import { Medewerkers } from './pages/Medewerkers';
import { Onderwerp } from './pages/Onderwerp';
import { Suggesties } from './pages/Suggesties';
import { Planning } from './pages/Planning';
import { Projecten } from './pages/Projecten';

function Inloggen({ klaar }: { klaar: () => void }) {
  const [email, setEmail] = useState('');
  const [wachtwoord, setWachtwoord] = useState('');
  const [fout, setFout] = useState<string | null>(null);
  async function verstuur(e: FormEvent) {
    e.preventDefault();
    try { await api('POST', '/login', { email, wachtwoord }); klaar(); } catch (err) { setFout(foutTekst(err)); }
  }
  return (
    <form className="inlog stapel" onSubmit={verstuur}>
      <h1>Dagboek</h1>
      <Veld label="E-mailadres"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></Veld>
      <Veld label="Wachtwoord"><input type="password" value={wachtwoord} onChange={(e) => setWachtwoord(e.target.value)} autoComplete="current-password" required /></Veld>
      <Melding tekst={fout} />
      <button className="primair" type="submit">Inloggen</button>
    </form>
  );
}

export function App() {
  const [ingelogd, setIngelogd] = useState<boolean | null>(null);
  const controleer = () => api<{ ingelogd: boolean }>('GET', '/me').then((m) => setIngelogd(m.ingelogd)).catch(() => setIngelogd(false));
  useEffect(() => { void controleer(); }, []);
  const { pathname } = useLocation();
  if (ingelogd === null) return null;
  if (!ingelogd) return <Inloggen klaar={() => setIngelogd(true)} />;
  return (
    <>
      <header className="kop">
        <span className="merk">Dagboek</span>
        <nav aria-label="Hoofdmenu">
          <NavLink to="/" end className={({ isActive }) => (isActive || pathname.startsWith('/onderwerp') ? 'actief' : '')}>Dagboek</NavLink>
          <NavLink to="/dashboard" className={({ isActive }) => (isActive ? 'actief' : '')}>Dashboard</NavLink>
          <NavLink to="/acties" className={({ isActive }) => (isActive ? 'actief' : '')}>Acties</NavLink>
          <NavLink to="/medewerkers" className={({ isActive }) => (isActive ? 'actief' : '')}>Medewerkers</NavLink>
          <NavLink to="/projecten" className={({ isActive }) => (isActive ? 'actief' : '')}>Projecten</NavLink>
          <NavLink to="/gesprekken" className={({ isActive }) => (isActive ? 'actief' : '')}>Gesprekken</NavLink>
          <NavLink to="/planning" className={({ isActive }) => (isActive ? 'actief' : '')}>Planning</NavLink>
          <NavLink to="/suggesties" className={({ isActive }) => (isActive ? 'actief' : '')}>Suggesties</NavLink>
          <NavLink to="/instellingen" className={({ isActive }) => (isActive ? 'actief' : '')}>Instellingen</NavLink>
        </nav>
        <button className="tekstknop" onClick={async () => { await api('POST', '/logout'); setIngelogd(false); }}>Uitloggen</button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dagboek />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/acties" element={<Acties />} />
          <Route path="/planning" element={<Planning />} />
          <Route path="/suggesties" element={<Suggesties />} />
          <Route path="/instellingen" element={<Instellingen />} />
          <Route path="/onderwerp/:id" element={<Onderwerp />} />
          <Route path="/medewerkers" element={<Medewerkers />} />
          <Route path="/projecten" element={<Projecten />} />
          <Route path="/gesprekken" element={<Gesprekken />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
