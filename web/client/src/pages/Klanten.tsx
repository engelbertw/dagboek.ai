import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { KLANT_STATUS_LABEL, api, datum, type KlantRegel, type KlantStatus, type KlantenImportUitkomst } from '../api';
import { Badge, Leeg, Melding, Veld, foutTekst, useLaden } from '../ui';

function Importeren({ klaar }: { klaar: () => void }) {
  const [tekst, setTekst] = useState('');
  const [status, setStatus] = useState<'klant' | 'prospect'>('klant');
  const [voorbeeld, setVoorbeeld] = useState<KlantenImportUitkomst | null>(null);
  const [melding, setMelding] = useState<{ tekst: string; soort: 'fout' | 'ok' } | null>(null);
  const nieuweContacten = voorbeeld?.gemeenten.reduce((n, g) => n + g.contacten.filter((c) => c.status === 'nieuw').length, 0) ?? 0;
  const nieuweGemeenten = voorbeeld?.gemeenten.filter((g) => g.status === 'nieuw').length ?? 0;
  async function toon() {
    try { setVoorbeeld(await api<KlantenImportUitkomst>('POST', '/klanten/import', { tekst, status, voorbeeld: true })); setMelding(null); } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); }
  }
  async function voegToe() {
    try {
      const r = await api<KlantenImportUitkomst>('POST', '/klanten/import', { tekst, status });
      setMelding({ tekst: `$${r.toegevoegd.gemeenten} gemeenten en ${r.toegevoegd.contacten} contactpersonen toegevoegd${r.toegevoegd.bijgewerkt ? `, ${r.toegevoegd.bijgewerkt} bestaande aangevuld` : ''}.`, soort: 'ok' });
      setTekst(''); setVoorbeeld(null); klaar();
    } catch (e) { setMelding({ tekst: foutTekst(e), soort: 'fout' }); }
  }
  return (
    <section className="paneel stapel" aria-label="Lijst importeren">
      <h2>Lijst importeren</h2>
      <p className="zacht klein">Plak een lijst uit Excel (gescheiden door een tab, puntkomma of verticale streep). Met een kopregel herkent de import de kolommen <strong>Gemeente, Samenwerkingsverband, Inwonersaantallen, Sales AM, Contactpersoon, Functie, Rol, Emailadres, Telefoonnummer</strong> en <strong>Looptijd contract</strong> (dag-maand-jaar). Zonder kopregel geldt: Gemeente ; Contactpersoon ; Functie ; Rol. Een lege gemeente betekent dezelfde gemeente als hierboven. Je ziet eerst een voorbeeld. Bestaande gemeenten en contactpersonen worden niet dubbel toegevoegd en niets wordt overschreven: alleen lege velden worden aangevuld.</p>
      <Veld label="Lijst"><textarea rows={8} value={tekst} onChange={(e) => { setTekst(e.target.value); setVoorbeeld(null); }} placeholder={'Gemeente Voorbeeld; Jan Jansen; Teamleider ICT; Beslisser\n; Piet Pieters; Inkoper; Adviseur'} /></Veld>
      <Veld label="Status van nieuwe gemeenten">
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="klant">Klant</option><option value="prospect">Prospect</option></select>
      </Veld>
      {voorbeeld && (
        <div className="stapel">
          {voorbeeld.fouten.map((f) => <Melding key={f} tekst={f} />)}
          {voorbeeld.gemeenten.map((g) => (
            <div key={g.naam}>
              <strong>{g.naam}</strong> <Badge soort={g.status === 'nieuw' ? '' : 'wacht'}>{g.status === 'nieuw' ? 'nieuwe gemeente' : 'bestaat al'}</Badge>
              <div className="zacht klein">{[g.velden.samenwerkingsverband, g.velden.inwoners !== null ? `${g.velden.inwoners.toLocaleString('nl-NL')} inwoners` : '', g.velden.salesAm && `sales ${g.velden.salesAm}`, g.velden.contractEinde && `contract tot ${datum(g.velden.contractEinde)}`].filter(Boolean).join(' · ')}</div>
              <ul className="klein" style={{ margin: '2px 0 0', paddingLeft: 20 }}>
                {g.contacten.map((c, i) => <li key={i}>{c.naam}{(c.functie || c.rol || c.email || c.telefoon) && <span className="zacht"> · {[c.functie, c.rol, c.email, c.telefoon].filter(Boolean).join(' · ')}</span>} <span className="zacht">({c.status === 'nieuw' ? 'wordt toegevoegd' : 'staat er al'})</span></li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
      <Melding tekst={melding?.tekst ?? null} soort={melding?.soort} />
      <div className="rij">
        <button type="button" onClick={() => void toon()} disabled={!tekst.trim()}>Voorbeeld tonen</button>
        <button type="button" className="primair" onClick={() => void voegToe()} disabled={!voorbeeld || (nieuweGemeenten === 0 && nieuweContacten === 0)}>{voorbeeld ? `${nieuweGemeenten} gemeenten en ${nieuweContacten} contactpersonen toevoegen` : 'Toevoegen'}</button>
      </div>
    </section>
  );
}

export function Klanten() {
  const lijst = useLaden(() => api<KlantRegel[]>('GET', '/klanten'));
  const [zoek, setZoek] = useState('');
  const [nieuw, setNieuw] = useState<{ naam: string; status: KlantStatus } | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [importeer, setImporteer] = useState(false);
  const zichtbaar = (lijst.data ?? []).filter((k) => k.naam.toLowerCase().includes(zoek.trim().toLowerCase()));
  const voorgesteld = (lijst.data ?? []).filter((k) => k.status === 'voorgesteld');

  async function maakAan(e: FormEvent) {
    e.preventDefault();
    try { await api('POST', '/klanten', nieuw); setNieuw(null); setFout(null); lijst.ververs(); } catch (err) { setFout(foutTekst(err)); }
  }
  return (
    <div className="stapel">
      <div className="rij spreid">
        <div><h1>Klanten</h1><p className="zacht">Klanten uit verkoop-debriefs, met bezoeken, afspraken en kansen. Een klant die alleen uit een gesprek komt is een voorstel tot jij hem bevestigt.</p></div>
        <div className="rij">
          <button onClick={() => setImporteer(!importeer)} aria-expanded={importeer}>{importeer ? 'Importeren sluiten' : 'Lijst importeren'}</button>
          <button className="primair" onClick={() => setNieuw(nieuw ? null : { naam: '', status: 'klant' })}>{nieuw ? 'Annuleren' : 'Nieuwe klant'}</button>
        </div>
      </div>
      {importeer && <Importeren klaar={lijst.ververs} />}
      {nieuw && (
        <form className="paneel stapel" onSubmit={maakAan}>
          <div className="raster">
            <Veld label="Naam"><input value={nieuw.naam} onChange={(e) => setNieuw({ ...nieuw, naam: e.target.value })} required maxLength={200} /></Veld>
            <Veld label="Status">
              <select value={nieuw.status} onChange={(e) => setNieuw({ ...nieuw, status: e.target.value as KlantStatus })}>
                <option value="klant">Klant</option><option value="prospect">Prospect</option>
              </select>
            </Veld>
          </div>
          <Melding tekst={fout} />
          <button className="primair" type="submit">Toevoegen</button>
        </form>
      )}
      <Melding tekst={lijst.fout} />
      {voorgesteld.length > 0 && <p className="melding" role="status">{voorgesteld.length} {voorgesteld.length === 1 ? 'klant wacht' : 'klanten wachten'} op bevestiging of samenvoegen (status Voorgesteld).</p>}
      <Veld label="Zoeken"><input type="search" value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Naam van de klant" /></Veld>
      {lijst.data?.length === 0 && <Leeg>Nog geen klanten. Ze verschijnen na de eerste verkoop-debrief.</Leeg>}
      {zichtbaar.map((k) => (
        <div key={k.id} className="paneel rij spreid">
          <div>
            <h3><Link to={`/klanten/${k.id}`}>{k.naam}</Link> <Badge soort={k.status === 'voorgesteld' ? 'wacht' : ''}>{KLANT_STATUS_LABEL[k.status]}</Badge></h3>
            <span className="zacht klein">
              {k.accountmanagerNaam ? `Accountmanager ${k.accountmanagerNaam}` : 'Geen accountmanager'}
              {k.laatsteBezoek && ` · laatste bezoek ${datum(k.laatsteBezoek)}`}
              {k.contractEinde && ` · contract tot ${datum(k.contractEinde)}`}
            </span>
            {(k.samenwerkingsverband || k.inwoners !== null || k.salesAm) && (
              <div className="zacht klein">{[k.samenwerkingsverband, k.inwoners !== null && `${k.inwoners.toLocaleString('nl-NL')} inwoners`, k.salesAm && `sales ${k.salesAm}`].filter(Boolean).join(' · ')}</div>
            )}
          </div>
          <span className="zacht klein">{k.openActiviteiten} open</span>
        </div>
      ))}
    </div>
  );
}
