import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSIE_DUUR_MS = 12 * 60 * 60 * 1000;

export function hashWachtwoord(wachtwoord: string): string {
  const zout = randomBytes(16).toString('hex');
  return `scrypt$${zout}$${scryptSync(wachtwoord, zout, 32).toString('hex')}`;
}

export function controleerWachtwoord(wachtwoord: string, opgeslagen: string): boolean {
  const [type, zout, hash] = opgeslagen.split('$');
  if (type !== 'scrypt' || !zout || !hash) return false;
  const verwacht = Buffer.from(hash, 'hex');
  const werkelijk = scryptSync(wachtwoord, zout, verwacht.length);
  return werkelijk.length === verwacht.length && timingSafeEqual(werkelijk, verwacht);
}

const teken = (data: string, geheim: string) => createHmac('sha256', geheim).update(data).digest('base64url');

/** Een kort leesbaar, ondertekend pakket (sessie, of de tijdelijke gegevens van een Keycloak-inlogpoging). */
export function onderteken(inhoud: Record<string, unknown>, geheim: string, geldigMs: number, nu = Date.now()): string {
  const data = Buffer.from(JSON.stringify({ ...inhoud, exp: nu + geldigMs })).toString('base64url');
  return `${data}.${teken(data, geheim)}`;
}

export function leesOndertekend(token: string | undefined, geheim: string, nu = Date.now()): Record<string, unknown> | null {
  if (!token) return null;
  const [data, handtekening] = token.split('.');
  if (!data || !handtekening) return null;
  const verwacht = Buffer.from(teken(data, geheim));
  const werkelijk = Buffer.from(handtekening);
  if (verwacht.length !== werkelijk.length || !timingSafeEqual(verwacht, werkelijk)) return null;
  try {
    const inhoud = JSON.parse(Buffer.from(data, 'base64url').toString());
    return inhoud && typeof inhoud === 'object' && typeof inhoud.exp === 'number' && inhoud.exp > nu ? inhoud : null;
  } catch {
    return null;
  }
}

export interface Sessie { email: string; naam?: string; rol?: string }

export function maakSessie(email: string, geheim: string, nu = Date.now(), extra: { naam?: string; rol?: string } = {}): string {
  return onderteken({ email, ...extra }, geheim, SESSIE_DUUR_MS, nu);
}

export function leesSessie(token: string | undefined, geheim: string, nu = Date.now()): Sessie | null {
  const i = leesOndertekend(token, geheim, nu);
  if (!i || typeof i.email !== 'string') return null;
  return { email: i.email, ...(typeof i.naam === 'string' ? { naam: i.naam } : {}), ...(typeof i.rol === 'string' ? { rol: i.rol } : {}) };
}

/** Eenvoudige beperking op inlogpogingen per IP: 5 per 15 minuten. */
export class InlogBeperking {
  private pogingen = new Map<string, number[]>();
  constructor(private max = 5, private venster = 15 * 60 * 1000) {}
  mislukt(ip: string, nu = Date.now()): void {
    this.pogingen.set(ip, [...this.recent(ip, nu), nu]);
  }
  geblokkeerd(ip: string, nu = Date.now()): boolean {
    return this.recent(ip, nu).length >= this.max;
  }
  private recent(ip: string, nu: number): number[] {
    return (this.pogingen.get(ip) ?? []).filter((t) => nu - t < this.venster);
  }
}
