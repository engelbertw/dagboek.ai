import PDFDocument from 'pdfkit';
import { afterEach, describe, expect, it } from 'vitest';
import { bezoekTeller } from '../bezoekteller.js';
import { beoordeelEvaluaties, emailLijktBijNaam, evaluatieInhoudHash, evaluatieSleutel, GeenFeedbackRapport, leesFeedbackRapport, leesPdfPaginas, samenvatting, type Evaluatie } from '../ithermometer-import.js';
import { magDoen } from '../rollen.js';
import { klantContacten, klantEvaluaties, klanten } from '../schema.js';
import { maakTestApp } from './helpers.js';

// Synthetische gegevens in de lay-out van een iThermometer-feedbackrapport (geen echte klantgegevens).
interface Opties { gemeente: string; datum?: string; contact?: string; functie?: string; email?: string; mobiel?: string; scores?: string[]; reden?: string; domein?: string; aangemaakt?: string }
function evaluatiePaginas(o: Opties): string[][] {
  const { gemeente, datum = '3-11-2026', contact = 'Anna Voorbeeld', functie = 'Teamleider', email = 'a.voorbeeld@test.example', mobiel = '—', scores = ['8', '7', '9', '8', '8', '8'], reden = 'Goede samenwerking.', domein, aangemaakt = datum } = o;
  const labels = ['Aanbevelen Publiekszaken', 'Strategische samenwerking', 'Klantgerichtheid', 'Opvolging', 'Communicatie', 'Samenwerking'];
  const eerste = [
    gemeente, `${contact} · ${functie} · ${datum}`, 'GEGEVENS', 'Gemeente', gemeente, 'Datum', datum, 'Contactpersoon', contact, 'Functie', ...functie.split('|'), 'E-mail', email, 'Mobiel', mobiel,
    'Business unit', 'Publiekszaken', 'Aangemaakt op', aangemaakt, 'SCORES', ...labels.flatMap((l, i) => [l, `${scores[i]}/10`]),
    'TOELICHTING', 'Reden voor score', reden, 'Wat moeten we vooral blijven doen?', 'Stabiel en veilig.', 'Eerste regel van een antwoord', 'tweede regel van hetzelfde antwoord',
    'Wat moeten we als eerste verbeteren?', '—', 'Welke ondersteuning of samenwerking verwacht je de komende 12 maanden van ons?', 'Meer overleg.',
  ];
  const tweede = ["TOP 3 THEMA'S & DROMEN OP VOLGORDE", '#1 kwaliteit', '1. Altijd leren van inwoners', '2. Snelheid als standaard', ...(domein ? ['FEEDBACK PER DOMEIN', domein] : [])];
  return [eerste, tweede];
}
/** Zet pagina's om naar de tekst per pagina, met voettekst en inhoudsopgave zoals in het echte rapport. */
function rapport(evaluaties: Opties[]): string[] {
  const paginas = evaluaties.flatMap(evaluatiePaginas);
  const totaal = paginas.length + 1;
  const toc = ['Feedback rapport', 'Publiekszaken', 'Geëxporteerd op 5-11-2026', `${evaluaties.length} evaluaties`, 'INHOUD', ...evaluaties.flatMap((e) => [`${e.gemeente} — ${e.datum ?? '3-11-2026'}`, '2'])];
  return [toc.join('\n'), ...paginas.map((p, i) => [...p, evaluaties[Math.floor(i / 2)].gemeente, `Pagina ${i + 2} van ${totaal}`].join('\n'))];
}
async function maakPdf(paginas: string[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const delen: Buffer[] = [];
    doc.on('data', (d: Buffer) => delen.push(d)); doc.on('end', () => resolve(Buffer.concat(delen)));
    paginas.forEach((p, i) => { if (i) doc.addPage(); doc.font('Helvetica').fontSize(8).text(p, { lineGap: 1 }); });
    doc.end();
  });
}
const E = (o: Partial<Evaluatie> = {}): Evaluatie => ({
  gemeente: 'Testdorp', datum: '2026-11-03', aangemaakt: '2026-11-03', contact: { naam: 'Anna Voorbeeld', functie: 'Teamleider', email: 'a.voorbeeld@test.example', telefoon: '' }, businessUnit: 'Publiekszaken',
  scores: [{ label: 'Aanbevelen', waarde: 8 }], toelichting: [{ vraag: 'Reden voor score', antwoord: 'Goed.' }], themas: '#1 kwaliteit', domeinfeedback: '', ...o,
});

