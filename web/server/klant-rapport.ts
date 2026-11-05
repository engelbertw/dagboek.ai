import PDFDocument from 'pdfkit';
import { PINK_LOGO_PNG } from './pink-logo.js';
import type { Voorbereiding } from './voorbereiding.js';

/**
 * PDF-rapport van een klant: dezelfde samengestelde gegevens als de bezoekvoorbereiding (bij elk onderdeel datum en bron), ontworpen in de Pink-huisstijl.
 * Pink (blauw en magenta uit het logo) bepaalt de structuur; de kleur en het logo van de gemeente zijn het accent (titelstreep, tegels, sectiebalkjes).
 * Niet-bevestigde punten (nog te controleren) staan er bewust niet in; alleen het aantal wordt genoemd. Standaard PDF-lettertypen, dus geen bestanden of netwerk nodig.
 *
 * Opbouw: alles wordt op vaste coordinaten getekend na vooraf meten van de hoogte (`heightOfString`), zodat een rij nooit midden over een pagina breekt
 * en pdfkit zelf nooit een pagina toevoegt (de onderste marge staat daarvoor op 0; de eigen grens is `ONDER`).
 */

// ── Teksten ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const BRON: Record<string, string> = { dagboek: 'dagboek', 'verkoop-debrief': 'verkoop-debrief', 'consultant-debrief': 'consultantdebrief', werkregister: 'werkregister' };
const GESPREK: Record<string, string> = { bezoek: 'Klantbezoek', project: 'Projectdebrief', implementatie: 'Implementatiedebrief', samenverder: 'SamenVerder-debrief', consultant: 'Consultantdebrief' };
const KLANT_STATUS: Record<string, string> = { prospect: 'Prospect', klant: 'Klant', voorgesteld: 'Voorgesteld (nog te controleren)', inactief: 'Inactief' };
const SOORT: Record<string, string> = {
  doel: 'Doelen', resultaat: 'Resultaten', afspraak: 'Afspraken', actie: 'Acties', intern: 'Intern', kans: 'Kansen', risico: 'Risico\'s', besluit: 'Besluiten',
  blokkade: 'Blokkades', afhankelijkheid: 'Afhankelijkheden', vervolgsignaal: 'Vervolgsignalen',
};
const FASE: Record<string, string> = { voorbereiding: 'Voorbereiding', inrichting: 'Inrichting', test: 'Test', acceptatie: 'Acceptatie', ingebruikname: 'Ingebruikname', nazorg: 'Nazorg', afgerond: 'Afgerond' };
const TEST: Record<string, string> = { niet_gestart: 'niet gestart', bezig: 'bezig', afgerond: 'afgerond' };
const ONDERWERP_STATUS: Record<string, string> = { actief: 'Actief', wacht: 'Wacht', afgerond: 'Afgerond' };

/** De standaardlettertypen kennen alleen Latin-1 (en het eurotekens); alles daarbuiten wordt vervangen zodat er nooit onleesbare tekens in het rapport komen. */
export function pdfTekst(s: string | null | undefined): string {
  return (s ?? '').normalize('NFC')
    .replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"').replace(/…/g, '...').replace(/[–—−]/g, '-')
    .replace(/[•●]/g, '-').replace(/\r\n?/g, '\n')
    .replace(/[^\n\x20-\x7E -ÿ€]/gu, '?');
}

