import { useEffect, useState } from 'react';
import { api, type Houding } from '../api';
import { Melding, Veld, foutTekst, useLaden } from '../ui';

function Instelling({ titel, uitleg, label, pad, rijen }: { titel: string; uitleg: string; label: string; pad: string; rijen: number }) {
  const huidig = useLaden(() => api<Houding>('GET', pad));
  const [tekst, setTekst] = useState('');
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  useEffect(() => { if (huidig.data) setTekst(huidig.data.waarde); }, [huidig.data]);

  async function bewaar(waarde: string) {
    try {
      const r = await api<Houding>('PUT', pad, { waarde });
      setTekst(r.waarde);
      setMelding({ tekst: r.standaard ? 'De standaardtekst is teruggezet.' : 'Opgeslagen. Dit geldt vanaf het volgende gesprek.', soort: 'ok' });
      huidig.ververs();
    } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); }
  }
  return (
    <form className="paneel stapel" onSubmit={(e) => { e.preventDefault(); void bewaar(tekst); }}>
      <h2>{titel}</h2>
      <p className="zacht klein">{uitleg}</p>
      <Veld label={label}><textarea rows={rijen} value={tekst} onChange={(e) => setTekst(e.target.value)} maxLength={4000} /></Veld>
      <Melding tekst={melding?.tekst ?? huidig.fout} soort={melding?.soort} />
      <div className="rij">
        <button className="primair" type="submit">Opslaan</button>
        <button type="button" onClick={() => { if (confirm('De standaardtekst terugzetten?')) void bewaar(''); }} disabled={huidig.data?.standaard}>Standaard terugzetten</button>
      </div>
    </form>
  );
}

export function Instellingen() {
  return (
    <div className="stapel">
      <div><h1>Instellingen</h1><p className="zacht">Algemene instellingen voor alle gesprekken. Een planning kan een eigen gespreksinstructie krijgen; zonder eigen instructie geldt de algemene.</p></div>
      <Instelling titel="Houding van de assistent" label="Houding" pad="/instellingen/houding" rijen={6}
        uitleg="Zo gedraagt de assistent zich in elk gesprek. De AI-melding, de grenzen en de regel om één vraag per keer te stellen blijven altijd gelden, wat je hier ook invult." />
      <Instelling titel="Algemene gespreksinstructie" label="Gespreksinstructie" pad="/instellingen/gespreksinstructie" rijen={9}
        uitleg="Wat de assistent in een gesprek doet, zoals proactief doorvragen, vervolgacties afspreken en omgaan met gemiste deadlines. Dit geldt voor elke planning zonder eigen instructie en voor ‘Bel nu’. De onderwerpen langslopen en de twee vragen aan het eind (nieuw onderwerp, verbetering) staan vast." />
    </div>
  );
}
