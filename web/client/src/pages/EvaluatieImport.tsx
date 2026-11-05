import { useState } from 'react';
import { Link } from 'react-router-dom';
import { datum } from '../api';
import { Badge, Melding, foutTekst } from '../ui';

type Status = 'nieuw' | 'al_aanwezig' | 'gewijzigd' | 'dubbel_in_bestand';
interface Evaluatie {
  gemeente: string; datum: string; aangemaakt: string | null;
  contact: { naam: string; functie: string; email: string; telefoon: string };
  businessUnit: string; scores: { label: string; waarde: number | null }[]; toelichting: { vraag: string; antwoord: string }[]; themas: string; domeinfeedback: string;
}
interface Regel {
  evaluatie: Evaluatie; sleutel: string; status: Status; afwijkend: boolean; klantId: string | null; klantNaam: string | null;
  contact: 'nieuw' | 'bestaat' | 'geen'; emailTwijfel: boolean; suggesties: { id: string; naam: string }[];
}
interface Voorbeeld {
  samenvatting: Record<Status | 'nietLeesbaar' | 'gemeenteOnbekend', number>; nietLeesbaar: { titel: string; reden: string }[]; evaluaties: Regel[]; klanten: { id: string; naam: string }[];
}
interface Resultaat { aangemaakt: number; bijgewerkt: number; klantenAangemaakt: number; contactenAangemaakt: number; overgeslagen: { al_aanwezig: number; gewijzigd: number; dubbel: number; gemeente_onbekend: number } }
/** Per regel de keuze van de beheerder. */
interface Keuze { meedoen: boolean; bijwerken: boolean; contactToevoegen: boolean; klant: string }

const STATUS_TEKST: Record<Status, string> = { nieuw: 'Nieuw', al_aanwezig: 'Al aanwezig', gewijzigd: 'Gewijzigd', dubbel_in_bestand: 'Dubbel in bestand' };
const NIEUW = 'nieuw';

