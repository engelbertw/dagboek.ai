/** Koppeling met Keycloak (realm `dagboek`): inloggen met MFA en het beheren van gebruikers. Alleen als omgevingsvariabelen. */
export interface KeycloakConfig {
  /** Bijvoorbeeld https://keycloak.example/realms/dagboek */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Service-account voor het scherm Gebruikers; zonder deze twee is dat scherm uit. */
  beheerClientId: string;
  beheerClientSecret: string;
}

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
  /** Inloggegevens voor Jira Cloud; alleen als omgevingsvariabele, nooit in de database. */
  jiraEmail: string;
  jiraApiToken: string;
  /** Publieke URL van deze app, voor de link vanuit een Jira-ticket terug naar het dagboek. */
  publiekeUrl: string;
  /** Sleutel waarmee de gespreksmotor de hulpmiddelen (MCP) aanroept. Leeg = hulpmiddelen staan uit. */
  mcpKey: string;
  /** Aanwezig = inloggen via Keycloak. */
  keycloak?: KeycloakConfig;
  /** De oude login met ADMIN_EMAIL en wachtwoord. Standaard aan zolang er geen Keycloak is; met Keycloak alleen als NOODLOGIN=aan. */
  noodlogin?: boolean;
}

export function loadConfig(env = process.env): Config {
  const issuer = (env.KEYCLOAK_ISSUER ?? '').replace(/\/$/, '');
  const keycloak: KeycloakConfig | undefined = issuer
    ? {
      issuer, clientId: env.KEYCLOAK_CLIENT_ID ?? '', clientSecret: env.KEYCLOAK_CLIENT_SECRET ?? '',
      beheerClientId: env.KEYCLOAK_ADMIN_CLIENT_ID ?? '', beheerClientSecret: env.KEYCLOAK_ADMIN_CLIENT_SECRET ?? '',
    }
    : undefined;
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
    jiraEmail: env.JIRA_EMAIL ?? '',
    jiraApiToken: env.JIRA_API_TOKEN ?? '',
    publiekeUrl: (env.PUBLIC_URL ?? '').replace(/\/$/, ''),
    mcpKey: env.MCP_KEY ?? '',
    keycloak,
    noodlogin: !keycloak || env.NOODLOGIN === 'aan',
  };
}

export const noodloginAan = (c: Config) => c.noodlogin ?? true;

export function ontbrekendeInstellingen(c: Config): string[] {
  const nodig: [keyof Config, string][] = [
    ['databaseUrl', 'DATABASE_URL'], ['sessionSecret', 'SESSION_SECRET'], ['serviceKey', 'SERVICE_KEY'],
    ...(noodloginAan(c) ? [['adminEmail', 'ADMIN_EMAIL'], ['adminPasswordHash', 'ADMIN_PASSWORD_HASH']] as [keyof Config, string][] : []),
  ];
  const ontbreekt = nodig.filter(([k]) => !c[k]).map(([, naam]) => naam);
  if (c.keycloak) {
    if (!c.keycloak.clientId) ontbreekt.push('KEYCLOAK_CLIENT_ID');
    if (!c.keycloak.clientSecret) ontbreekt.push('KEYCLOAK_CLIENT_SECRET');
  }
  return ontbreekt;
}
