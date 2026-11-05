import PDFDocument from 'pdfkit';
import type { Voorbereiding } from './voorbereiding.js';

/**
 * PDF-rapport van een klant: dezelfde samengestelde gegevens als de bezoekvoorbereiding (bij elk onderdeel datum en bron), in een vorm om te bewaren of te delen.
 * Niet-bevestigde punten (nog te controleren) staan er bewust niet in; alleen het aantal wordt genoemd. Standaard PDF-lettertypen, dus geen bestanden of netwerk nodig.
 */

const BRON: Record<string, string> = { dagboek: 'dagboek', 'verkoop-debrief': 'verkoop-debrief', 'consultant-debrief': 'consultantdebrief', werkregister: 'werkregister' };
const GESPREK: Record<string, string> = { bezoek: 'Klantbezoek', project: 'Projectdebrief', implementatie: 'Implementatiedebrief', samenverder: 'SamenVerder-debrief', consultant: 'Consultantdebrief' };
const KLANT_STATUS: Record<string, string> = { prospect: 'Prospect', klant: 'Klant', voorgesteld: 'Voorgesteld (nog te controleren)', inactief: 'Inactief' };
const SOORT: Record<string, string> = {
  doel: 'Doelen', resultaat: 'Resultaten', afspraak: 'Afspraken', actie: 'Acties', intern: 'Intern', kans: 'Kansen', risico: 'Risico\'s', besluit: 'Besluiten',
  blokkade: 'Blokkades', afhankelijkheid: 'Afhankelijkheden', vervolgsignaal: 'Vervolgsignalen',
};
const FASE: Record<string, string> = { voorbereiding: 'Voorbereiding', inrichting: 'Inrichting', test: 'Test', acceptatie: 'Acceptatie', ingebruikname: 'Ingebruikname', nazorg: 'Nazorg', afgerond: 'Afgerond' };
const TEST: Record<string, string> = { niet_gestart: 'niet gestart', bezig: 'bezig', afgerond: 'afgerond' };

/** De standaardlettertypen kennen alleen Latin-1 (en het eurotekens); alles daarbuiten wordt vervangen zodat er nooit onleesbare tekens in het rapport komen. */
export function pdfTekst(s: string | null | undefined): string {
  return (s ?? '').normalize('NFC')
    .replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"').replace(/…/g, '...').replace(/[–—−]/g, '-')
    .replace(/[•●]/g, '-').replace(/\r\n?/g, '\n')
    .replace(/[^\n\x20-\x7E\u00A0-\u00FF\u20AC]/gu, '?');
}

