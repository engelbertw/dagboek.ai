/**
 * Inloggen via Keycloak (OpenID Connect, authorization code met PKCE). De app blijft zelf de sessiecookie uitgeven (auth.ts); Keycloak bepaalt
 * alleen wie er mag inloggen, en dwingt het wachtwoord en de tweede factor (TOTP) af. Tokens worden niet bewaard.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import type { KeycloakConfig } from './config.js';

export const BEHEERDER_ROL = 'beheerder';

type Haal = typeof fetch;

export interface OidcInlog { email: string; naam: string; rol: string }

export interface Oidc {
  /** Maakt de URL waar de browser naartoe gaat, met de gegevens die in de callback weer nodig zijn. */
  start(redirectUri: string): Promise<{ url: string; state: string; nonce: string; verifier: string }>;
  /** Ruilt de code voor tokens, controleert die en geeft de ingelogde persoon terug. Gooit een fout bij alles wat niet klopt. */
  afronden(p: { code: string; verifier: string; nonce: string; redirectUri: string }): Promise<OidcInlog>;
  /** Waar de browser heen moet om ook bij Keycloak uit te loggen. */
  uitlogUrl(terugNaar: string): Promise<string>;
}

export class OidcFout extends Error {
  constructor(readonly code: 'geen_toegang' | 'ongeldig' | 'keycloak', bericht: string) { super(bericht); }
}

interface Ontdekking { authorization_endpoint: string; token_endpoint: string; jwks_uri: string; issuer: string; end_session_endpoint?: string }

const base64url = (b: Buffer) => b.toString('base64url');

export function maakOidc(cfg: KeycloakConfig, haal: Haal = fetch): Oidc {
  let ontdekt: { waarde: Ontdekking; tot: number } | null = null;
  let sleutels: { waarde: ReturnType<typeof createLocalJWKSet>; tot: number } | null = null;

  async function json<T>(url: string, init?: RequestInit): Promise<T> {
    let r: Response;
    try { r = await haal(url, { ...init, signal: AbortSignal.timeout(8000) }); } catch { throw new OidcFout('keycloak', 'Keycloak is niet bereikbaar'); }
    if (!r.ok) throw new OidcFout(r.status >= 500 ? 'keycloak' : 'ongeldig', `Keycloak antwoordde ${r.status}`);
    return (await r.json()) as T;
  }

  async function ontdek(): Promise<Ontdekking> {
    if (ontdekt && ontdekt.tot > Date.now()) return ontdekt.waarde;
    const d = await json<Ontdekking>(`${cfg.issuer}/.well-known/openid-configuration`);
    // Een ander issuer in de ontdekking is een teken dat dit niet de bedoelde Keycloak is.
    if (d.issuer !== cfg.issuer) throw new OidcFout('keycloak', 'Onverwachte issuer');
    ontdekt = { waarde: d, tot: Date.now() + 10 * 60_000 };
    return d;
  }

  async function sleutelset(opnieuw = false) {
    if (!opnieuw && sleutels && sleutels.tot > Date.now()) return sleutels.waarde;
    const d = await ontdek();
    const set = createLocalJWKSet(await json<JSONWebKeySet>(d.jwks_uri));
    sleutels = { waarde: set, tot: Date.now() + 10 * 60_000 };
    return set;
  }

  async function controleer(token: string, opties: { audience?: string }) {
    const proef = async (opnieuw: boolean) => jwtVerify(token, await sleutelset(opnieuw), { issuer: cfg.issuer, audience: opties.audience, algorithms: ['RS256', 'ES256', 'PS256'] });
    try { return (await proef(false)).payload; } catch (e) {
      // Na een sleutelwissel in Keycloak is de bewaarde sleutelset verouderd: één keer opnieuw ophalen.
      if ((e as { code?: string }).code === 'ERR_JWKS_NO_MATCHING_KEY') return (await proef(true)).payload;
      throw new OidcFout('ongeldig', 'Token niet geldig');
    }
  }

  return {
    async start(redirectUri) {
      const d = await ontdek();
      const state = base64url(randomBytes(24));
      const nonce = base64url(randomBytes(24));
      const verifier = base64url(randomBytes(48));
      const url = new URL(d.authorization_endpoint);
      url.search = new URLSearchParams({
        client_id: cfg.clientId, response_type: 'code', scope: 'openid profile email', redirect_uri: redirectUri,
        state, nonce, code_challenge: base64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
      }).toString();
      return { url: url.toString(), state, nonce, verifier };
    },

    async afronden({ code, verifier, nonce, redirectUri }) {
      const d = await ontdek();
      const antwoord = await json<{ id_token?: string; access_token?: string }>(d.token_endpoint, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: cfg.clientId, client_secret: cfg.clientSecret, code_verifier: verifier,
        }),
      });
      if (!antwoord.id_token || !antwoord.access_token) throw new OidcFout('ongeldig', 'Tokens ontbreken');
      const id = await controleer(antwoord.id_token, { audience: cfg.clientId });
      if (id.nonce !== nonce) throw new OidcFout('ongeldig', 'Nonce klopt niet');
      // De rollen staan in het access token (Keycloak zet realm_access daar, niet in het ID-token).
      const toegang = await controleer(antwoord.access_token, {});
      const rollen = (toegang as { realm_access?: { roles?: unknown } }).realm_access?.roles;
      if (!Array.isArray(rollen) || !rollen.includes(BEHEERDER_ROL)) throw new OidcFout('geen_toegang', 'Geen beheerdersrol');
      const email = String(id.email ?? '').trim().toLowerCase();
      if (!email) throw new OidcFout('ongeldig', 'Geen e-mailadres in het token');
      return { email, naam: String(id.name ?? id.preferred_username ?? email).slice(0, 200), rol: BEHEERDER_ROL };
    },

    async uitlogUrl(terugNaar) {
      const d = await ontdek();
      if (!d.end_session_endpoint) return terugNaar;
      const url = new URL(d.end_session_endpoint);
      url.search = new URLSearchParams({ client_id: cfg.clientId, post_logout_redirect_uri: terugNaar }).toString();
      return url.toString();
    },
  };
}