describe('leesFeedbackRapport', () => {
  it('leest een evaluatie over twee pagina\'s met voettekst en inhoudsopgave', () => {
    const u = leesFeedbackRapport(rapport([{ gemeente: 'Testdorp', functie: 'Senior Beleidsmedewerker|Backoffice Afdeling', domein: 'Burgerzaken: alles goed.' }]));
    expect(u.nietLeesbaar).toEqual([]);
    expect(u.evaluaties).toHaveLength(1);
    const e = u.evaluaties[0];
    expect(e).toMatchObject({ gemeente: 'Testdorp', datum: '2026-11-03', aangemaakt: '2026-11-03', businessUnit: 'Publiekszaken' });
    expect(e.contact).toEqual({ naam: 'Anna Voorbeeld', functie: 'Senior Beleidsmedewerker Backoffice Afdeling', email: 'a.voorbeeld@test.example', telefoon: '' }); // functie over 2 regels, mobiel '—' = leeg
    expect(e.scores).toHaveLength(6);
    expect(e.scores[1]).toEqual({ label: 'Strategische samenwerking', waarde: 7 });
    expect(e.toelichting.map((t) => t.vraag)).toEqual(['Reden voor score', 'Wat moeten we vooral blijven doen?', 'Wat moeten we als eerste verbeteren?', 'Welke ondersteuning of samenwerking verwacht je de komende 12 maanden van ons?']);
    expect(e.toelichting[1].antwoord).toBe('Stabiel en veilig.\nEerste regel van een antwoord\ntweede regel van hetzelfde antwoord');
    expect(e.toelichting[2].antwoord).toBe(''); // '—' = geen antwoord
    expect(e.themas).toContain('1. Altijd leren van inwoners');
    expect(e.themas).not.toContain('Pagina');
    expect(e.domeinfeedback).toBe('Burgerzaken: alles goed.');
  });

  it('leest meerdere evaluaties, ook met een evaluatie zonder tweede pagina-inhoud', () => {
    const u = leesFeedbackRapport(rapport([{ gemeente: 'Eerste', datum: '1-11-2026' }, { gemeente: 'Tweede', datum: '2-11-2026', scores: ['10', '0', '5', '5', '5', '5'] }]));
    expect(u.evaluaties.map((e) => [e.gemeente, e.datum])).toEqual([['Eerste', '2026-11-01'], ['Tweede', '2026-11-02']]);
    expect(u.evaluaties[1].scores.map((s) => s.waarde)).toEqual([10, 0, 5, 5, 5, 5]); // 0/10 is een gegeven antwoord en wordt niet weggelaten
  });

  it('meldt een evaluatie zonder geldige datum als niet te lezen in plaats van haar weg te laten', () => {
    const u = leesFeedbackRapport(rapport([{ gemeente: 'Kapot', datum: '31-02-2026' }, { gemeente: 'Heel' }]));
    expect(u.evaluaties.map((e) => e.gemeente)).toEqual(['Heel']);
    expect(u.nietLeesbaar).toEqual([{ titel: 'Kapot', reden: 'geen geldige datum' }]);
  });

  it('weigert een bestand dat geen feedbackrapport is', () => {
    expect(() => leesFeedbackRapport(['Een gewone brief\nZonder evaluaties'])).toThrow(GeenFeedbackRapport);
  });
});

