import type { Config } from './config.js';

export interface BelOpdracht {
  telefoonnummer: string;
  medewerker: string;
  onderwerpen: Onderwerp[];
  toestemming_nodig: boolean;
  web_call_id: string;
}

export interface Onderwerp {
  titel: string;
  project?: string;
  aanwijzingen?: string;
  laatste_update?: string;
  laatste_update_datum?: string;
  open_punten?: string[];
}

export type BelResultaat = { gebeld: true; call_id: string } | { gebeld: false; reden: string };
export type VoiceClient = (opdracht: BelOpdracht) => Promise<BelResultaat>;

export function maakVoiceClient(config: Config): VoiceClient {
  return async (opdracht) => {
    if (!config.voiceUrl || !config.voiceAdminToken) return { gebeld: false, reden: 'voice-service is niet geconfigureerd' };
    try {
      const r = await fetch(`${config.voiceUrl}/bel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.voiceAdminToken}` },
        body: JSON.stringify(opdracht),
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) return { gebeld: false, reden: `voice-service gaf ${r.status}` };
      return (await r.json()) as BelResultaat;
    } catch (e) {
      return { gebeld: false, reden: `voice-service niet bereikbaar (${(e as Error).name})` };
    }
  };
}
