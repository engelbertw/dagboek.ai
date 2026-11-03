import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, type GebruikersRol } from './api';
import { Melding, Veld, foutTekst } from './ui';
import { Dagboek } from './pages/Dagboek';
import { DagboekActueel } from './pages/DagboekActueel';
import { Dashboard } from './pages/Dashboard';
import { Gesprekken } from './pages/Gesprekken';
import { Spraakmotoren } from './pages/Spraakmotoren';
import { Instellingen } from './pages/Instellingen';
import { WoordenlijstPagina } from './pages/Woordenlijst';
import { Klant } from './pages/Klant';
import { Klanten } from './pages/Klanten';
import { Voorbereiding } from './pages/Voorbereiding';
import { SamenVerder } from './pages/SamenVerder';
import { Consultancy } from './pages/Consultancy';
import { Kwaliteit } from './pages/Kwaliteit';
import { SamenVerderProgramma } from './pages/SamenVerderProgramma';
import { Contactpersonen } from './pages/Contactpersonen';
import { Medewerkers } from './pages/Medewerkers';
import { Onderwerp } from './pages/Onderwerp';
import { Suggesties } from './pages/Suggesties';
import { Planning } from './pages/Planning';
import { Projecten } from './pages/Projecten';
import { Werk } from './pages/Werk';
import { GebruikerDetail, Gebruikers } from './pages/Gebruikers';

interface Me { ingelogd: boolean; email?: string; naam?: string; rol?: GebruikersRol; keycloak: boolean; noodlogin: boolean; gebruikersbeheer: boolean; accountUrl?: string }