describe('dubbelen beoordelen', () => {
  const klantenLijst = [{ id: 'k1', naam: 'Gemeente Testdorp' }];
  it('herkent nieuw, al aanwezig, gewijzigd en dubbel in bestand; de schrijfwijze van de gemeente maakt niet uit', () => {
    const a = E(), b = E({ gemeente: 'Gemeente Testdorp', datum: '2026-10-01' }), c = E({ datum: '2026-09-01' });
    const bestaand = [{ sleutel: evaluatieSleutel(b), inhoudHash: evaluatieInhoudHash(b) }, { sleutel: evaluatieSleutel(c), inhoudHash: 'anders' }];
    const r = beoordeelEvaluaties([a, E(), b, c, E({ scores: [{ label: 'Aanbevelen', waarde: 3 }] })], bestaand, klantenLijst, [{ klantId: 'k1', naam: 'anna voorbeeld' }]);
    expect(r.map((x) => x.status)).toEqual(['nieuw', 'dubbel_in_bestand', 'al_aanwezig', 'gewijzigd', 'dubbel_in_bestand']);
    expect(r.map((x) => x.afwijkend)).toEqual([false, false, false, false, true]);
    expect(r[0].klantId).toBe('k1');
    expect(r[0].contact).toBe('bestaat');
    expect(evaluatieSleutel(a)).toBe(evaluatieSleutel(E({ gemeente: 'Gemeente Testdorp' })));
    expect(samenvatting(r, 1)).toMatchObject({ nieuw: 1, al_aanwezig: 1, gewijzigd: 1, dubbel_in_bestand: 2, nietLeesbaar: 1, gemeenteOnbekend: 0 });
  });
  it('een andere paginabreedte (regelafbrekingen) telt niet als wijziging; een andere score wel', () => {
    const a = E({ toelichting: [{ vraag: 'Reden voor score', antwoord: 'Eerste regel\ntweede regel' }] });
    expect(evaluatieInhoudHash(a)).toBe(evaluatieInhoudHash(E({ toelichting: [{ vraag: 'Reden voor score', antwoord: 'Eerste regel tweede  regel' }] })));
    expect(evaluatieInhoudHash(a)).not.toBe(evaluatieInhoudHash(E({ scores: [{ label: 'Aanbevelen', waarde: 7 }] })));
  });
  it('markeert een onbekende gemeente en een nieuwe contactpersoon', () => {
    const [r] = beoordeelEvaluaties([E({ gemeente: 'Elders' })], [], klantenLijst, []);
    expect(r).toMatchObject({ klantId: null, contact: 'nieuw' });
  });
  it('geeft een hint als het e-mailadres niet bij de naam lijkt te horen', () => {
    expect(emailLijktBijNaam('Jolanda van Loon', 'y.vandenheuvel@loonopzand.nl')).toBe(false);
    expect(emailLijktBijNaam('Camiel van Aarnhem', 'camiel.vanaarnhem@gemeentebeek.nl')).toBe(true);
    expect(emailLijktBijNaam('Nicole Heijmens-Visser', 'm.pot@waalwijk.nl')).toBe(false);
    expect(emailLijktBijNaam('Esther van Gool', 'e.vangool@test.example')).toBe(true);
    expect(emailLijktBijNaam('', 'x@y.nl')).toBe(true);
  });
});

describe('PDF lezen', () => {
  it('leest een echte PDF en weigert niet-PDF-bestanden', async () => {
    const pdf = await maakPdf(rapport([{ gemeente: 'Testdorp' }]));
    const u = leesFeedbackRapport(await leesPdfPaginas(pdf));
    expect(u.evaluaties).toHaveLength(1);
    expect(u.evaluaties[0].scores).toHaveLength(6);
    await expect(leesPdfPaginas(Buffer.from('dit is tekst'))).rejects.toThrow(GeenFeedbackRapport);
    await expect(leesPdfPaginas(Buffer.from('%PDF-1.4 kapot'))).rejects.toThrow(GeenFeedbackRapport);
  });
});

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });
const PDF = { 'content-type': 'application/pdf' };

