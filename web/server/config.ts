export interface Config {
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  adminEmail: string;
  adminPasswordHash: string;
  secureCookies: boolean;
  voiceUrl: string;
  voiceAdminToken: string;
  serviceKey: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  transcriptBewaarDagen: number;
  /** Zonder bevestigde toestemming bewaren we een transcript hooguit zoveel uur. */
  transcriptOnbevestigdUren: number;
}

export function loadConfig(env = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL ?? '',
    sessionSecret: env.SESSION_SECRET ?? '',
    adminEmail: (env.ADMIN_EMAIL ?? '').toLowerCase(),
    adminPasswordHash: env.ADMIN_PASSWORD_HASH ?? '',
    secureCookies: env.INSECURE_COOKIES !== 'true',
    voiceUrl: (env.VOICE_URL ?? '').replace(/\/$/, ''),
    voiceAdminToken: env.VOICE_ADMIN_TOKEN ?? '',
    serviceKey: env.SERVICE_KEY ?? '',
    llmBaseUrl: (env.TSYSTEMS_BASE_URL ?? '').replace(/\/$/, ''),
    llmApiKey: env.TSYSTEMS_API_KEY ?? '',
    llmModel: env.LLM_MODEL ?? 'gemma-4',
    transcriptBewaarDagen: Number(env.TRANSCRIPT_BEWAAR_DAGEN ?? 30),
    transcriptOnbevestigdUren: Number(env.TRANSCRIPT_ONBEVESTIGD_UREN ?? 24),
  };
}

export function ontbrekendeInstellingen(c: Config): string[] {
  const nodig: [keyof Config, string][] = [
    ['databaseUrl', 'DATABASE_URL'], ['sessionSecret', 'SESSION_SECRET'], ['adminEmail', 'ADMIN_EMAIL'],
    ['adminPasswordHash', 'ADMIN_PASSWORD_HASH'], ['serviceKey', 'SERVICE_KEY'],
  ];
  return nodig.filter(([k]) => !c[k]).map(([, naam]) => naam);
}