class UploadFout extends Error {}
async function stuur<T>(pad: string, body: BodyInit, type: string): Promise<T> {
  const r = await fetch(`/api${pad}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': type }, body });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new UploadFout(data.fout ?? `Fout ${r.status}`);
  return data as T;
}

export function EvaluatieImport() {
  const [voorbeeld, setVoorbeeld] = useState<Voorbeeld | null>(null);
  const [keuzes, setKeuzes] = useState<Record<string, Keuze>>({});
  const [bestandsnaam, setBestandsnaam] = useState('');
  const [bezig, setBezig] = useState(false);
  const [resultaat, setResultaat] = useState<Resultaat | null>(null);
  const [melding, setMelding] = useState<string | null>(null);

  async function lees(bestand: File | undefined) {
    if (!bestand) return;
    setBezig(true); setMelding(null); setResultaat(null); setVoorbeeld(null); setBestandsnaam(bestand.name);
    try {
      const v = await stuur<Voorbeeld>('/evaluaties/import/voorbeeld', bestand, 'application/pdf');
      setVoorbeeld(v);
      const k: Record<string, Keuze> = {};
      for (const r of v.evaluaties) k[r.sleutel] = { meedoen: r.status === 'nieuw', bijwerken: false, contactToevoegen: r.contact === 'nieuw', klant: r.klantId ?? '' };
      setKeuzes(k);
    } catch (e) { setMelding(foutTekst(e)); } finally { setBezig(false); }
  }

  const zet = (sleutel: string, wijziging: Partial<Keuze>) => setKeuzes((k) => ({ ...k, [sleutel]: { ...k[sleutel], ...wijziging } }));
  const geselecteerd = (voorbeeld?.evaluaties ?? []).filter((r) => r.status !== 'dubbel_in_bestand' && keuzes[r.sleutel]?.meedoen);
  const zonderGemeente = geselecteerd.filter((r) => !keuzes[r.sleutel]?.klant).length;

  async function importeer() {
    if (!voorbeeld) return;
    setBezig(true); setMelding(null);
    try {
      const r = await stuur<Resultaat>('/evaluaties/import/bevestig', JSON.stringify({
        evaluaties: geselecteerd.map((x) => {
          const k = keuzes[x.sleutel];
          return { evaluatie: x.evaluatie, klant: k.klant || undefined, bijwerken: x.status === 'gewijzigd' && k.bijwerken, contactToevoegen: k.contactToevoegen };
        }),
      }), 'application/json');
      setResultaat(r); setVoorbeeld(null);
    } catch (e) { setMelding(foutTekst(e)); } finally { setBezig(false); }
  }

  return (
    <div className="stapel">
      <div>
        <h1>Evaluaties importeren</h1>
        <p className="zacht">Lees een "Feedback rapport" uit iThermometer (PDF) in. Je ziet eerst een voorbeeld: er wordt pas iets opgeslagen als je op Importeren klikt. Evaluaties die er al staan worden niet nog een keer toegevoegd.
          Alleen de uitgelezen gegevens worden bewaard, niet het PDF-bestand zelf.</p>
      </div>

      <section className="paneel stapel" aria-label="Bestand kiezen">
        <label className="veld"><span>PDF-bestand (maximaal 10 MB)</span>
          <input type="file" accept="application/pdf,.pdf" disabled={bezig} onChange={(e) => { void lees(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {bezig && <p role="status">Bezig...</p>}
        <Melding tekst={melding} />
      </section>

      {resultaat && (
        <section className="paneel stapel" aria-label="Resultaat">
          <h2>Klaar</h2>
          <p role="status"><strong>{resultaat.aangemaakt}</strong> evaluaties toegevoegd{resultaat.bijgewerkt ? `, ${resultaat.bijgewerkt} bijgewerkt` : ''}
            {resultaat.klantenAangemaakt ? `, ${resultaat.klantenAangemaakt} nieuwe gemeente(n) als voorstel aangemaakt (controleer ze bij Klanten)` : ''}
            {resultaat.contactenAangemaakt ? `, ${resultaat.contactenAangemaakt} nieuwe contactpersoon(en)` : ''}.</p>
          <p className="zacht klein">Overgeslagen: {resultaat.overgeslagen.al_aanwezig} al aanwezig, {resultaat.overgeslagen.gewijzigd} gewijzigd (niet bijgewerkt), {resultaat.overgeslagen.dubbel} dubbel, {resultaat.overgeslagen.gemeente_onbekend} zonder gemeente.</p>
          <p><Link to="/dagboek">Naar het dagboek</Link> · <Link to="/klanten">Naar de klanten</Link></p>
        </section>
      )}

      {voorbeeld && (
        <section className="paneel stapel" aria-label="Voorbeeld">
          <h2>Voorbeeld: {bestandsnaam}</h2>
          <ul className="rij" style={{ gap: '1rem', listStyle: 'none', padding: 0 }}>
            <li><strong>{voorbeeld.samenvatting.nieuw}</strong> nieuw</li>
            <li><strong>{voorbeeld.samenvatting.al_aanwezig}</strong> al aanwezig</li>
            <li><strong>{voorbeeld.samenvatting.gewijzigd}</strong> gewijzigd</li>
            <li><strong>{voorbeeld.samenvatting.dubbel_in_bestand}</strong> dubbel in bestand</li>
            {voorbeeld.samenvatting.nietLeesbaar > 0 && <li><strong>{voorbeeld.samenvatting.nietLeesbaar}</strong> niet te lezen</li>}
          </ul>
          {voorbeeld.nietLeesbaar.length > 0 && <Melding tekst={`Niet te lezen: ${voorbeeld.nietLeesbaar.map((n) => `${n.titel} (${n.reden})`).join('; ')}`} />}

          {voorbeeld.evaluaties.map((r) => {
            const k = keuzes[r.sleutel];
            const e = r.evaluatie;
            const dubbel = r.status === 'dubbel_in_bestand';
            return (
              <div key={r.sleutel + e.datum + r.status} className="stapel" style={{ borderTop: '1px solid var(--rand)', paddingTop: '.75rem', opacity: dubbel ? 0.65 : 1 }}>
                <div className="rij spreid">
                  <label className="rij">
                    <input type="checkbox" checked={!!k?.meedoen && !dubbel} disabled={dubbel || (r.status === 'al_aanwezig')} onChange={(ev) => zet(r.sleutel, { meedoen: ev.target.checked })} />
                    <strong>{e.gemeente}</strong> <span className="zacht">{datum(e.datum)}{e.businessUnit ? ` · ${e.businessUnit}` : ''}</span>
                  </label>
                  <Badge soort={r.status === 'nieuw' ? '' : 'wacht'}>{STATUS_TEKST[r.status]}</Badge>
                </div>
                <p className="zacht klein">
                  {e.contact.naam || 'Geen contactpersoon'}{e.contact.functie ? `, ${e.contact.functie}` : ''}
                  {e.contact.email ? ` · ${e.contact.email}` : ''}{e.contact.telefoon ? ` · ${e.contact.telefoon}` : ''}
                  {' · '}scores: {e.scores.map((s) => (s.waarde ?? '-')).join(' / ')}
                </p>
                {dubbel && <p className="zacht klein">Deze evaluatie staat er in dit bestand al eerder in{r.afwijkend ? ', maar met andere inhoud: alleen de eerste wordt gebruikt' : ''}.</p>}
                {r.status === 'al_aanwezig' && <p className="zacht klein">Staat al in dagboek.ai, met dezelfde inhoud.</p>}
                {r.status === 'gewijzigd' && (
                  <label className="rij"><input type="checkbox" checked={!!k?.bijwerken} disabled={!k?.meedoen} onChange={(ev) => zet(r.sleutel, { bijwerken: ev.target.checked })} />
                    Staat al maar met andere inhoud: bestaande evaluatie bijwerken (anders blijft die zoals hij is)</label>
                )}
                {!dubbel && r.status !== 'al_aanwezig' && (
                  <div className="rij">
                    <label className="rij">Gemeente
                      <select value={k?.klant ?? ''} onChange={(ev) => zet(r.sleutel, { klant: ev.target.value })}>
                        {!r.klantId && <option value="">Kies een gemeente...</option>}
                        {!r.klantId && <option value={NIEUW}>Nieuwe gemeente aanmaken: {e.gemeente}</option>}
                        {voorbeeld.klanten.map((x) => <option key={x.id} value={x.id}>{x.naam}</option>)}
                      </select>
                    </label>
                    {!r.klantId && r.suggesties.length > 0 && <span className="zacht klein">Lijkt op: {r.suggesties.map((s) => s.naam).join(', ')}</span>}
                    {e.contact.naam && r.contact !== 'bestaat' && (
                      <label className="rij"><input type="checkbox" checked={!!k?.contactToevoegen} onChange={(ev) => zet(r.sleutel, { contactToevoegen: ev.target.checked })} />
                        Contactpersoon toevoegen</label>
                    )}
                    {r.contact === 'bestaat' && <span className="zacht klein">Contactpersoon staat al bij de gemeente; de evaluatie wordt eraan gekoppeld.</span>}
                  </div>
                )}
                {r.emailTwijfel && !dubbel && <p className="zacht klein" role="note">Let op: het e-mailadres lijkt niet bij de naam van de contactpersoon te horen. Controleer dit voor je de contactpersoon toevoegt.</p>}
              </div>
            );
          })}

          <div className="rij">
            <button className="primair" type="button" disabled={bezig || geselecteerd.length === 0 || zonderGemeente > 0} onClick={() => void importeer()}>
              {geselecteerd.length === 0 ? 'Niets te importeren' : `Importeren (${geselecteerd.length})`}
            </button>
            {zonderGemeente > 0 && <span className="zacht klein">Kies bij {zonderGemeente} evaluatie(s) eerst een gemeente.</span>}
          </div>
        </section>
      )}
    </div>
  );
}
