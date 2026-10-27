import { useEffect, useState } from 'react';
import { api, type Houding } from '../api';
import { Melding, Veld, foutTekst, useLaden } from '../ui';

export function Instellingen() {
  const houding = useLaden(() => api<Houding>('GET', '/instellingen/houding'));
  const [tekst, setTekst] = useState('');
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  useEffect(() => { if (houding.data) setTekst(houding.data.waarde); }, [houding.data]);

  async function bewaar(waarde: string) {
    try {
      const r = await api<Houding>('PUT', '/instellingen/houding', { waarde });
      setTekst(r.waarde);
      setMelding({ tekst: r.standaard ? 'De standaardhouding is teruggezet.' : 'Opgeslagen. Dit geldt vanaf het volgende gesprek.', soort: 'ok' });
      houding.ververs();
    } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); }
  }
  return (
    <div className="stapel">
      <div><h1>Instellingen</h1></div>
      <form className="paneel stapel" onSubmit={(e) => { e.preventDefault(); void bewaar(tekst); }}>
        <h2>Houding van de assistent</h2>
        <p className="zacht klein">Zo gedraagt de assistent zich in elk gesprek. De AI-melding, de grenzen en de regel om één vraag per keer te stellen blijven altijd gelden, wat je hier ook invult.</p>
        <Veld label="Houding"><textarea rows={8} value={tekst} onChange={(e) => setTekst(e.target.value)} maxLength={4000} /></Veld>
        <Melding tekst={melding?.tekst ?? houding.fout} soort={melding?.soort} />
        <div className="rij">
          <button className="primair" type="submit">Opslaan</button>
          <button type="button" onClick={() => { if (confirm('De standaardhouding terugzetten?')) void bewaar(''); }} disabled={houding.data?.standaard}>Standaard terugzetten</button>
        </div>
      </form>
    </div>
  );
}