const kort = (s: string | null | undefined, max: number) => { const t = pdfTekst(s).trim(); return t.length > max ? `${t.slice(0, max - 3).trimEnd()}...` : t; };
const datum = (iso: string | null | undefined) => (iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Amsterdam' }) : '');
const bronTekst = (b: string) => BRON[b] ?? b;

// ── Kleur ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const PINK_BLAUW = '#005099';
export const PINK_MAGENTA = '#EC008C';

export const geldigeKleur = (k: unknown): k is string => typeof k === 'string' && /^#[0-9a-fA-F]{6}$/.test(k);
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const naarHex = (c: [number, number, number]) => `#${c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;
const lineair = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminantie = (hex: string) => { const [r, g, b] = rgb(hex); return 0.2126 * lineair(r) + 0.7152 * lineair(g) + 0.0722 * lineair(b); };
/** Contrastverhouding volgens WCAG (1 tot 21). */
export function contrast(a: string, b: string): number {
  const [hoog, laag] = [luminantie(a), luminantie(b)].sort((x, y) => y - x);
  return (hoog + 0.05) / (laag + 0.05);
}
/** Verdonkert een kleur tot hij op wit minstens `minimum` aan contrast heeft; een al donkere kleur blijft ongewijzigd. Zo blijft een lichtgroene gemeentekleur bruikbaar voor tekst en lijnen. */
export function leesbaarOpWit(hex: string, minimum = 3): string {
  let c = rgb(hex);
  for (let i = 0; i < 40 && contrast(naarHex(c), '#ffffff') < minimum; i++) c = [c[0] * 0.92, c[1] * 0.92, c[2] * 0.92];
  return naarHex(c);
}
/** Wit of bijna zwart, afhankelijk van wat het best leest op deze achtergrond. */
export const tekstOp = (achtergrond: string) => (contrast(achtergrond, '#ffffff') >= contrast(achtergrond, '#1a1a1a') ? '#ffffff' : '#1a1a1a');
const tint = (hex: string, aandeel: number) => naarHex(rgb(hex).map((x) => x + (255 - x) * (1 - aandeel)) as [number, number, number]);

export interface Huisstijl { kleur: string; logo?: Buffer | null }

interface Thema { blauw: string; accent: string; accentTint: string; tekst: string; zacht: string; lijn: string; vlak: string; fout: string; foutTint: string }
function maakThema(huisstijl?: Huisstijl | null): Thema {
  // Zonder gemeentekleur is het accent Pink-magenta. Een gemeentekleur wordt voor tekst en lijnen leesbaar gemaakt.
  const gemeente = huisstijl && geldigeKleur(huisstijl.kleur) ? huisstijl.kleur : null;
  const accent = gemeente ? leesbaarOpWit(gemeente, 3) : PINK_MAGENTA;
  return { blauw: PINK_BLAUW, accent, accentTint: tint(gemeente ?? PINK_MAGENTA, 0.12), tekst: '#1a1a1a', zacht: '#5f6270', lijn: '#dcdde6', vlak: '#f4f5f9', fout: '#b00020', foutTint: '#fdecef' };
}

/** Per soort punt een eigen tint, zodat je in een oogopslag ziet waar je naar kijkt. */
const SOORT_STIJL: Record<string, { bg: string; fg: string }> = {
  doel: { bg: '#e6eef8', fg: '#005099' }, resultaat: { bg: '#e7f5ec', fg: '#1b7f4b' }, afspraak: { bg: '#eee9f8', fg: '#5b3fa8' }, actie: { bg: '#fde8f4', fg: '#a8005f' },
  intern: { bg: '#eeeff3', fg: '#555a66' }, kans: { bg: '#e2f4f0', fg: '#0b7a66' }, risico: { bg: '#fdecef', fg: '#b00020' }, besluit: { bg: '#eee9f8', fg: '#5b3fa8' },
  blokkade: { bg: '#fdecef', fg: '#b00020' }, afhankelijkheid: { bg: '#fff3dd', fg: '#8f5600' }, vervolgsignaal: { bg: '#fff3dd', fg: '#8f5600' },
};

// ── Maatvoering (8-puntsraster) ───────────────────────────────────────────────────────────────────────────────────────────────────────

const MARGE = 48;
const BOVEN = 56;
const ONDER_AFSTAND = 64; // ruimte onderaan voor de voettekst
const TYPE = { titel: 24, sectie: 12.5, lichaam: 9.5, klein: 8, label: 7 };
const RUIMTE = { xs: 4, s: 8, m: 12, l: 16, xl: 24 };
const REGEL = 1.8;
const LOGO_VAK = { breedte: 128, hoogte: 38 };
const MAX_LANG = 2500;

export function maakKlantRapport(data: Voorbereiding, opties: { gemaaktOp: Date; huisstijl?: Huisstijl | null }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const th = maakThema(opties.huisstijl);
    const doc = new PDFDocument({
      size: 'A4', margins: { top: BOVEN, bottom: 0, left: MARGE, right: MARGE }, bufferPages: true, compress: true,
      info: { Title: pdfTekst(`Klantrapport ${data.klant.naam}`), Author: 'PinkRoccade Local Government', Subject: 'Klantrapport', CreationDate: opties.gemaaktOp },
    });
    const delen: Buffer[] = [];
    doc.on('data', (d: Buffer) => delen.push(d));
    doc.on('end', () => resolve(Buffer.concat(delen)));
    doc.on('error', reject);

    const B = doc.page.width - MARGE * 2;
    const ONDER = doc.page.height - ONDER_AFSTAND;
    let y = MARGE;

    // ── Basis ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    const nieuwePagina = () => { doc.addPage(); y = BOVEN; };
    const ruimte = (hoogte: number) => { if (y + hoogte > ONDER) nieuwePagina(); };
    const hoogteVan = (t: string, breedte: number, font: string, grootte: number) => (t ? doc.font(font).fontSize(grootte).heightOfString(t, { width: breedte, lineGap: REGEL }) : 0);
    type TekstOpt = { font?: string; grootte?: number; kleur?: string; align?: 'left' | 'right' | 'center'; lineGap?: number };
    const tekst = (t: string, x: number, yy: number, breedte: number, opt: TekstOpt = {}) => {
      const font = opt.font ?? 'Helvetica', grootte = opt.grootte ?? TYPE.lichaam;
      if (!t) return 0;
      const h = doc.font(font).fontSize(grootte).heightOfString(t, { width: breedte, lineGap: opt.lineGap ?? REGEL });
      doc.font(font).fontSize(grootte).fillColor(opt.kleur ?? th.tekst).text(t, x, yy, { width: breedte, align: opt.align ?? 'left', lineGap: opt.lineGap ?? REGEL });
      return h;
    };
    const rechthoek = (x: number, yy: number, w: number, h: number, vul: string, straal = 0) => { doc.save(); doc.roundedRect(x, yy, w, h, straal).fill(vul); doc.restore(); };
    const lijn = (x1: number, yy: number, x2: number, kleur = th.lijn, dikte = 0.6) => { doc.save(); doc.moveTo(x1, yy).lineTo(x2, yy).lineWidth(dikte).strokeColor(kleur).stroke(); doc.restore(); };

    const pilBreedte = (t: string, grootte = TYPE.klein) => doc.font('Helvetica-Bold').fontSize(grootte).widthOfString(t) + 12;
    const pil = (t: string, x: number, yy: number, kleur: { bg: string; fg: string }, grootte = TYPE.klein) => {
      const w = pilBreedte(t, grootte), h = grootte + 7;
      rechthoek(x, yy, w, h, kleur.bg, h / 2);
      doc.font('Helvetica-Bold').fontSize(grootte).fillColor(kleur.fg).text(t, x, yy + 3.5, { width: w, align: 'center', lineBreak: false });
      return w;
    };
    const PIL_H = TYPE.klein + 7;
    const neutraal = { bg: '#e9eaf0', fg: '#4a4f5c' };
    const accentPil = { bg: th.accentTint, fg: th.accent };

    // ── Titelblok ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    const logoH = 34;
    doc.image(PINK_LOGO_PNG, MARGE, y, { height: logoH });
    if (opties.huisstijl?.logo) {
      try { doc.image(opties.huisstijl.logo, MARGE + B - LOGO_VAK.breedte, y - 2, { fit: [LOGO_VAK.breedte, LOGO_VAK.hoogte], align: 'right', valign: 'center' }); } catch { /* onleesbaar logo: weglaten */ }
    }
    y += logoH + RUIMTE.m;
    rechthoek(MARGE, y, B, 3, th.accent);
    rechthoek(MARGE, y, 56, 3, PINK_MAGENTA); // het Pink-accent blijft altijd zichtbaar
    y += 3 + RUIMTE.l + 2;

    const { klant } = data;
    y += tekst(pdfTekst(klant.naam), MARGE, y, B, { font: 'Helvetica-Bold', grootte: TYPE.titel, kleur: th.blauw, lineGap: 0 }) + RUIMTE.xs;
    let px = MARGE;
    px += pil(pdfTekst(KLANT_STATUS[klant.status] ?? klant.status), px, y, accentPil) + RUIMTE.s;
    tekst(pdfTekst(`Klantrapport - samengesteld op ${datum(opties.gemaaktOp.toISOString())}`), px, y + 3, B - (px - MARGE), { grootte: TYPE.klein + 1, kleur: th.zacht, lineGap: 0 });
    y += PIL_H + RUIMTE.l;

    // ── Kerncijfertegels ───────────────────────────────────────────────────────────────────────────────────────────────────────────
    const teLaat = data.openPunten.filter((p) => p.teLaat).length;
    const laatste = data.gesprekken.map((g) => g.datum).filter((d): d is string => !!d).sort().pop() ?? null;
    const tegels: { waarde: string; label: string; kleur?: string }[] = [
      { waarde: String(data.openPunten.length), label: 'OPENSTAANDE PUNTEN' },
      { waarde: String(teLaat), label: 'TE LAAT', kleur: teLaat > 0 ? th.fout : undefined },
      { waarde: String(data.contacten.length), label: 'CONTACTPERSONEN' },
      { waarde: laatste ? datum(laatste) : '-', label: 'LAATSTE BEZOEK' },
    ];
    const gat = RUIMTE.s + 2, tw = (B - gat * (tegels.length - 1)) / tegels.length, tegelH = 56;
    tegels.forEach((t, i) => {
      const x = MARGE + i * (tw + gat);
      rechthoek(x, y, tw, tegelH, th.vlak, 5);
      rechthoek(x, y, tw, 2.5, t.kleur ?? th.accent);
      const groot = t.waarde.length > 8;
      tekst(pdfTekst(t.waarde), x + RUIMTE.m, y + (groot ? 17 : 14), tw - RUIMTE.m * 2, { font: 'Helvetica-Bold', grootte: groot ? 13 : 20, kleur: t.kleur ?? th.blauw, lineGap: 0 });
      tekst(t.label, x + RUIMTE.m, y + tegelH - 17, tw - RUIMTE.m * 2, { grootte: TYPE.label, kleur: th.zacht, lineGap: 0 });
    });
    y += tegelH + RUIMTE.l;

    // ── Kerngegevens ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
    const gegevens: [string, string][] = [
      ['ACCOUNTMANAGER', klant.accountmanagerNaam ?? '-'],
      ['SAMENWERKINGSVERBAND', klant.samenwerkingsverband || '-'],
      ['INWONERS', klant.inwoners !== null ? klant.inwoners.toLocaleString('nl-NL') : '-'],
      ['CONTRACT TOT', klant.contractEinde ? datum(klant.contractEinde) : '-'],
    ];
    const kolB = (B - RUIMTE.m * 2) / 2, regelH = 30;
    const kaartH = RUIMTE.m * 2 + Math.ceil(gegevens.length / 2) * regelH - 8;
    rechthoek(MARGE, y, B, kaartH, th.vlak, 5);
    gegevens.forEach(([l, v], i) => {
      const x = MARGE + RUIMTE.m + (i % 2) * kolB, yy = y + RUIMTE.m + Math.floor(i / 2) * regelH;
      tekst(l, x, yy, kolB - RUIMTE.m, { grootte: TYPE.label, kleur: th.zacht, lineGap: 0 });
      tekst(pdfTekst(v), x, yy + 10, kolB - RUIMTE.m, { font: 'Helvetica-Bold', grootte: TYPE.lichaam + 0.5, lineGap: 0 });
    });
    y += kaartH + RUIMTE.m;
    if (klant.omschrijving) {
      const o = kort(klant.omschrijving, MAX_LANG);
      ruimte(hoogteVan(o, B, 'Helvetica', TYPE.lichaam));
      y += tekst(o, MARGE, y, B, { kleur: th.zacht }) + RUIMTE.s;
    }

    // ── Sectie- en rijhulpen ───────────────────────────────────────────────────────────────────────────────────────────────────────
    /** Sectiekop met accentbalkje en aantal; `volgendeHoogte` houdt de kop bij minstens het eerste item. */
    const sectie = (titel: string, aantal: number | null, volgendeHoogte = 48) => {
      ruimte(RUIMTE.xl + 22 + volgendeHoogte);
      y += RUIMTE.xl;
      rechthoek(MARGE, y + 1, 4, 16, th.accent, 1);
      const h = tekst(pdfTekst(titel), MARGE + RUIMTE.m, y, B, { font: 'Helvetica-Bold', grootte: TYPE.sectie, kleur: th.blauw, lineGap: 0 });
      if (aantal !== null) {
        const tb = doc.font('Helvetica-Bold').fontSize(TYPE.sectie).widthOfString(pdfTekst(titel));
        pil(String(aantal), MARGE + RUIMTE.m + tb + RUIMTE.s, y + 0.5, neutraal);
      }
      y += Math.max(h, 16) + RUIMTE.s + 2;
      lijn(MARGE, y - 3, MARGE + B);
    };
    const legeRegel = (t: string) => { ruimte(24); y += tekst(t, MARGE, y + 2, B, { kleur: th.zacht, font: 'Helvetica-Oblique' }) + RUIMTE.m; };

    interface Kolom { breedte: number; hoogte: number; teken: (x: number, yy: number) => void }
    /** Een rij met kolommen naast elkaar: de hoogste kolom bepaalt de rijhoogte; de rij past altijd op een pagina en krijgt een dunne lijn eronder. */
    const rij = (kolommen: Kolom[], opt: { padding?: number; laatste?: boolean } = {}) => {
      const pad = opt.padding ?? RUIMTE.s;
      const h = Math.max(...kolommen.map((k) => k.hoogte)) + pad * 2;
      ruimte(h);
      let x = MARGE;
      for (const k of kolommen) { k.teken(x, y + pad); x += k.breedte; }
      y += h;
      if (!opt.laatste) lijn(MARGE, y, MARGE + B);
    };
    type Regel = { t: string; font?: string; grootte?: number; kleur?: string; gap?: number; pil?: { bg: string; fg: string } };
    const tekstKolom = (breedte: number, regels: Regel[], opt: { rechts?: boolean; marge?: number } = {}): Kolom => {
      const inner = breedte - (opt.marge ?? 0);
      const gefilterd = regels.filter((r) => r.t);
      const maten = gefilterd.map((r) => (r.pil ? PIL_H : hoogteVan(r.t, inner, r.font ?? 'Helvetica', r.grootte ?? TYPE.lichaam)) + (r.gap ?? 0));
      const hoogte = maten.reduce((a, b) => a + b, 0);
      return {
        breedte, hoogte,
        teken: (x, yy) => {
          let cy = yy;
          gefilterd.forEach((r, i) => {
            if (r.pil) pil(r.t, opt.rechts ? x + inner - pilBreedte(r.t) : x, cy, r.pil);
            else tekst(r.t, x, cy, inner, { font: r.font, grootte: r.grootte, kleur: r.kleur, align: opt.rechts ? 'right' : 'left' });
            cy += maten[i];
          });
        },
      };
    };
    const klein = (t: string, kleur = th.zacht): Regel => ({ t: pdfTekst(t), grootte: TYPE.klein, kleur, gap: 0 });

    // ── Contactpersonen ────────────────────────────────────────────────────────────────────────────────────────────────────────────
    sectie('Contactpersonen', data.contacten.length);
    if (!data.contacten.length) legeRegel('Nog geen contactpersonen vastgelegd.');
    data.contacten.forEach((c, i) => rij([
      tekstKolom(B * 0.36, [{ t: pdfTekst(c.naam), font: 'Helvetica-Bold' }], { marge: 8 }),
      tekstKolom(B * 0.30, [{ t: pdfTekst(c.functie) || '-', kleur: c.functie ? th.tekst : th.zacht }], { marge: 8 }),
      tekstKolom(B * 0.18, [{ t: pdfTekst(c.rol) || '-', kleur: c.rol ? th.tekst : th.zacht }], { marge: 8 }),
      tekstKolom(B * 0.16, [{ t: c.laatstGesproken ? datum(c.laatstGesproken) : '', grootte: TYPE.klein, kleur: th.zacht }], { rechts: true }),
    ], { padding: 6, laatste: i === data.contacten.length - 1 }));

    // ── Laatste bezoeken en debriefs: tijdlijn ─────────────────────────────────────────────────────────────────────────────────────
    sectie('Laatste bezoeken en debriefs', data.gesprekken.length, 110);
    if (!data.gesprekken.length) legeRegel('Nog geen bezoeken of debriefs.');
    data.gesprekken.forEach((g, i) => {
      const links = 118;
      const wie = pdfTekst([g.door, bronTekst(g.bron)].filter(Boolean).join(' - '));
      rij([
        {
          breedte: links, hoogte: 15 + PIL_H + 4 + hoogteVan(wie, links - 10, 'Helvetica', TYPE.klein),
          teken: (x, yy) => {
            tekst(datum(g.datum) || '-', x, yy, links - 10, { font: 'Helvetica-Bold', lineGap: 0 });
            pil(GESPREK[g.soort] ?? g.soort, x, yy + 15, accentPil);
            tekst(wie, x, yy + 15 + PIL_H + 4, links - 10, { grootte: TYPE.klein, kleur: th.zacht });
          },
        },
        tekstKolom(B - links, [g.samenvatting ? { t: kort(g.samenvatting, MAX_LANG) } : { t: 'Geen samenvatting.', font: 'Helvetica-Oblique', kleur: th.zacht }]),
      ], { padding: 10, laatste: i === data.gesprekken.length - 1 });
    });

    // ── Dagboek per onderwerp ──────────────────────────────────────────────────────────────────────────────────────────────────────
    if (data.onderwerpen.length) {
      sectie('Dagboek per onderwerp', data.onderwerpen.length, 110);
      data.onderwerpen.forEach((o, i) => {
        const links = 150;
        rij([
          tekstKolom(links, [{ t: pdfTekst(o.titel), font: 'Helvetica-Bold', gap: 4 }, { t: ONDERWERP_STATUS[o.status] ?? o.status, pil: neutraal, gap: 4 }, klein(o.eigenaarNaam ?? '')], { marge: 12 }),
          tekstKolom(B - links, o.laatsteUpdate ? [
            { t: kort(o.laatsteUpdate.samenvatting, MAX_LANG), gap: 4 },
            ...(o.laatsteUpdate.besluiten ? [{ t: `Besluiten: ${kort(o.laatsteUpdate.besluiten, 800)}`, font: 'Helvetica-Oblique', gap: 3 }] : []),
            klein(`${datum(o.laatsteUpdate.datum)}, ${bronTekst(o.bron)}`),
          ] : [{ t: 'Nog geen update.', font: 'Helvetica-Oblique', kleur: th.zacht }]),
        ], { padding: 8, laatste: i === data.onderwerpen.length - 1 });
      });
    }

    // ── Implementaties ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
    if (data.implementaties.length) {
      sectie('Implementaties', data.implementaties.length);
      data.implementaties.forEach((im, i) => {
        const livegang = im.werkelijkeLivegang ? `Live sinds ${datum(im.werkelijkeLivegang)}` : im.geplandeLivegang ? `Livegang gepland ${datum(im.geplandeLivegang)}` : '';
        rij([
          tekstKolom(B * 0.5, [{ t: pdfTekst(im.titel), font: 'Helvetica-Bold', gap: 2 }, klein(`${im.module} - ${bronTekst(im.bron)}`)], { marge: 12 }),
          tekstKolom(B * 0.5, [{ t: `Fase ${(FASE[im.fase] ?? im.fase).toLowerCase()}`, gap: 2 }, klein(`Test: ${TEST[im.testStatus] ?? im.testStatus}${livegang ? ` - ${livegang}` : ''}`)]),
        ], { padding: 7, laatste: i === data.implementaties.length - 1 });
      });
    }

    // ── SamenVerder met voortgangsbalk voor het dagenbudget ────────────────────────────────────────────────────────────────────────
    if (data.samenverder.length) {
      sectie('SamenVerder', data.samenverder.length, 96);
      data.samenverder.forEach((p, i) => {
        const b = p.budget;
        const sam = p.laatsteSamenvatting ? kort(p.laatsteSamenvatting.tekst, 900) : '';
        const samH = sam ? 4 + hoogteVan(sam, B, 'Helvetica', TYPE.lichaam) + 3 + 11 : 0;
        ruimte(RUIMTE.s * 2 + 16 + 8 + 7 + 12 + 12 + samH);
        const y0 = y + RUIMTE.s;
        const naam = pdfTekst(p.pakket || 'Programma');
        const kopH = tekst(naam, MARGE, y0, B * 0.6, { font: 'Helvetica-Bold', lineGap: 0 });
        let xp = MARGE + doc.font('Helvetica-Bold').fontSize(TYPE.lichaam).widthOfString(naam) + RUIMTE.s;
        xp += pil(p.status === 'actief' ? 'Actief' : 'Afgerond', xp, y0 - 2, p.status === 'actief' ? accentPil : neutraal) + RUIMTE.xs;
        if (b.overschrijding) pil('Budget overschreden', xp, y0 - 2, { bg: th.foutTint, fg: th.fout });
        tekst(pdfTekst(`${datum(p.periodeVan)}${p.periodeTot ? ` - ${datum(p.periodeTot)}` : ' -'}${p.volgendeSessie ? `  |  volgende sessie ${datum(p.volgendeSessie)}` : ''}`), MARGE + B * 0.6, y0 + 1, B * 0.4, { grootte: TYPE.klein, kleur: th.zacht, align: 'right', lineGap: 0 });
        const schaal = Math.max(b.beschikbaar, b.uitgevoerd + b.gepland, 1), by = y0 + Math.max(kopH, 12) + 8;
        rechthoek(MARGE, by, B, 7, '#e4e6ee', 3.5);
        const wU = (b.uitgevoerd / schaal) * B, wG = (b.gepland / schaal) * B;
        if (wU > 0) rechthoek(MARGE, by, Math.max(wU, 3), 7, th.blauw, 3.5);
        if (wG > 0) rechthoek(MARGE + wU, by, Math.max(wG, 3), 7, b.overschrijding ? th.fout : th.accent, 3.5);
        tekst(pdfTekst(`${b.uitgevoerd} dagen uitgevoerd - ${b.gepland} gepland - ${b.nogNietGepland} nog niet gepland - ${b.beschikbaar} beschikbaar`), MARGE, by + 12, B, { grootte: TYPE.klein, kleur: th.zacht, lineGap: 0 });
        let ty = by + 12 + 12;
        if (p.laatsteSamenvatting) {
          ty += 4;
          ty += tekst(sam, MARGE, ty, B) + 3;
          ty += tekst(`${datum(p.laatsteSamenvatting.datum)}, laatste debrief`, MARGE, ty, B, { grootte: TYPE.klein, kleur: th.zacht, lineGap: 0 });
        }
        y = ty + RUIMTE.s;
        if (i < data.samenverder.length - 1) lijn(MARGE, y, MARGE + B);
      });
    }

    // ── Openstaande punten per soort ───────────────────────────────────────────────────────────────────────────────────────────────
    sectie('Openstaande punten', data.openPunten.length, 80);
    if (!data.openPunten.length) legeRegel('Geen openstaande punten.');
    const perSoort = new Map<string, Voorbereiding['openPunten']>();
    for (const p of data.openPunten) perSoort.set(p.soort, [...(perSoort.get(p.soort) ?? []), p]);
    for (const [soort, punten] of perSoort) {
      const stijl = SOORT_STIJL[soort] ?? neutraal;
      ruimte(PIL_H + RUIMTE.m + 44);
      y += RUIMTE.s;
      const w = pil(SOORT[soort] ?? soort, MARGE, y, stijl, TYPE.klein + 0.5);
      tekst(String(punten.length), MARGE + w + RUIMTE.s, y + 3.5, 40, { grootte: TYPE.klein + 0.5, kleur: th.zacht, lineGap: 0 });
      y += PIL_H + RUIMTE.xs;
      const rechtsB = 150;
      punten.forEach((p, i) => {
        const meta = [datum(p.datum), bronTekst(p.bron), p.onderwerp].filter(Boolean).join(' - ');
        rij([
          tekstKolom(B - rechtsB, [{ t: kort(p.omschrijving, 700), gap: 2 }, klein(meta)], { marge: 14 }),
          tekstKolom(rechtsB, [
            ...(p.eigenaar ? [{ t: pdfTekst(p.eigenaar), gap: 2 }] : []),
            ...(p.deadline ? [{ t: `uiterlijk ${datum(p.deadline)}`, grootte: TYPE.klein, kleur: p.teLaat ? th.fout : th.zacht, gap: p.teLaat ? 4 : 0 }] : []),
            ...(p.teLaat ? [{ t: 'TE LAAT', pil: { bg: th.foutTint, fg: th.fout } }] : []),
          ], { rechts: true }),
        ], { padding: 6, laatste: i === punten.length - 1 });
      });
    }

    // ── Wat niet is opgenomen ──────────────────────────────────────────────────────────────────────────────────────────────────────
    if (data.nietBevestigd.length) {
      const t = `Niet opgenomen: ${data.nietBevestigd.length} ${data.nietBevestigd.length === 1 ? 'punt of debrief wacht' : 'punten of debriefs wachten'} nog op controle in dagboek.ai. Zodra die is gedaan, verschijnen ze in een volgend rapport.`;
      const h = hoogteVan(t, B - RUIMTE.m * 2 - 4, 'Helvetica', TYPE.klein + 1) + RUIMTE.m * 2;
      ruimte(h + RUIMTE.xl);
      y += RUIMTE.xl;
      rechthoek(MARGE, y, B, h, '#fff7e3', 4);
      rechthoek(MARGE, y, 3, h, '#f0a92b');
      tekst(t, MARGE + RUIMTE.m + 4, y + RUIMTE.m, B - RUIMTE.m * 2 - 4, { grootte: TYPE.klein + 1, kleur: '#6b4a06' });
    }

    // ── Kopregel (vanaf pagina 2) en voettekst (alle paginas) ──────────────────────────────────────────────────────────────────────
    const paginas = doc.bufferedPageRange();
    const gemaakt = datum(opties.gemaaktOp.toISOString());
    for (let i = paginas.start; i < paginas.start + paginas.count; i++) {
      doc.switchToPage(i);
      if (i > paginas.start) {
        tekst(pdfTekst(klant.naam), MARGE, 26, B / 2, { font: 'Helvetica-Bold', grootte: TYPE.klein + 0.5, kleur: th.blauw, lineGap: 0 });
        tekst('Klantrapport', MARGE + B / 2, 26, B / 2, { grootte: TYPE.klein + 0.5, kleur: th.zacht, align: 'right', lineGap: 0 });
        lijn(MARGE, 40, MARGE + B);
      }
      const fy = doc.page.height - 44;
      lijn(MARGE, fy, MARGE + B);
      rechthoek(MARGE, fy - 1, 24, 2, PINK_MAGENTA);
      tekst(`Opgesteld door PinkRoccade Local Government - ${gemaakt}`, MARGE, fy + 8, B * 0.7, { grootte: TYPE.klein - 0.5, kleur: th.zacht, lineGap: 0 });
      tekst(`Pagina ${i + 1} van ${paginas.count}`, MARGE + B * 0.7, fy + 8, B * 0.3, { grootte: TYPE.klein - 0.5, kleur: th.zacht, align: 'right', lineGap: 0 });
    }
    doc.end();
  });
}

/** Een veilige bestandsnaam voor de download, zonder tekens die in een header of bestandssysteem problemen geven. */
export function rapportBestandsnaam(klantNaam: string, op: Date): string {
  const schoon = pdfTekst(klantNaam).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'klant';
  return `klantrapport-${schoon}-${op.toISOString().slice(0, 10)}.pdf`;
}
