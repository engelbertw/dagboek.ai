import { afterEach, describe, expect, it } from 'vitest';
import { klanten } from '../schema.js';
import { magDoen } from '../rollen.js';
import { pdfTekst, rapportBestandsnaam, maakKlantRapport, contrast, leesbaarOpWit, tekstOp, geldigeKleur } from '../klant-rapport.js';
import { maakTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

describe('klantrapport als PDF', () => {
  it('geeft een PDF-download voor een klant, met een nette bestandsnaam', async () => {
    const t = await maakTestApp(); open.push(t);
    const [k] = await t.db.insert(klanten).values({ naam: 'Gemeente Venlo', status: 'klant', bron: 'handmatig' }).returning();
    const r = await t.api('GET', `/api/klanten/${k.id}/rapport.pdf`);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(String(r.headers['content-disposition'])).toMatch(/^attachment; filename="klantrapport-Gemeente-Venlo-\d{4}-\d{2}-\d{2}\.pdf"$/);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(r.rawPayload.length).toBeGreaterThan(1000);
  });

  it('geeft 404 voor een onbekende of ongeldige klant', async () => {
    const t = await maakTestApp(); open.push(t);
    expect((await t.api('GET', '/api/klanten/00000000-0000-4000-8000-000000000000/rapport.pdf')).statusCode).toBe(404);
    expect((await t.api('GET', '/api/klanten/geen-uuid/rapport.pdf')).statusCode).toBe(404);
  });

  it('volgt de rechten van de voorbereiding: accountmanager, administratie en consultant mogen het lezen, niet wijzigen', () => {
    const pad = '/api/klanten/11111111-1111-4111-8111-111111111111/rapport.pdf';
    for (const rol of ['beheerder', 'accountmanager', 'administratie', 'consultant']) expect(magDoen(rol, 'GET', pad)).toBe(true);
    for (const rol of ['accountmanager', 'administratie', 'consultant']) expect(magDoen(rol, 'POST', pad)).toBe(false);
  });

  it('vervangt tekens die het PDF-lettertype niet kent en laat Nederlandse tekens staan', () => {
    expect(pdfTekst('Café ‘Zaak’ – “plan” … € 5 ✓ 😀')).toBe('Café \'Zaak\' - "plan" ... € 5 ? ?');
    expect(pdfTekst(null)).toBe('');
  });

  it('maakt een veilige bestandsnaam', () => {
    const op = new Date('2026-11-05T10:00:00Z');
    expect(rapportBestandsnaam('Gemeente Dijk en Waard / test"', op)).toBe('klantrapport-Gemeente-Dijk-en-Waard-test-2026-11-05.pdf');
    expect(rapportBestandsnaam('Gemeente Súdwest-Fryslân', op)).toBe('klantrapport-Gemeente-Sudwest-Fryslan-2026-11-05.pdf');
    expect(rapportBestandsnaam('???', op)).toBe('klantrapport-klant-2026-11-05.pdf');
  });

  it('rendert een volledig rapport met alle onderdelen en lange tekst over meerdere pagina\'s', async () => {
    const lang = 'Dit is een lange samenvatting over de roadmap voor het komende jaar. '.repeat(60);
    const pdf = await maakKlantRapport({
      klant: { id: 'k', naam: 'Gemeente Venlo', status: 'klant', samenwerkingsverband: 'Limburg', inwoners: 102000, contractEinde: '2027-12-31', accountmanagerNaam: 'Ruben Kerstens', omschrijving: lang },
      contacten: [{ id: 'c', naam: 'Ruud Willems', functie: 'Afdelingshoofd Levenszaken', rol: 'beslisser', laatstGesproken: '2026-11-04' }],
      onderwerpen: [{ id: 'o', titel: 'Roadmap 2027', type: 'project', status: 'actief', eigenaarNaam: 'Irma Kadiric', laatsteUpdate: { datum: '2026-11-05', samenvatting: lang, besluiten: 'Presentatie aanpassen' }, bron: 'dagboek' }],
      samenverder: [{ id: 's', pakket: 'SamenVerder 2027', periodeVan: '2027-01-01', periodeTot: null, status: 'actief', aantalGepland: 2, aantalUitgevoerd: 1, volgendeSessie: '2027-02-01', laatsteSessie: null, budget: { beschikbaar: 10, uitgevoerd: 1, gepland: 2, nogNietGepland: 7, overschrijding: false }, laatsteSamenvatting: { tekst: 'Goede kickstart', datum: '2027-01-10' } } as never],
      implementaties: [{ topicId: 'i', titel: 'Open STGO', module: 'STGO', fase: 'test', testStatus: 'bezig', status: 'actief', geplandeLivegang: '2027-03-01', werkelijkeLivegang: null, bron: 'werkregister' }],
      gesprekken: Array.from({ length: 10 }, (_, i) => ({ soort: 'bezoek' as const, datum: '2026-11-0' + ((i % 9) + 1), samenvatting: lang, door: 'Irma', bron: 'verkoop-debrief' as const })),
      openPunten: [{ id: 'p', soort: 'actie', omschrijving: 'Offerte uitbrengen', eigenaar: 'Irma', deadline: '2026-12-01', teLaat: true, onderwerp: 'Roadmap 2027', datum: '2026-11-05', bron: 'verkoop-debrief' }],
      nietBevestigd: [{ soort: 'punt', omschrijving: 'x', reden: null, datum: '2026-11-05', bron: 'dagboek' }],
    } as never, { gemaaktOp: new Date('2026-11-05T10:00:00Z') });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5000);
  });

  it('houdt een gemeentekleur leesbaar: lichte kleuren worden verdonkerd, donkere blijven staan', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#a5d80e', '#ffffff')).toBeLessThan(3);
    expect(contrast(leesbaarOpWit('#a5d80e'), '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(leesbaarOpWit('#00807f')).toBe('#00807f');
    expect(tekstOp('#a5d80e')).toBe('#1a1a1a');
    expect(tekstOp('#005099')).toBe('#ffffff');
    expect(geldigeKleur('#00807f')).toBe(true);
    expect(geldigeKleur('red')).toBe(false);
    expect(geldigeKleur('#fff')).toBe(false);
  });

  it('rendert een zwaar rapport (veel lange punten) zonder fout, met meerdere pagina\'s, een gemeentekleur en een onleesbaar logo', async () => {
    const lang = 'Een erg lange omschrijving zonder einde. '.repeat(120);
    const punten = Array.from({ length: 40 }, (_, i) => ({ id: 'p' + i, soort: ['doel', 'actie', 'onbekend'][i % 3], omschrijving: i % 4 ? 'Lang' + 'woord'.repeat(40) : lang, eigenaar: 'Irma', deadline: '2026-11-01', teLaat: i % 2 === 0, onderwerp: null, datum: '2026-11-05', bron: 'dagboek' }));
    const pdf = await maakKlantRapport({
      klant: { id: 'k', naam: 'Gemeente Dijk en Waard', status: 'klant', samenwerkingsverband: null, inwoners: null, contractEinde: null, accountmanagerNaam: null, omschrijving: null },
      contacten: [], onderwerpen: [], samenverder: [], implementaties: [], gesprekken: [], openPunten: punten, nietBevestigd: [],
    } as never, { gemaaktOp: new Date('2026-11-05T10:00:00Z'), huisstijl: { kleur: '#a5d80e', logo: Buffer.from('geen plaatje') } });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const paginas = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(paginas).toBeGreaterThan(3);
  });
});