describe('importeren via de routes', () => {
  async function opzet() {
    const t = await maakTestApp(); open.push(t);
    const [k] = await t.db.insert(klanten).values({ naam: 'Gemeente Testdorp', status: 'klant', bron: 'handmatig' }).returning();
    return { t, k };
  }
  const voorbeeld = async (t: T, opties: Opties[]) => t.apiRaw('POST', '/api/evaluaties/import/voorbeeld', await maakPdf(rapport(opties)), PDF);
  const bevestig = (t: T, v: { evaluaties: { evaluatie: unknown; status: string; sleutel: string }[] }, per: Record<string, unknown> = {}) =>
    t.api('POST', '/api/evaluaties/import/bevestig', { evaluaties: v.evaluaties.filter((e) => e.status !== 'dubbel_in_bestand' && e.status !== 'al_aanwezig').map((e) => ({ evaluatie: e.evaluatie, ...per })) });

  it('toont een voorbeeld zonder iets op te slaan, importeert, en een tweede upload voegt niets toe', async () => {
    const { t, k } = await opzet();
    const lijst: Opties[] = [{ gemeente: 'Testdorp', datum: '3-11-2026' }, { gemeente: 'Testdorp', datum: '3-11-2026' }, { gemeente: 'Testdorp', datum: '1-10-2026', contact: 'Piet Tweede' }];
    const r = await voorbeeld(t, lijst);
    expect(r.statusCode).toBe(200);
    const v = r.json();
    expect(v.samenvatting).toMatchObject({ nieuw: 2, al_aanwezig: 0, dubbel_in_bestand: 1 });
    expect(v.evaluaties[0]).toMatchObject({ klantId: k.id, klantNaam: 'Gemeente Testdorp', contact: 'nieuw' });
    expect(await t.db.select().from(klantEvaluaties)).toHaveLength(0);

    const b = await bevestig(t, v);
    expect(b.json()).toMatchObject({ aangemaakt: 2, contactenAangemaakt: 2, klantenAangemaakt: 0 });
    const contacten = await t.db.select().from(klantContacten);
    expect(contacten.map((c) => c.naam).sort()).toEqual(['Anna Voorbeeld', 'Piet Tweede']);
    expect(contacten.find((c) => c.naam === 'Anna Voorbeeld')).toMatchObject({ email: 'a.voorbeeld@test.example', functie: 'Teamleider', telefoon: '' });

    // Hetzelfde bestand nogmaals: niets nieuw, en bevestigen voegt niets toe.
    const opnieuw = (await voorbeeld(t, lijst)).json();
    expect(opnieuw.samenvatting).toMatchObject({ nieuw: 0, al_aanwezig: 2, dubbel_in_bestand: 1 });
    const alles = await t.api('POST', '/api/evaluaties/import/bevestig', { evaluaties: opnieuw.evaluaties.map((e: { evaluatie: unknown }) => ({ evaluatie: e.evaluatie })) });
    expect(alles.json()).toMatchObject({ aangemaakt: 0, contactenAangemaakt: 0, overgeslagen: { al_aanwezig: 2, dubbel: 1 } });
    expect(await t.db.select().from(klantEvaluaties)).toHaveLength(2);
    expect(await t.db.select().from(klantContacten)).toHaveLength(2);
  });

  it('twee keer tegelijk bevestigen geeft geen dubbelen', async () => {
    const { t } = await opzet();
    const v = (await voorbeeld(t, [{ gemeente: 'Testdorp' }])).json();
    const [a, b] = await Promise.all([bevestig(t, v), bevestig(t, v)]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(await t.db.select().from(klantEvaluaties)).toHaveLength(1);
  });

  it('een gewijzigde evaluatie wordt alleen op verzoek bijgewerkt', async () => {
    const { t } = await opzet();
    await bevestig(t, (await voorbeeld(t, [{ gemeente: 'Testdorp', reden: 'Eerste' }])).json());
    const v = (await voorbeeld(t, [{ gemeente: 'Testdorp', reden: 'Aangepast' }])).json();
    expect(v.samenvatting.gewijzigd).toBe(1);
    const zonder = await t.api('POST', '/api/evaluaties/import/bevestig', { evaluaties: [{ evaluatie: v.evaluaties[0].evaluatie }] });
    expect(zonder.json()).toMatchObject({ aangemaakt: 0, bijgewerkt: 0, overgeslagen: { gewijzigd: 1 } });
    expect((await t.db.select().from(klantEvaluaties))[0].toelichting[0].antwoord).toBe('Eerste');
    const met = await t.api('POST', '/api/evaluaties/import/bevestig', { evaluaties: [{ evaluatie: v.evaluaties[0].evaluatie, bijwerken: true }] });
    expect(met.json()).toMatchObject({ bijgewerkt: 1 });
    const rijen = await t.db.select().from(klantEvaluaties);
    expect(rijen).toHaveLength(1);
    expect(rijen[0].toelichting[0].antwoord).toBe('Aangepast');
  });

  it('een onbekende gemeente wordt overgeslagen, als voorstel aangemaakt of aan een gekozen klant gekoppeld', async () => {
    const { t, k } = await opzet();
    const v = (await voorbeeld(t, [{ gemeente: 'Nieuwstad' }])).json();
    expect(v.evaluaties[0]).toMatchObject({ klantId: null, klantNaam: null });
    expect((await bevestig(t, v)).json()).toMatchObject({ aangemaakt: 0, overgeslagen: { gemeente_onbekend: 1 } });
    const nieuw = (await bevestig(t, v, { klant: 'nieuw', contactToevoegen: false })).json();
    expect(nieuw).toMatchObject({ aangemaakt: 1, klantenAangemaakt: 1, contactenAangemaakt: 0 });
    expect((await t.db.select().from(klanten)).find((x) => x.naam === 'Nieuwstad')).toMatchObject({ status: 'voorgesteld' });
    // Een gekozen bestaande klant
    const w = (await voorbeeld(t, [{ gemeente: 'Andere naam', datum: '5-11-2026' }])).json();
    expect((await bevestig(t, w, { klant: k.id })).json()).toMatchObject({ aangemaakt: 1, klantenAangemaakt: 0 });
    expect((await t.api('GET', `/api/klanten/${k.id}/evaluaties`)).json()).toHaveLength(1);
    // Een niet-bestaande klant-id geldt als niet gekozen
    expect((await bevestig(t, (await voorbeeld(t, [{ gemeente: 'Weer iets', datum: '6-11-2026' }])).json(), { klant: '00000000-0000-4000-8000-000000000000' })).json().overgeslagen.gemeente_onbekend).toBe(1);
  });

  it('koppelt aan een bestaande contactpersoon en maakt er geen dubbele bij', async () => {
    const { t, k } = await opzet();
    const [c] = await t.db.insert(klantContacten).values({ klantId: k.id, naam: 'Anna  Voorbeeld' }).returning();
    const r = await bevestig(t, (await voorbeeld(t, [{ gemeente: 'Testdorp' }])).json());
    expect(r.json()).toMatchObject({ aangemaakt: 1, contactenAangemaakt: 0 });
    expect((await t.db.select().from(klantEvaluaties))[0].contactId).toBe(c.id);
    expect(await t.db.select().from(klantContacten)).toHaveLength(1);
  });

  it('weigert een ongeldig of te groot bestand en een evaluatie met ongeldige gegevens', async () => {
    const { t } = await opzet();
    expect((await t.apiRaw('POST', '/api/evaluaties/import/voorbeeld', Buffer.from('geen pdf'), PDF)).statusCode).toBe(422);
    expect((await t.apiRaw('POST', '/api/evaluaties/import/voorbeeld', await maakPdf(['Een gewone brief']), PDF)).statusCode).toBe(422);
    expect((await t.apiRaw('POST', '/api/evaluaties/import/voorbeeld', Buffer.alloc(0), PDF)).statusCode).toBeGreaterThanOrEqual(400);
    expect((await t.apiRaw('POST', '/api/evaluaties/import/voorbeeld', Buffer.from('x'), { 'content-type': 'text/plain' })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await t.api('POST', '/api/evaluaties/import/bevestig', { evaluaties: [{ evaluatie: { ...E(), datum: 'morgen' } }] })).statusCode).toBe(400);
    expect((await t.api('POST', '/api/evaluaties/import/bevestig', { evaluaties: [] })).statusCode).toBe(400);
  });

  it('telt de evaluaties mee in de teller, apart van de bezoeken', async () => {
    const { t } = await opzet();
    await bevestig(t, (await voorbeeld(t, [{ gemeente: 'Testdorp', datum: '3-11-2026' }, { gemeente: 'Testdorp', datum: '3-3-2025', contact: 'Oud Contact' }])).json());
    const jaar = await bezoekTeller(t.db, 'jaar', new Date('2026-11-05T10:00:00Z'));
    expect(jaar).toMatchObject({ bezoeken: 0, evaluaties: 1 });
  });

  it('rechten: importeren alleen beheerder; lezen per klant ook accountmanager, niet administratie of consultant', () => {
    for (const rol of ['accountmanager', 'administratie', 'consultant']) {
      expect(magDoen(rol, 'POST', '/api/evaluaties/import/voorbeeld'), rol).toBe(false);
      expect(magDoen(rol, 'POST', '/api/evaluaties/import/bevestig'), rol).toBe(false);
    }
    const pad = '/api/klanten/11111111-1111-4111-8111-111111111111/evaluaties';
    expect(magDoen('beheerder', 'GET', pad)).toBe(true);
    expect(magDoen('accountmanager', 'GET', pad)).toBe(true);
    expect(magDoen('accountmanager', 'DELETE', pad)).toBe(false);
    for (const rol of ['administratie', 'consultant']) expect(magDoen(rol, 'GET', pad), rol).toBe(false);
  });

  it('wissen van een klant ruimt de evaluaties op', async () => {
    const { t, k } = await opzet();
    await bevestig(t, (await voorbeeld(t, [{ gemeente: 'Testdorp' }])).json());
    expect((await t.api('DELETE', `/api/klanten/${k.id}`)).statusCode).toBeLessThan(300);
    expect(await t.db.select().from(klantEvaluaties)).toHaveLength(0);
  });
});