const datum = (iso: string | null | undefined) => (iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Amsterdam' }) : '');
const bronTekst = (b: string) => BRON[b] ?? b;

const KLEUR = { tekst: '#1a1a1a', zacht: '#666666', lijn: '#cccccc', accent: '#3b2a8c', fout: '#b00020' };
const MARGE = 56;

export function maakKlantRapport(data: Voorbereiding, opties: { gemaaktOp: Date }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margins: { top: MARGE, bottom: MARGE + 12, left: MARGE, right: MARGE }, bufferPages: true, compress: true,
      info: { Title: pdfTekst(`Klantrapport ${data.klant.naam}`), Author: 'dagboek.ai', Subject: 'Klantrapport', CreationDate: opties.gemaaktOp },
    });
    const delen: Buffer[] = [];
    doc.on('data', (d: Buffer) => delen.push(d));
    doc.on('end', () => resolve(Buffer.concat(delen)));
    doc.on('error', reject);

    const breedte = () => doc.page.width - MARGE * 2;
    const ruimteNodig = (hoogte: number) => { if (doc.y + hoogte > doc.page.height - doc.page.margins.bottom) doc.addPage(); };
    const kop = (tekst: string) => {
      ruimteNodig(60);
      doc.moveDown(0.9).font('Helvetica-Bold').fontSize(13).fillColor(KLEUR.accent).text(pdfTekst(tekst));
      doc.moveTo(MARGE, doc.y + 2).lineTo(MARGE + breedte(), doc.y + 2).strokeColor(KLEUR.lijn).lineWidth(0.7).stroke();
      doc.moveDown(0.5).fillColor(KLEUR.tekst);
    };
    const subkop = (tekst: string) => { ruimteNodig(40); doc.moveDown(0.3).font('Helvetica-Bold').fontSize(10.5).fillColor(KLEUR.tekst).text(pdfTekst(tekst)); doc.moveDown(0.15); };
    const alinea = (tekst: string, opties: { zacht?: boolean; cursief?: boolean } = {}) => {
      doc.font(opties.cursief ? 'Helvetica-Oblique' : 'Helvetica').fontSize(10).fillColor(opties.zacht ? KLEUR.zacht : KLEUR.tekst).text(pdfTekst(tekst), { lineGap: 1.5 });
    };
    /** Een regel met een vette titel en daarachter gewone tekst; `meta` komt in grijs eronder (datum en bron). */
    const punt = (titel: string, tekst: string, meta: string) => {
      ruimteNodig(46);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(KLEUR.tekst).text(pdfTekst(titel), { continued: !!tekst, lineGap: 1.5 });
      if (tekst) doc.font('Helvetica').text(pdfTekst(` - ${tekst}`), { lineGap: 1.5 });
      if (meta) doc.font('Helvetica').fontSize(8.5).fillColor(KLEUR.zacht).text(pdfTekst(meta), { lineGap: 1 });
      doc.moveDown(0.35).fillColor(KLEUR.tekst);
    };
    const leeg = (tekst: string) => alinea(tekst, { zacht: true, cursief: true });

    // Titelblok
    const { klant } = data;
    doc.font('Helvetica-Bold').fontSize(20).fillColor(KLEUR.tekst).text(pdfTekst(klant.naam));
    doc.font('Helvetica').fontSize(11).fillColor(KLEUR.zacht).text(pdfTekst(`Klantrapport - ${KLANT_STATUS[klant.status] ?? klant.status}`));
    doc.fontSize(9).text(pdfTekst(`Samengesteld op ${datum(opties.gemaaktOp.toISOString())} uit wat in dagboek.ai is vastgelegd; bij elk onderdeel staan datum en bron.`));
    doc.fillColor(KLEUR.tekst);

    // Kerngegevens
    kop('Kerngegevens');
    const regels: [string, string][] = [
      ['Accountmanager', klant.accountmanagerNaam ?? '-'],
      ...(klant.samenwerkingsverband ? [['Samenwerkingsverband', klant.samenwerkingsverband] as [string, string]] : []),
      ...(klant.inwoners !== null ? [['Inwoners', klant.inwoners.toLocaleString('nl-NL')] as [string, string]] : []),
      ...(klant.contractEinde ? [['Contract tot', datum(klant.contractEinde)] as [string, string]] : []),
    ];
    for (const [k, v] of regels) {
      doc.font('Helvetica-Bold').fontSize(10).text(pdfTekst(`${k}: `), { continued: true }).font('Helvetica').text(pdfTekst(v));
    }
    if (klant.omschrijving) { doc.moveDown(0.3); alinea(klant.omschrijving); }

    // Contactpersonen
    kop(`Contactpersonen (${data.contacten.length})`);
    if (!data.contacten.length) leeg('Nog geen contactpersonen vastgelegd.');
    for (const c of data.contacten) {
      punt(c.naam, [c.functie, c.rol].filter(Boolean).join(', '), c.laatstGesproken ? `Laatst gesproken ${datum(c.laatstGesproken)}` : '');
    }

    // Laatste bezoeken en debriefs
    kop(`Laatste bezoeken en debriefs (${data.gesprekken.length})`);
    if (!data.gesprekken.length) leeg('Nog geen bezoeken of debriefs.');
    for (const g of data.gesprekken) {
      punt(`${GESPREK[g.soort] ?? g.soort} - ${datum(g.datum)}`, '', [g.door, bronTekst(g.bron)].filter(Boolean).join(' - '));
      if (g.samenvatting) { alinea(g.samenvatting); doc.moveDown(0.4); } else { leeg('Geen samenvatting.'); }
    }

    // Dagboek per onderwerp
    if (data.onderwerpen.length) {
      kop(`Dagboek per onderwerp (${data.onderwerpen.length})`);
      for (const o of data.onderwerpen) {
        punt(o.titel, '', [o.status, o.eigenaarNaam].filter(Boolean).join(' - '));
        if (o.laatsteUpdate) {
          alinea(o.laatsteUpdate.samenvatting);
          if (o.laatsteUpdate.besluiten) alinea(`Besluiten: ${o.laatsteUpdate.besluiten}`, { cursief: true });
          doc.font('Helvetica').fontSize(8.5).fillColor(KLEUR.zacht).text(pdfTekst(`${datum(o.laatsteUpdate.datum)}, ${bronTekst(o.bron)}`)).fillColor(KLEUR.tekst);
        } else leeg('Nog geen update.');
        doc.moveDown(0.4);
      }
    }

    // Implementaties
    if (data.implementaties.length) {
      kop(`Implementaties (${data.implementaties.length})`);
      for (const i of data.implementaties) {
        const delen2 = [`fase ${(FASE[i.fase] ?? i.fase).toLowerCase()}`, `test: ${TEST[i.testStatus] ?? i.testStatus}`, i.geplandeLivegang ? `livegang gepland ${datum(i.geplandeLivegang)}` : '', i.werkelijkeLivegang ? `live sinds ${datum(i.werkelijkeLivegang)}` : ''].filter(Boolean);
        punt(`${i.titel} (${i.module})`, delen2.join(', '), bronTekst(i.bron));
      }
    }

    // SamenVerder
    if (data.samenverder.length) {
      kop(`SamenVerder (${data.samenverder.length})`);
      for (const p of data.samenverder) {
        punt(p.pakket || 'Programma', `${p.status === 'actief' ? 'actief' : 'afgerond'}, ${datum(p.periodeVan)}${p.periodeTot ? ` - ${datum(p.periodeTot)}` : ''}, ${p.aantalUitgevoerd} uitgevoerd, ${p.aantalGepland} gepland${p.volgendeSessie ? `, volgende sessie ${datum(p.volgendeSessie)}` : ''}`, '');
        const b = p.budget;
        alinea(`Dagen: ${b.beschikbaar} beschikbaar, ${b.uitgevoerd} uitgevoerd, ${b.gepland} gepland, ${b.nogNietGepland} nog niet gepland${b.overschrijding ? ' - budget overschreden' : ''}.`, { zacht: true });
        if (p.laatsteSamenvatting) alinea(`${p.laatsteSamenvatting.tekst} (${datum(p.laatsteSamenvatting.datum)}, laatste debrief)`);
        doc.moveDown(0.4);
      }
    }

    // Openstaande punten per soort
    kop(`Openstaande punten (${data.openPunten.length})`);
    if (!data.openPunten.length) leeg('Geen openstaande punten.');
    const perSoort = new Map<string, Voorbereiding['openPunten']>();
    for (const p of data.openPunten) perSoort.set(p.soort, [...(perSoort.get(p.soort) ?? []), p]);
    for (const [soort, punten] of perSoort) {
      subkop(`${SOORT[soort] ?? soort} (${punten.length})`);
      for (const p of punten) {
        const meta = [p.eigenaar, p.deadline ? `uiterlijk ${datum(p.deadline)}` : '', p.onderwerp, `${datum(p.datum)}, ${bronTekst(p.bron)}`, p.teLaat ? 'TE LAAT' : ''].filter(Boolean).join(' - ');
        punt(p.omschrijving, '', meta);
      }
    }

    if (data.nietBevestigd.length) {
      doc.moveDown(0.6);
      alinea(`Niet opgenomen: ${data.nietBevestigd.length} ${data.nietBevestigd.length === 1 ? 'punt of debrief wacht' : 'punten of debriefs wachten'} nog op controle in dagboek.ai.`, { zacht: true, cursief: true });
    }

    // Paginanummers op elke pagina (de onderkant van de marge mag hiervoor even worden gebruikt).
    const paginas = doc.bufferedPageRange();
    for (let i = paginas.start; i < paginas.start + paginas.count; i++) {
      doc.switchToPage(i);
      const onder = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(8).fillColor(KLEUR.zacht)
        .text(pdfTekst(`${klant.naam} - klantrapport ${datum(opties.gemaaktOp.toISOString())}`), MARGE, doc.page.height - 36, { width: breedte() / 2, align: 'left', lineBreak: false })
        .text(`Pagina ${i + 1} van ${paginas.count}`, MARGE + breedte() / 2, doc.page.height - 36, { width: breedte() / 2, align: 'right', lineBreak: false });
      doc.page.margins.bottom = onder;
    }
    doc.end();
  });
}

/** Een veilige bestandsnaam voor de download, zonder tekens die in een header of bestandssysteem problemen geven. */
export function rapportBestandsnaam(klantNaam: string, op: Date): string {
  const schoon = pdfTekst(klantNaam).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'klant';
  return `klantrapport-${schoon}-${op.toISOString().slice(0, 10)}.pdf`;
}
