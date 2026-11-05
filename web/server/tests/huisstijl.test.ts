import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { connectMemory, migrate } from '../db.js';
import { afbeeldingType, controleerUrl, isPubliekIp, kleurKandidaten, logoKandidaten, logoVoorRapport, OphaalFout, registreerHuisstijl, type Ophaler, veiligOphalen } from '../huisstijl.js';
import { maakKlantRapport } from '../klant-rapport.js';
import { magDoen } from '../rollen.js';
import { klanten } from '../schema.js';

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><rect width="200" height="60" fill="#a5d80e"/></svg>';

// Vereenvoudigde fixtures van de echte sites: Venlo heeft een zwarte theme-color en de echte kleur alleen in de CSS; Dijk en Waard heeft wel een bruikbare theme-color en een SVG-logo.
const VENLO = `<html><head><meta name="theme-color" content="#000000"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="apple-touch-icon" sizes="180x180" href="/apple-180.png"><link rel="stylesheet" href="/site.css"></head><body><style>a{color:#00807f}.x{background:#00807f}.y{color:#00807f;border:1px solid #fff}.z{color:#333}</style></body></html>`;
const DEW = `<html><head><meta name="theme-color" content="#a5d80e"><script type="application/ld+json">{"@type":"Organization","logo":{"url":"https://www.dijkenwaard.nl/logo.svg"}}</script></head><body><img class="site-logo" src="/logo.svg" alt="Dijk en Waard"></body></html>`;

