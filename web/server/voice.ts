import type { Config } from './config.js';

export interface BelOpdracht {
  telefoonnummer: string;
  medewerker: string;
  onderwerpen: Onderwerp[];
  toestemming_nodig: boolean;
  web_call_id: string;
  houding?: string;
  instructie?: string;
}

export interface Onderwerp {
  titel: string;
  project?: string;
  aanwijzingen?: string;
  laatste_update?: string;
  laatste_update_datum?: string;
  open_punten?: string[];
  te_laat_punten?: string[];
}

/** `onzeker`: het verzoek is verstuurd maar het antwoord ontbreekt (time-out, netwerk); voice kan het gesprek dan toch gestart hebben. */
export type BelResultaat = { gebeld: true; call_id: string } | { gebeld: false; reden: string; onzeker?: boolean };
export type VoiceClient = (opdracht: BelOpdracht) => Promise<BelResultaat>;

export function maakVoiceClient(config: Config): VoiceClient {
  return async (opdracht) => {
    if (!config.voiceUrl || !config.voiceAdminToken) return { gebeld: false, reden: 'voice-service is niet geconfigureerd' };
    try {
      const r = await fetch(`${config.voiceUrl}/bel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.voiceAdminToken}`, 'x-correlation-id': opdracht.web_call_id },
        body: JSON.stringify(opdracht),
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) return { gebeld: false, reden: `voice-service gaf ${r.status}`, onzeker: r.status >= 500 };
      return (await r.json()) as BelResultaat;
    } catch (e) {
      return { gebeld: false, reden: `voice-service niet bereikbaar (${(e as Error).name})`, onzeker: true };
    }
  };
}

/** Wat voice weet over een eerder verstuurd verzoek (opgezocht met de web_call_id als idempotency-sleutel). */
export type OpzoekResultaat = { bereikt: true; bekend: false } | { bereikt: true; bekend: true; call_id: string; gebeld: boolean; onzeker: boolean } | { bereikt: false };
export type VoiceOpzoeker = (webCallId: string) => Promise<OpzoekResultaat>;

export function maakVoiceOpzoeker(config: Config): VoiceOpzoeker {
  return async (webCallId) => {
    if (!config.voiceUrl || !config.voiceAdminToken) return { bereikt: false };
    try {
      const r = await fetch(`${config.voiceUrl}/bel/${encodeURIComponent(webCallId)}`, {
        headers: { authorization: `Bearer ${config.voiceAdminToken}`, 'x-correlation-id': webCallId }, signal: AbortSignal.timeout(10_000),
      });
      if (r.status === 404) return { bereikt: true, bekend: false };
      if (!r.ok) return { bereikt: false };
      const d = (await r.json()) as { call_id: string; gebeld: boolean; onzeker?: boolean };
      return { bereikt: true, bekend: true, call_id: d.call_id, gebeld: d.gebeld, onzeker: !!d.onzeker };
    } catch { return { bereikt: false }; }
  };
}
