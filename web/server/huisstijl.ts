import { lookup as dnsLookup } from 'node:dns';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.js';
import { geldigeKleur } from './klant-rapport.js';
import { klanten } from './schema.js';

/**
 * Huisstijl per gemeente (kleur en logo) voor het PDF-rapport.
 * De server haalt op verzoek van de beheerder een website op en doet daar een VOORSTEL uit; er wordt niets bewaard voordat de beheerder bevestigt.
 * Omdat de server een door een gebruiker ingevoerde URL ophaalt, is alles hier gericht op SSRF-bescherming en harde grenzen
 * (alleen https, alleen publieke IP-adressen op het moment van verbinden, beperkte redirects, tijd en grootte).
 */

export const MAX_HTML = 1_500_000;
export const MAX_CSS = 500_000;
export const MAX_LOGO = 500_000;
const TIJDLIMIET_MS = 10_000;
const MAX_REDIRECTS = 3;

export class OphaalFout extends Error {}

// ── IP-controle ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function ipv4Delen(ip: string): number[] | null {
  const d = ip.split('.');
  if (d.length !== 4 || d.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null;
  return d.map(Number);
}

/** Alleen adressen die op het openbare internet horen; alles wat intern, lokaal, gereserveerd of multicast is wordt geweigerd. */
export function isPubliekIp(ip: string): boolean {
  const type = isIP(ip);
  if (type === 4) {
    const d = ipv4Delen(ip);
    if (!d) return false;
    const [a, b, c] = d;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && c === 0) return false;
    if (a === 192 && b === 0 && c === 2) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (type === 6) {
    const l = ip.toLowerCase().split('%')[0];
    const gemapt = l.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (gemapt) return isPubliekIp(gemapt[1]);
    const hex = l.match(/^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) { const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16); return isPubliekIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`); }
    if (l === '::' || l === '::1') return false;
    const eerste = parseInt(l.split(':')[0] || '0', 16);
    if ((eerste & 0xfe00) === 0xfc00) return false; // fc00::/7
    if ((eerste & 0xffc0) === 0xfe80) return false; // fe80::/10
    if ((eerste & 0xff00) === 0xff00) return false; // multicast
    if (l.startsWith('2001:db8') || l.startsWith('64:ff9b')) return false;
    return true;
  }
  return false;
}

/** `lookup` voor https.request: de controle gebeurt op de adressen waarmee echt verbonden wordt, dus geen DNS-rebinding tussen controle en verbinding. */
function veiligeLookup(hostname: string, opties: unknown, cb: (...a: unknown[]) => void) {
  const o = (typeof opties === 'object' && opties ? opties : {}) as { all?: boolean; family?: number };
  dnsLookup(hostname, { all: true, family: o.family ?? 0 }, (err, adressen) => {
    if (err) return cb(err);
    const lijst = adressen as { address: string; family: number }[];
    if (!lijst.length || lijst.some((a) => !isPubliekIp(a.address))) return cb(new OphaalFout('Adres is niet openbaar bereikbaar'));
    return o.all ? cb(null, lijst) : cb(null, lijst[0].address, lijst[0].family);
  });
}

// ── Veilig ophalen ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Opgehaald { status: number; body: Buffer; type: string; url: string }
export type Ophaler = (url: string, opties: { maxBytes: number }) => Promise<Opgehaald>;

/** Controleert een URL vóór elke aanvraag (ook na een redirect): https, geen inloggegevens, standaardpoort, geen IP-adres dat niet openbaar is. */
export function controleerUrl(invoer: string): URL {
  let u: URL;
  try { u = new URL(invoer); } catch { throw new OphaalFout('Dit is geen geldig webadres'); }
  if (u.protocol !== 'https:') throw new OphaalFout('Alleen https-adressen zijn toegestaan');
  if (u.username || u.password) throw new OphaalFout('Een webadres met inloggegevens is niet toegestaan');
  if (u.port && u.port !== '443') throw new OphaalFout('Alleen de standaardpoort is toegestaan');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isPubliekIp(host)) throw new OphaalFout('Adres is niet openbaar bereikbaar');
  if (!host.includes('.') && !isIP(host)) throw new OphaalFout('Dit is geen openbaar webadres');
  if (/\.(local|internal|localhost|lan|intranet)$/i.test(host)) throw new OphaalFout('Dit is geen openbaar webadres');
  return u;
}

function eenAanvraag(u: URL, maxBytes: number): Promise<{ status: number; body: Buffer; type: string; locatie: string | null }> {
  return new Promise((resolve, reject) => {
    const req = request(u, {
      method: 'GET', lookup: veiligeLookup as never, timeout: TIJDLIMIET_MS, agent: false,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; rapport-huisstijl)', accept: 'text/html,image/*,text/css;q=0.9,*/*;q=0.5', 'accept-encoding': 'identity', 'accept-language': 'nl' },
    }, (res) => {
      const status = res.statusCode ?? 0;
      const locatie = typeof res.headers.location === 'string' ? res.headers.location : null;
      if (status >= 300 && status < 400) { res.resume(); return resolve({ status, body: Buffer.alloc(0), type: '', locatie }); }
      const declared = Number(res.headers['content-length'] ?? 0);
      if (declared > maxBytes) { res.destroy(); return reject(new OphaalFout('Het bestand is te groot')); }
      const delen: Buffer[] = []; let n = 0;
      res.on('data', (d: Buffer) => { n += d.length; if (n > maxBytes) { res.destroy(); reject(new OphaalFout('Het bestand is te groot')); } else delen.push(d); });
      res.on('end', () => resolve({ status, body: Buffer.concat(delen), type: String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase(), locatie: null }));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new OphaalFout('De website reageert niet op tijd')); });
    req.on('error', (e) => reject(e instanceof OphaalFout ? e : new OphaalFout('De website kon niet worden opgehaald')));
    req.end();
  });
}

export const veiligOphalen: Ophaler = async (url, { maxBytes }) => {
  let huidig = controleerUrl(url);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const r = await eenAanvraag(huidig, maxBytes);
    if (r.status >= 300 && r.status < 400) {
      if (!r.locatie) throw new OphaalFout('Doorverwijzing zonder adres');
      huidig = controleerUrl(new URL(r.locatie, huidig).toString());
      continue;
    }
    return { status: r.status, body: r.body, type: r.type, url: huidig.toString() };
  }
  throw new OphaalFout('Te veel doorverwijzingen');
};

// ── Kleur uit een website ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const normHex = (h: string): string | null => {
  const m = h.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const x = m[1].toLowerCase();
  return `#${x.length === 3 ? x.split('').map((c) => c + c).join('') : x}`;
};
function hsl(hex: string): { s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  const s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
  return { s, l };
}
/** Zwart, wit, grijs en bijna-wit zijn nooit een merkkleur (dit vangt bijvoorbeeld een `theme-color` van #000000). */
export const isMerkkleur = (hex: string) => { const { s, l } = hsl(hex); return s >= 0.25 && l >= 0.12 && l <= 0.85; };

export function kleurKandidaten(html: string, stijlbladen: string[] = []): string[] {
  const uit: string[] = [];
  const voeg = (h: string | null | undefined) => { const n = h ? normHex(h) : null; if (n && isMerkkleur(n) && !uit.includes(n)) uit.push(n); };
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const t = m[0];
    if (/name\s*=\s*["'](?:theme-color|msapplication-TileColor)["']/i.test(t)) voeg(t.match(/content\s*=\s*["']([^"']+)["']/i)?.[1]);
  }
  const alles = [html, ...stijlbladen].join('\n');
  for (const m of alles.matchAll(/--(?:[\w-]*?)(?:primary|brand|accent|main|hoofd)[\w-]*\s*:\s*(#[0-9a-f]{3,6})\b/gi)) voeg(m[1]);
  const tel = new Map<string, number>();
  for (const m of alles.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) { const n = normHex(m[0]); if (n && isMerkkleur(n)) tel.set(n, (tel.get(n) ?? 0) + 1); }
  for (const [h] of [...tel].sort((a, b) => b[1] - a[1])) voeg(h);
  return uit.slice(0, 3);
}

// ── Logo uit een website ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function logoKandidaten(html: string, basis: string): string[] {
  const uit: string[] = [];
  const voeg = (href: string | null | undefined) => {
    if (!href) return;
    try { const u = new URL(href.trim().replace(/&amp;/g, '&'), basis); if (u.protocol === 'https:' && !uit.includes(u.toString())) uit.push(u.toString()); } catch { /* ongeldige verwijzing */ }
  };
  for (const m of html.matchAll(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const zoek = (o: unknown): void => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) return o.forEach(zoek);
        const rec = o as Record<string, unknown>;
        const l = rec.logo;
        if (typeof l === 'string') voeg(l); else if (l && typeof l === 'object') voeg(String((l as Record<string, unknown>).url ?? ''));
        Object.values(rec).forEach(zoek);
      };
      zoek(JSON.parse(m[1]));
    } catch { /* ongeldige JSON-LD */ }
  }
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) if (/property\s*=\s*["']og:logo["']/i.test(m[0])) voeg(m[0].match(/content\s*=\s*["']([^"']+)["']/i)?.[1]);
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const t = m[0], src = t.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (src && /logo/i.test([src, t.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1], t.match(/\bclass\s*=\s*["']([^"']*)["']/i)?.[1], t.match(/\bid\s*=\s*["']([^"']*)["']/i)?.[1]].filter(Boolean).join(' '))) voeg(src);
  }
  const iconen = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /rel\s*=\s*["'][^"']*(?:apple-touch-icon|icon)[^"']*["']/i.test(t))
    .map((t) => ({ href: t.match(/href\s*=\s*["']([^"']+)["']/i)?.[1], grootte: Number(t.match(/sizes\s*=\s*["'](\d+)x/i)?.[1] ?? 0) }))
    .sort((a, b) => b.grootte - a.grootte);
  for (const i of iconen) voeg(i.href);
  return uit;
}

const PNG_KOP = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export type LogoType = 'png' | 'jpeg';
/** Bepaalt het echte type aan de hand van de eerste bytes (niet aan wat de server beweert). */
export function afbeeldingType(b: Buffer): LogoType | 'svg' | null {
  if (b.length > 8 && b.subarray(0, 8).equals(PNG_KOP)) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (/<svg[\s>]/i.test(b.subarray(0, 4096).toString('utf8')) && !/<script|onload\s*=/i.test(b.toString('utf8'))) return 'svg';
  return null;
}

/** Zet een afbeelding om naar PNG of JPEG voor in het rapport. SVG wordt met resvg gerenderd; ontbreekt dat, dan wordt SVG overgeslagen. */
export async function logoVoorRapport(b: Buffer): Promise<{ data: Buffer; type: LogoType } | null> {
  const t = afbeeldingType(b);
  if (!t || b.length > MAX_LOGO) return null;
  if (t !== 'svg') return { data: b, type: t };
  try {
    const { Resvg } = await import('@resvg/resvg-js');
    const png = new Resvg(b.toString('utf8'), { fitTo: { mode: 'width', value: 600 }, font: { loadSystemFonts: false }, background: undefined }).render().asPng();
    return png.length <= MAX_LOGO * 2 ? { data: Buffer.from(png), type: 'png' } : null;
  } catch { return null; }
}

// ── Routes (alleen beheerder: niet in rollen.ts opgenomen, dus default-deny voor andere rollen) ────────────────────────────────

const uuid = z.string().uuid();
const websiteSchema = z.string().trim().min(4).max(300).transform((s) => (/^https?:\/\//i.test(s) ? s : `https://${s}`));
const dataUrl = (type: LogoType, data: Buffer) => `data:image/${type};base64,${data.toString('base64')}`;
const MAX_DATA_URL = Math.ceil((MAX_LOGO * 4) / 3) + 64;

export function registreerHuisstijl(app: FastifyInstance, db: Db, ophalen: Ophaler = veiligOphalen) {
  const klantId = (req: { params: unknown }) => { const r = uuid.safeParse((req.params as { id: string }).id); return r.success ? r.data : null; };

  app.get('/api/klanten/:id/huisstijl', async (req, reply) => {
    const id = klantId(req);
    const [k] = id ? await db.select().from(klanten).where(eq(klanten.id, id)) : [];
    if (!k) return reply.code(404).send({ fout: 'Klant niet gevonden' });
    return {
      website: k.website ?? '', kleur: k.huisstijlKleur ?? null, bevestigdOp: k.huisstijlBevestigdOp?.toISOString() ?? null,
      logo: k.huisstijlLogo && k.huisstijlLogoType ? `data:image/${k.huisstijlLogoType};base64,${k.huisstijlLogo}` : null,
    };
  });

  app.post('/api/klanten/:id/huisstijl/voorstel', async (req, reply) => {
    const id = klantId(req);
    const [k] = id ? await db.select({ id: klanten.id }).from(klanten).where(eq(klanten.id, id)) : [];
    if (!k) return reply.code(404).send({ fout: 'Klant niet gevonden' });
    const w = z.object({ website: websiteSchema }).safeParse(req.body);
    if (!w.success) return reply.code(400).send({ fout: 'Vul het webadres van de gemeente in' });
    try {
      const pagina = await ophalen(w.data.website, { maxBytes: MAX_HTML });
      if (pagina.status !== 200 || !/html/.test(pagina.type)) return reply.code(422).send({ fout: 'De website gaf geen webpagina terug' });
      const html = pagina.body.toString('utf8');
      const stijlbladen: string[] = [];
      for (const m of [...html.matchAll(/<link\b[^>]*>/gi)].map((x) => x[0]).filter((t) => /rel\s*=\s*["']stylesheet["']/i.test(t)).slice(0, 2)) {
        const href = m.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
        if (!href) continue;
        try { const css = await ophalen(new URL(href.replace(/&amp;/g, '&'), pagina.url).toString(), { maxBytes: MAX_CSS }); if (css.status === 200) stijlbladen.push(css.body.toString('utf8')); } catch { /* een stijlblad dat niet lukt, slaan we over */ }
      }
      const logos: { url: string; type: LogoType; logo: string }[] = [];
      const overgeslagen: string[] = [];
      for (const url of logoKandidaten(html, pagina.url).slice(0, 8)) {
        if (logos.length >= 4) break;
        try {
          const l = await ophalen(url, { maxBytes: MAX_LOGO });
          if (l.status !== 200) continue;
          const r = await logoVoorRapport(l.body);
          if (r) logos.push({ url, type: r.type, logo: dataUrl(r.type, r.data) }); else overgeslagen.push(url);
        } catch { /* kandidaat onbereikbaar of onveilig: overslaan */ }
      }
      return { website: pagina.url, kleuren: kleurKandidaten(html, stijlbladen), logos, overgeslagen: overgeslagen.length };
    } catch (e) {
      if (e instanceof OphaalFout) return reply.code(422).send({ fout: e.message });
      req.log.warn({ host: (() => { try { return new URL(w.data.website).hostname; } catch { return '?'; } })() }, 'huisstijl voorstel mislukt');
      return reply.code(502).send({ fout: 'De website kon niet worden gelezen' });
    }
  });

  const bevestigSchema = z.object({
    website: z.string().trim().max(300).optional(),
    kleur: z.string().refine(geldigeKleur, 'Kleur moet de vorm #RRGGBB hebben'),
    // undefined = logo ongewijzigd laten, null = logo verwijderen, url = opnieuw (veilig) ophalen, data = eigen upload als data-URL
    logo: z.union([z.null(), z.object({ url: z.string().max(2000) }), z.object({ data: z.string().max(MAX_DATA_URL) })]).optional(),
  });
  app.put('/api/klanten/:id/huisstijl', async (req, reply) => {
    const id = klantId(req);
    const [k] = id ? await db.select({ id: klanten.id }).from(klanten).where(eq(klanten.id, id)) : [];
    if (!id || !k) return reply.code(404).send({ fout: 'Klant niet gevonden' });
    const b = bevestigSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ fout: b.error.issues[0]?.message ?? 'Ongeldige invoer' });
    let website: string | null | undefined;
    if (b.data.website !== undefined) {
      if (!b.data.website) website = null;
      else { const w = websiteSchema.safeParse(b.data.website); if (!w.success) return reply.code(400).send({ fout: 'Ongeldig webadres' }); website = w.data; }
    }
    const wijziging: Partial<typeof klanten.$inferInsert> = { huisstijlKleur: b.data.kleur.toLowerCase(), huisstijlBevestigdOp: new Date(), bijgewerktOp: new Date() };
    if (website !== undefined) wijziging.website = website;
    if (b.data.logo === null) { wijziging.huisstijlLogo = null; wijziging.huisstijlLogoType = null; }
    else if (b.data.logo) {
      let bytes: Buffer;
      if ('url' in b.data.logo) {
        try { const l = await ophalen(b.data.logo.url, { maxBytes: MAX_LOGO }); if (l.status !== 200) throw new OphaalFout('Het logo kon niet worden opgehaald'); bytes = l.body; }
        catch (e) { return reply.code(422).send({ fout: e instanceof OphaalFout ? e.message : 'Het logo kon niet worden opgehaald' }); }
      } else {
        const m = b.data.logo.data.match(/^data:image\/(?:png|jpeg|svg\+xml);base64,([A-Za-z0-9+/=]+)$/);
        if (!m) return reply.code(400).send({ fout: 'Het logo moet een PNG-, JPEG- of SVG-bestand zijn' });
        bytes = Buffer.from(m[1], 'base64');
      }
      const r = await logoVoorRapport(bytes);
      if (!r) return reply.code(422).send({ fout: 'Dit logo kan niet worden gebruikt (PNG, JPEG of SVG, maximaal 500 KB)' });
      wijziging.huisstijlLogo = r.data.toString('base64'); wijziging.huisstijlLogoType = r.type;
    }
    await db.update(klanten).set(wijziging).where(eq(klanten.id, id));
    return { ok: true };
  });

  app.delete('/api/klanten/:id/huisstijl', async (req, reply) => {
    const id = klantId(req);
    const [k] = id ? await db.select({ id: klanten.id }).from(klanten).where(eq(klanten.id, id)) : [];
    if (!id || !k) return reply.code(404).send({ fout: 'Klant niet gevonden' });
    await db.update(klanten).set({ huisstijlKleur: null, huisstijlLogo: null, huisstijlLogoType: null, huisstijlBevestigdOp: null, bijgewerktOp: new Date() }).where(eq(klanten.id, id));
    return { ok: true };
  });
}

/** Voor het rapport: alleen een bevestigde huisstijl wordt gebruikt. */
export async function leesHuisstijl(db: Db, id: string): Promise<{ kleur: string; logo: Buffer | null } | null> {
  const [k] = await db.select({ kleur: klanten.huisstijlKleur, logo: klanten.huisstijlLogo, bevestigd: klanten.huisstijlBevestigdOp }).from(klanten).where(eq(klanten.id, id));
  if (!k?.bevestigd || !geldigeKleur(k.kleur)) return null;
  return { kleur: k.kleur, logo: k.logo ? Buffer.from(k.logo, 'base64') : null };
}
