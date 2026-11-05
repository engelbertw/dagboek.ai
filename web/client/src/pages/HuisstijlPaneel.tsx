import { useEffect, useState } from 'react';
import { api } from '../api';
import { Melding, Veld, foutTekst } from '../ui';

interface Huidig { website: string; kleur: string | null; bevestigdOp: string | null; logo: string | null }
interface Voorstel { website: string; kleuren: string[]; logos: { url: string; type: string; logo: string }[]; overgeslagen: number }
/** Wat er bij het bevestigen met het logo gebeurt: laten staan, verwijderen, een voorgesteld logo overnemen of een eigen bestand. */
type LogoKeuze = { soort: 'behouden' } | { soort: 'geen' } | { soort: 'url'; url: string; voorbeeld: string } | { soort: 'upload'; data: string };

const MAX_UPLOAD = 500_000;

/** Alleen voor de beheerder: kleur en logo van de gemeente voor het PDF-rapport. De website levert een voorstel; pas na bevestigen wordt iets bewaard. */
export function HuisstijlPaneel({ klantId }: { klantId: string }) {
  const [huidig, setHuidig] = useState<Huidig | null>(null);
  const [website, setWebsite] = useState('');
  const [kleur, setKleur] = useState('#00807f');
  const [voorstel, setVoorstel] = useState<Voorstel | null>(null);
  const [logo, setLogo] = useState<LogoKeuze>({ soort: 'behouden' });
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);

  const laad = async () => {
    try {
      const h = await api<Huidig>('GET', `/klanten/${klantId}/huisstijl`);
      setHuidig(h); setWebsite(h.website); if (h.kleur) setKleur(h.kleur);
    } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); }
  };
  useEffect(() => { void laad(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [klantId]);

  async function haalVoorstel() {
    setBezig(true); setMelding(null); setVoorstel(null);
    try {
      const v = await api<Voorstel>('POST', `/klanten/${klantId}/huisstijl/voorstel`, { website });
      setVoorstel(v); setWebsite(v.website);
      if (v.kleuren[0]) setKleur(v.kleuren[0]);
      if (v.logos[0]) setLogo({ soort: 'url', url: v.logos[0].url, voorbeeld: v.logos[0].logo });
      if (!v.kleuren.length && !v.logos.length) setMelding({ tekst: 'Op deze website is geen kleur of logo gevonden. Vul ze zelf in.', soort: 'fout' });
    } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); } finally { setBezig(false); }
  }
  async function bevestig() {
    setBezig(true); setMelding(null);
    try {
      const body: Record<string, unknown> = { website, kleur };
      if (logo.soort === 'geen') body.logo = null;
      if (logo.soort === 'url') body.logo = { url: logo.url };
      if (logo.soort === 'upload') body.logo = { data: logo.data };
      await api('PUT', `/klanten/${klantId}/huisstijl`, body);
      setVoorstel(null); setLogo({ soort: 'behouden' }); setMelding({ tekst: 'Huisstijl bevestigd. Het volgende rapport gebruikt deze kleur en dit logo.', soort: 'ok' }); await laad();
    } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); } finally { setBezig(false); }
  }
  async function wis() {
    if (!window.confirm('De huisstijl van deze gemeente wissen? Het rapport valt terug op alleen de Pink-stijl.')) return;
    try { await api('DELETE', `/klanten/${klantId}/huisstijl`); setVoorstel(null); setLogo({ soort: 'behouden' }); setMelding(null); await laad(); } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); }
  }
  function upload(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_UPLOAD) { setMelding({ tekst: 'Dit bestand is te groot (maximaal 500 KB).', soort: 'fout' }); return; }
    const lezer = new FileReader();
    lezer.onload = () => { setLogo({ soort: 'upload', data: String(lezer.result) }); setMelding(null); };
    lezer.readAsDataURL(f);
  }

  const getoondLogo = logo.soort === 'url' ? logo.voorbeeld : logo.soort === 'upload' ? logo.data : logo.soort === 'behouden' ? huidig?.logo ?? null : null;
  const geldig = /^#[0-9a-fA-F]{6}$/.test(kleur);

  return (
    <section className="paneel stapel" aria-label="Huisstijl voor rapporten">
      <h2>Huisstijl voor rapporten</h2>
      <p className="zacht">Kleur en logo van de gemeente in het PDF-rapport, naast de Pink-stijl. Uit de website komt alleen een voorstel; er wordt pas iets bewaard als je bevestigt.</p>
      {huidig?.bevestigdOp
        ? <p>Bevestigd: <span className="huisstijl-kleurvlak" style={{ background: huidig.kleur ?? undefined }} /> {huidig.kleur}{huidig.logo ? ' met logo' : ' zonder logo'}.</p>
        : <p className="zacht">Nog geen huisstijl bevestigd: het rapport gebruikt alleen de Pink-stijl.</p>}
      <div className="rij">
        <Veld label="Website van de gemeente"><input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="www.venlo.nl" maxLength={300} /></Veld>
        <button type="button" disabled={bezig || website.trim().length < 4} onClick={() => void haalVoorstel()}>{bezig ? 'Bezig...' : 'Voorstel ophalen'}</button>
      </div>
      {voorstel && (
        <div className="stapel">
          {voorstel.kleuren.length > 0 && <div><strong>Kleuren gevonden</strong>
            <div className="rij">{voorstel.kleuren.map((k) => (
              <button type="button" key={k} onClick={() => setKleur(k)} aria-pressed={kleur === k} title={k} style={{ background: k, width: '2.6rem', height: '2.6rem', borderRadius: 6, border: kleur === k ? '3px solid #1a1a1a' : '1px solid #999' }} />
            ))}</div></div>}
          {voorstel.logos.length > 0 && <div><strong>Logo's gevonden</strong>
            <div className="rij">{voorstel.logos.map((l) => (
              <button type="button" key={l.url} onClick={() => setLogo({ soort: 'url', url: l.url, voorbeeld: l.logo })} aria-pressed={logo.soort === 'url' && logo.url === l.url} title={l.url}
                style={{ background: '#fff', padding: 6, borderRadius: 6, border: logo.soort === 'url' && logo.url === l.url ? '3px solid #1a1a1a' : '1px solid #999' }}>
                <img src={l.logo} alt="Logo-voorstel" style={{ maxWidth: 140, maxHeight: 56, display: 'block' }} />
              </button>
            ))}</div></div>}
          {voorstel.overgeslagen > 0 && <p className="zacht">{voorstel.overgeslagen} gevonden bestand(en) overgeslagen: alleen PNG, JPEG en SVG kunnen worden gebruikt.</p>}
        </div>
      )}
      <div className="rij">
        <Veld label="Kleur">
          <span className="rij"><input type="color" value={geldig ? kleur : '#000000'} onChange={(e) => setKleur(e.target.value)} aria-label="Kleur kiezen" />
            <input value={kleur} onChange={(e) => setKleur(e.target.value)} maxLength={7} style={{ width: '7rem' }} aria-label="Kleurcode" /></span>
        </Veld>
        <Veld label="Eigen logo (PNG, JPEG of SVG, max 500 KB)"><input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={(e) => upload(e.target.files?.[0])} /></Veld>
        {(getoondLogo) && <div><img src={getoondLogo} alt="Gekozen logo" style={{ maxWidth: 160, maxHeight: 60, background: '#fff', padding: 4, border: '1px solid #ccc', borderRadius: 4 }} />
          <div><button type="button" onClick={() => setLogo({ soort: 'geen' })}>Logo weglaten</button></div></div>}
      </div>
      {logo.soort === 'geen' && <p className="zacht">Het logo wordt bij bevestigen verwijderd.</p>}
      <div className="rij">
        <button type="button" className="primair" disabled={bezig || !geldig} onClick={() => void bevestig()}>Bevestigen</button>
        {huidig?.bevestigdOp && <button type="button" className="gevaar" onClick={() => void wis()}>Huisstijl wissen</button>}
      </div>
      <Melding tekst={melding?.tekst ?? null} soort={melding?.soort} />
    </section>
  );
}