const INLOGFOUT: Record<string, string> = {
  geen_toegang: 'Dit account heeft geen toegang tot dagboek.ai. Vraag een beheerder om je de rol beheerder, accountmanager, administratie of consultant te geven.',
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

interface MenuGroep { titel: string; items: { naar: string; label: string; einde?: boolean; ook?: string; alleenBeheerder?: boolean }[]; alleenBeheerder?: boolean }

const MENU: MenuGroep[] = [
  { titel: 'Overzicht', items: [{ naar: '/dagboek', label: 'Dagboek' }, { naar: '/onderwerpen', label: 'Onderwerpen', ook: '/onderwerp/', alleenBeheerder: true }, { naar: '/dashboard', label: 'Dashboard', alleenBeheerder: true }] },
  { titel: 'Werk', items: [{ naar: '/werk', label: 'Werk' }, { naar: '/klanten', label: 'Klanten' }, { naar: '/contactpersonen', label: 'Contactpersonen' }, { naar: '/consultancy', label: 'Consultancy' }, { naar: '/samenverder', label: 'SamenVerder' }, { naar: '/kwaliteit', label: 'Kwaliteit' }] },
  { titel: 'Gesprekken', alleenBeheerder: true, items: [{ naar: '/gesprekken', label: 'Gesprekken' }, { naar: '/planning', label: 'Planning' }, { naar: '/suggesties', label: 'Suggesties' }] },
  { titel: 'Beheer', alleenBeheerder: true, items: [{ naar: '/medewerkers', label: 'Medewerkers' }, { naar: '/projecten', label: 'Projecten' }, { naar: '/spraakmotoren', label: 'Spraakmotoren' }, { naar: '/woordenlijst', label: 'Woordenlijst' }, { naar: '/instellingen', label: 'Instellingen' }] },
];

/** Administratie beheert alleen de stamgegevens van klanten: geen werkregister, gesprekken of instellingen. */
/** Een consultant leest alleen het consultancywerk. */
const MENU_CONSULTANT: MenuGroep[] = [{ titel: 'Overzicht', items: [{ naar: '/dagboek', label: 'Dagboek' }] }, { titel: 'Werk', items: [{ naar: '/werk', label: 'Werk' }, { naar: '/klanten', label: 'Klanten' }, { naar: '/consultancy', label: 'Consultancy' }, { naar: '/samenverder', label: 'SamenVerder' }] }];

const MENU_ADMINISTRATIE: MenuGroep[] = [{ titel: 'Klantgegevens', items: [{ naar: '/klanten', label: 'Klanten' }, { naar: '/contactpersonen', label: 'Contactpersonen' }, { naar: '/kwaliteit', label: 'Kwaliteit' }] }];

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const controleer = () => api<Me>('GET', '/me').then(setMe).catch(() => setMe({ ingelogd: false, keycloak: false, noodlogin: true, gebruikersbeheer: false }));
  useEffect(() => { void controleer(); }, []);
  const { pathname } = useLocation();
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  if (me === null) return null;
  if (!me.ingelogd) return <Inloggen me={me} klaar={() => void controleer()} />;
  const rol: GebruikersRol = me.rol ?? 'beheerder';
  const beheerder = rol === 'beheerder';
  const administratie = rol === 'administratie';
  const consultant = rol === 'consultant';
  const groepen = administratie ? MENU_ADMINISTRATIE : consultant ? MENU_CONSULTANT : MENU.filter((g) => beheerder || !g.alleenBeheerder);
  const actief = (naar: string, ook?: string) => (naar === '/' ? pathname === '/' : pathname === naar || pathname.startsWith(`${naar}/`)) || (!!ook && pathname.startsWith(ook));
  return (
    <div className="app">
      <header className="kop">
        <button type="button" className="menuknop" aria-expanded={menuOpen} aria-controls="hoofdmenu" onClick={() => setMenuOpen(!menuOpen)}>Menu</button>
        <span className="merk">Dagboek</span>
        <span className="zacht klein wie">{me.naam}</span>
        {me.accountUrl && <a className="tekstknop" href={me.accountUrl} target="_blank" rel="noreferrer">Account</a>}
        <button className="tekstknop" onClick={async () => {
          const { eindUrl } = await api<{ eindUrl: string | null }>('POST', '/logout');
          if (eindUrl) window.location.href = eindUrl; else setMe({ ...me, ingelogd: false });
        }}>Uitloggen</button>
      </header>
      <nav id="hoofdmenu" className={`zijmenu${menuOpen ? ' open' : ''}`} aria-label="Hoofdmenu">
        {groepen.map((g) => (
          <div key={g.titel} className="menugroep">
            <h2 className="menutitel">{g.titel}</h2>
            {g.items.filter((i) => beheerder || !i.alleenBeheerder).map((i) => <NavLink key={i.naar} to={i.naar} end={i.einde} className={actief(i.naar, i.ook) ? 'actief' : ''}>{i.label}</NavLink>)}
            {g.titel === 'Beheer' && me.gebruikersbeheer && <NavLink to="/gebruikers" className={actief('/gebruikers') ? 'actief' : ''}>Gebruikers</NavLink>}
          </div>
        ))}
      </nav>
      <main>
        <Routes>
          {beheerder ? (
            <>
              <Route path="/" element={<Navigate to="/dagboek" replace />} />
              <Route path="/onderwerpen" element={<Dagboek />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/planning" element={<Planning />} />
              <Route path="/suggesties" element={<Suggesties />} />
              <Route path="/instellingen" element={<Instellingen />} />
              <Route path="/woordenlijst" element={<WoordenlijstPagina />} />
              <Route path="/onderwerp/:id" element={<Onderwerp />} />
              <Route path="/medewerkers" element={<Medewerkers />} />
              {me.gebruikersbeheer && <Route path="/gebruikers" element={<Gebruikers ikEmail={me.email ?? ''} />} />}
              {me.gebruikersbeheer && <Route path="/gebruikers/:id" element={<GebruikerDetail ikEmail={me.email ?? ''} />} />}
              <Route path="/projecten" element={<Projecten />} />
              <Route path="/gesprekken" element={<Gesprekken />} />
              <Route path="/spraakmotoren" element={<Spraakmotoren />} />
              <Route path="*" element={<Navigate to="/dagboek" replace />} />
            </>
          ) : <Route path="*" element={<Navigate to={administratie ? '/klanten' : '/dagboek'} replace />} />}
          {!administratie && <Route path="/dagboek" element={<DagboekActueel rol={rol} />} />}
          {!administratie && (
            <>
              <Route path="/werk" element={<Werk alleenLezen={consultant} />} />
              <Route path="/acties" element={<Navigate to="/werk" replace />} />
              <Route path="/verkoopregister" element={<Navigate to="/werk" replace />} />
            </>
          )}
          <Route path="/klanten" element={<Klanten rol={rol} />} />
          <Route path="/klanten/:id" element={<Klant rol={rol} />} />
          <Route path="/klanten/:id/voorbereiding" element={<Voorbereiding />} />
          {!consultant && (
            <>
              <Route path="/contactpersonen" element={<Contactpersonen />} />
              <Route path="/kwaliteit" element={<Kwaliteit />} />
            </>
          )}
          {!administratie && (
            <>
              <Route path="/consultancy" element={<Consultancy alleenLezen={!beheerder} />} />
              <Route path="/samenverder" element={<SamenVerder alleenLezen={!beheerder} />} />
              <Route path="/samenverder/:id" element={<SamenVerderProgramma alleenLezen={!beheerder} />} />
            </>
          )}
        </Routes>
      </main>
    </div>
  );
}
