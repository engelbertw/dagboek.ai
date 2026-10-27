import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api';
import { Melding, Veld, foutTekst } from './ui';
import { Dagboek } from './pages/Dagboek';
import { Gesprekken } from './pages/Gesprekken';
import { Medewerkers } from './pages/Medewerkers';
import { Onderwerp } from './pages/Onderwerp';
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
          <NavLink to="/medewerkers" className={({ isActive }) => (isActive ? 'actief' : '')}>Medewerkers</NavLink>
          <NavLink to="/projecten" className={({ isActive }) => (isActive ? 'actief' : '')}>Projecten</NavLink>
          <NavLink to="/gesprekken" className={({ isActive }) => (isActive ? 'actief' : '')}>Gesprekken</NavLink>
        </nav>
        <button className="tekstknop" onClick={async () => { await api('POST', '/logout'); setIngelogd(false); }}>Uitloggen</button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dagboek />} />
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