describe('isPubliekIp', () => {
  it('weigert intern, lokaal en gereserveerd; staat openbare adressen toe', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', 'ff02::1', 'geen-ip', '999.1.1.1']) expect(isPubliekIp(ip), ip).toBe(false);
    for (const ip of ['8.8.8.8', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111']) expect(isPubliekIp(ip), ip).toBe(true);
  });
});

describe('controleerUrl', () => {
  it('staat alleen openbare https-adressen toe', () => {
    expect(controleerUrl('https://www.venlo.nl/').hostname).toBe('www.venlo.nl');
    for (const u of ['http://venlo.nl', 'ftp://venlo.nl', 'https://127.0.0.1/', 'https://[::1]/', 'https://169.254.169.254/latest', 'https://user:pw@venlo.nl', 'https://venlo.nl:8443/', 'https://localhost/', 'https://intern/', 'https://nas.local/', 'geen url']) {
      expect(() => controleerUrl(u), u).toThrow(OphaalFout);
    }
  });
  it('veiligOphalen weigert interne adressen zonder netwerk te gebruiken', async () => {
    await expect(veiligOphalen('https://10.0.0.5/x', { maxBytes: 1000 })).rejects.toThrow(OphaalFout);
    await expect(veiligOphalen('http://venlo.nl/', { maxBytes: 1000 })).rejects.toThrow(OphaalFout);
  });
});

describe('kleur en logo uit een website', () => {
  it('Venlo: negeert de zwarte theme-color en vindt het teal uit de CSS', () => {
    const k = kleurKandidaten(VENLO, ['.btn{background:#00807F}']);
    expect(k[0]).toBe('#00807f');
    expect(k).not.toContain('#000000');
    expect(k).not.toContain('#ffffff');
    expect(k).not.toContain('#333333');
  });
  it('Dijk en Waard: gebruikt de theme-color', () => {
    expect(kleurKandidaten(DEW)[0]).toBe('#a5d80e');
  });
  it('vindt logokandidaten uit JSON-LD, img met logo en iconen, alleen https en zonder dubbelen', () => {
    expect(logoKandidaten(DEW, 'https://www.dijkenwaard.nl/')).toEqual(['https://www.dijkenwaard.nl/logo.svg']);
    expect(logoKandidaten(VENLO, 'https://www.venlo.nl/')).toEqual(['https://www.venlo.nl/apple-180.png', 'https://www.venlo.nl/favicon-32.png']);
    expect(logoKandidaten('<img src="http://x.nl/logo.png"><img src="/foto.jpg" alt="foto">', 'https://x.nl/')).toEqual([]);
  });
  it('herkent het type aan de bytes en rendert SVG naar PNG', async () => {
    expect(afbeeldingType(PNG)).toBe('png');
    expect(afbeeldingType(Buffer.from(SVG))).toBe('svg');
    expect(afbeeldingType(Buffer.from('<svg xmlns="x"><script>alert(1)</script></svg>'))).toBeNull();
    expect(afbeeldingType(Buffer.from('GIF89a....'))).toBeNull();
    expect(afbeeldingType(Buffer.from('<html>geen plaatje</html>'))).toBeNull();
    const r = await logoVoorRapport(Buffer.from(SVG));
    expect(r?.type).toBe('png');
    expect(r?.data.subarray(0, 4).toString('latin1')).toContain('PNG');
    expect(await logoVoorRapport(Buffer.alloc(600_000, 1))).toBeNull();
  });
  it('het rapport gebruikt een gerenderd logo en kleur zonder fout', async () => {
    const r = await logoVoorRapport(Buffer.from(SVG));
    const pdf = await maakKlantRapport({
      klant: { id: 'k', naam: 'Gemeente Dijk en Waard', status: 'klant', samenwerkingsverband: '', inwoners: null, contractEinde: null, accountmanagerNaam: null, omschrijving: '' },
      contacten: [], onderwerpen: [], samenverder: [], implementaties: [], gesprekken: [], openPunten: [], nietBevestigd: [],
    } as never, { gemaaktOp: new Date(), huisstijl: { kleur: '#a5d80e', logo: r!.data } });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

describe('huisstijl-routes', () => {
  const open: { close: () => Promise<void> }[] = [];
  afterEach(async () => { while (open.length) await open.pop()!.close(); });

  async function opzet(ophaler: Ophaler) {
    const h = await connectMemory(); await migrate(h);
    const app = Fastify(); registreerHuisstijl(app, h.db, ophaler); await app.ready();
    open.push({ close: async () => { await app.close(); await h.close(); } });
    const [k] = await h.db.insert(klanten).values({ naam: 'Gemeente Venlo', status: 'klant', bron: 'handmatig' }).returning();
    return { app, db: h.db, id: k.id };
  }
  const bestanden: Record<string, { type: string; body: Buffer | string }> = {
    'https://www.venlo.nl/': { type: 'text/html', body: VENLO },
    'https://www.venlo.nl/site.css': { type: 'text/css', body: '.a{color:#00807f}' },
    'https://www.venlo.nl/apple-180.png': { type: 'image/png', body: PNG },
    'https://www.venlo.nl/favicon-32.png': { type: 'image/webp', body: Buffer.from('RIFFxxxxWEBP') },
  };
  const ophaler: Ophaler = async (url) => {
    const f = bestanden[url];
    if (!f) throw new OphaalFout('niet gevonden');
    return { status: 200, type: f.type, body: Buffer.from(f.body), url };
  };

  it('geeft een voorstel met kleur en logo en bewaart niets', async () => {
    const { app, db, id } = await opzet(ophaler);
    const r = await app.inject({ method: 'POST', url: `/api/klanten/${id}/huisstijl/voorstel`, payload: { website: 'www.venlo.nl/' } });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.kleuren[0]).toBe('#00807f');
    expect(b.logos).toHaveLength(1);
    expect(b.logos[0].logo).toMatch(/^data:image\/png;base64,/);
    expect(b.overgeslagen).toBe(1); // het WebP-icoon
    const [k] = await db.select().from(klanten);
    expect(k.huisstijlKleur).toBeNull();
    expect(k.website).toBeNull();
  });

  it('weigert een interne of ongeldige website met een duidelijke fout, en een onbekende klant met 404', async () => {
    const { app, id } = await opzet(veiligOphalen);
    for (const website of ['https://127.0.0.1/', 'http://venlo.nl', 'https://169.254.169.254/']) {
      const r = await app.inject({ method: 'POST', url: `/api/klanten/${id}/huisstijl/voorstel`, payload: { website } });
      expect(r.statusCode, website).toBe(422);
    }
    expect((await app.inject({ method: 'POST', url: `/api/klanten/${id}/huisstijl/voorstel`, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/klanten/00000000-0000-4000-8000-000000000000/huisstijl/voorstel', payload: { website: 'venlo.nl' } })).statusCode).toBe(404);
  });

  it('bevestigt kleur en logo, leest ze terug en wist ze weer', async () => {
    const { app, db, id } = await opzet(ophaler);
    const put = await app.inject({ method: 'PUT', url: `/api/klanten/${id}/huisstijl`, payload: { website: 'https://www.venlo.nl', kleur: '#00807F', logo: { url: 'https://www.venlo.nl/apple-180.png' } } });
    expect(put.statusCode).toBe(200);
    const get = (await app.inject({ method: 'GET', url: `/api/klanten/${id}/huisstijl` })).json();
    expect(get.kleur).toBe('#00807f');
    expect(get.website).toBe('https://www.venlo.nl');
    expect(get.logo).toMatch(/^data:image\/png;base64,/);
    expect(get.bevestigdOp).toBeTruthy();
    // Alleen kleur wijzigen laat het logo staan; logo null verwijdert het.
    await app.inject({ method: 'PUT', url: `/api/klanten/${id}/huisstijl`, payload: { kleur: '#112233' } });
    expect((await app.inject({ method: 'GET', url: `/api/klanten/${id}/huisstijl` })).json().logo).toMatch(/^data:/);
    await app.inject({ method: 'PUT', url: `/api/klanten/${id}/huisstijl`, payload: { kleur: '#112233', logo: null } });
    expect((await app.inject({ method: 'GET', url: `/api/klanten/${id}/huisstijl` })).json().logo).toBeNull();
    expect((await app.inject({ method: 'DELETE', url: `/api/klanten/${id}/huisstijl` })).statusCode).toBe(200);
    const [k] = await db.select().from(klanten);
    expect(k.huisstijlKleur).toBeNull();
    expect(k.huisstijlBevestigdOp).toBeNull();
  });

  it('accepteert een eigen upload en weigert ongeldige kleur, ongeldig logo en een onveilige logo-url', async () => {
    const { app, id } = await opzet(veiligOphalen);
    const kies = (payload: unknown) => app.inject({ method: 'PUT', url: `/api/klanten/${id}/huisstijl`, payload: payload as never });
    expect((await kies({ kleur: 'rood' })).statusCode).toBe(400);
    expect((await kies({ kleur: '#fff' })).statusCode).toBe(400);
    expect((await kies({ kleur: '#00807f', logo: { data: 'data:text/html;base64,AAAA' } })).statusCode).toBe(400);
    expect((await kies({ kleur: '#00807f', logo: { data: `data:image/png;base64,${Buffer.from('geen plaatje').toString('base64')}` } })).statusCode).toBe(422);
    expect((await kies({ kleur: '#00807f', logo: { url: 'https://10.0.0.1/logo.png' } })).statusCode).toBe(422);
    expect((await kies({ kleur: '#00807f', logo: { data: `data:image/png;base64,${PNG.toString('base64')}` } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/klanten/${id}/huisstijl` })).json().logo).toMatch(/^data:image\/png/);
  });

  it('alleen de beheerder mag de huisstijl beheren', () => {
    const pad = '/api/klanten/11111111-1111-4111-8111-111111111111/huisstijl';
    expect(magDoen('beheerder', 'PUT', pad)).toBe(true);
    for (const rol of ['accountmanager', 'administratie', 'consultant']) for (const m of ['GET', 'PUT', 'DELETE']) expect(magDoen(rol, m, pad), `${rol} ${m}`).toBe(false);
    expect(magDoen('accountmanager', 'POST', `${pad}/voorstel`)).toBe(false);
  });
});
