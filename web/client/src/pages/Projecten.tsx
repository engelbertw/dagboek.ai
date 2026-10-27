import { useState, type FormEvent } from 'react';
import { api, type Project } from '../api';
import { Badge, Leeg, Melding, Veld, foutTekst, useLaden } from '../ui';

function ProjectKaart({ p, ververs }: { p: Project; ververs: () => void }) {
  const [bewerk, setBewerk] = useState<{ naam: string; omschrijving: string } | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const doe = async (f: () => Promise<unknown>) => { try { await f(); setFout(null); setBewerk(null); ververs(); } catch (e) { setFout(foutTekst(e)); } };
  return (
    <div className="paneel stapel">
      {bewerk ? (
        <form className="stapel" onSubmit={(e) => { e.preventDefault(); void doe(() => api('PATCH', `/projects/${p.id}`, bewerk)); }}>
          <Veld label="Naam"><input value={bewerk.naam} onChange={(e) => setBewerk({ ...bewerk, naam: e.target.value })} required /></Veld>
          <Veld label="Omschrijving"><textarea value={bewerk.omschrijving} onChange={(e) => setBewerk({ ...bewerk, omschrijving: e.target.value })} /></Veld>
          <div className="rij"><button className="primair" type="submit">Opslaan</button><button type="button" onClick={() => setBewerk(null)}>Annuleren</button></div>
        </form>
      ) : (
        <>
          <div className="rij spreid"><h3>{p.naam}</h3><Badge soort={p.status}>{p.status}</Badge></div>
          {p.omschrijving && <p className="zacht">{p.omschrijving}</p>}
          <div className="rij">
            <button className="tekstknop" onClick={() => setBewerk({ naam: p.naam, omschrijving: p.omschrijving })}>Bewerken</button>
            <button className="tekstknop" onClick={() => doe(() => api('PATCH', `/projects/${p.id}`, { status: p.status === 'actief' ? 'afgerond' : 'actief' }))}>{p.status === 'actief' ? 'Afronden' : 'Heropenen'}</button>
            <button className="tekstknop gevaar" onClick={() => confirm(`Project ‘${p.naam}’ verwijderen? De onderwerpen blijven bestaan.`) && doe(() => api('DELETE', `/projects/${p.id}`))}>Verwijderen</button>
          </div>
        </>
      )}
      <Melding tekst={fout} />
    </div>
  );
}

export function Projecten() {
  const lijst = useLaden(() => api<Project[]>('GET', '/projects'));
  const [naam, setNaam] = useState('');
  const [fout, setFout] = useState<string | null>(null);
  async function maakAan(e: FormEvent) {
    e.preventDefault();
    try { await api('POST', '/projects', { naam }); setNaam(''); setFout(null); lijst.ververs(); } catch (err) { setFout(foutTekst(err)); }
  }
  return (
    <div className="stapel">
      <div><h1>Projecten</h1><p className="zacht">Groepeer onderwerpen, bijvoorbeeld MijnServices of Common Ground.</p></div>
      <form className="rij" onSubmit={maakAan}>
        <input style={{ flex: 1 }} value={naam} onChange={(e) => setNaam(e.target.value)} placeholder="Naam van het nieuwe project" aria-label="Naam van het nieuwe project" required />
        <button className="primair" type="submit">Toevoegen</button>
      </form>
      <Melding tekst={fout ?? lijst.fout} />
      {lijst.data?.length === 0 && <Leeg>Nog geen projecten.</Leeg>}
      {lijst.data?.map((p) => <ProjectKaart key={p.id} p={p} ververs={lijst.ververs} />)}
    </div>
  );
}
