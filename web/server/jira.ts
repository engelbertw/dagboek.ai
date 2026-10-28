import type { Config } from './config.js';

export interface JiraInstellingen { site: string; project: string; issuetype: string }

/** Wat er van een open punt naar Jira gaat. Nooit gespreksinhoud: alleen de tekst van het punt zelf. */
export interface JiraPunt {
  id: string; tekst: string; onderwerp: string; eigenaar: string; eigenaarEmail: string; deadline: string | null; link: string | null;
}
export interface JiraTicket { sleutel: string; url: string; bestondAl: boolean }

/** Een fout van Jira met een melding die veilig is om te tonen (nooit de inloggegevens). */
export class JiraFout extends Error {
  constructor(readonly status: number, melding: string) { super(melding); this.name = 'JiraFout'; }
}

export interface JiraClient {
  beschikbaar(): boolean;
  test(i: JiraInstellingen): Promise<{ naam: string; project: string }>;
  maakAan(i: JiraInstellingen, punt: JiraPunt): Promise<JiraTicket>;
}

const SITE = /^[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net$/;
const PROJECT = /^[A-Z][A-Z0-9_]{1,9}$/;

/** Accepteert `naam.atlassian.net` ook als URL. Alleen atlassian.net: de site komt in een host, dus geen vrije invoer. */
export function schoneSite(invoer: string): string | null {
  const s = invoer.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return SITE.test(s) ? s : null;
}
export const geldigProject = (p: string) => PROJECT.test(p);

/** Gegevens uit gesprekken zijn onbetrouwbare invoer: zonder stuurtekens, op één regel en begrensd. */
function schoon(tekst: string, max: number): string {
  const t = [...tekst].map((c) => (c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) < 160) ? ' ' : c)).join('');
  return t.split(/\s+/).filter(Boolean).join(' ').slice(0, max);
}

export const jiraLabel = (id: string) => `dagboek-${id}`;

export function bouwTicket(i: JiraInstellingen, p: JiraPunt, accountId?: string) {
  const regels = [
    `Onderwerp: ${schoon(p.onderwerp, 200)}`,
    `Eigenaar: ${schoon(p.eigenaar, 100) || 'niet toegewezen'}`,
    `Deadline: ${p.deadline ?? 'geen'}`,
    ...(p.link ? [`Dagboek: ${p.link}`] : []),
  ];
  return {
    fields: {
      project: { key: i.project },
      issuetype: { name: i.issuetype },
      summary: schoon(p.tekst, 255),
      description: {
        type: 'doc', version: 1,
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: schoon(p.tekst, 2000) }] },
          { type: 'paragraph', content: [{ type: 'text', text: regels.join('\n') }] },
        ],
      },
      labels: ['dagboek', jiraLabel(p.id)],
      ...(p.deadline ? { duedate: p.deadline } : {}),
      ...(accountId ? { assignee: { accountId } } : {}),
    },
  };
}

export function maakJiraClient(config: Config, haal: typeof fetch = fetch, wacht: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): JiraClient {
  const auth = () => `Basic ${Buffer.from(`${config.jiraEmail}:${config.jiraApiToken}`).toString('base64')}`;

  async function aanroep(i: JiraInstellingen, pad: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
    for (let poging = 1; ; poging++) {
      let r: Response;
      try {
        r = await haal(`https://${i.site}${pad}`, {
          method: init.method ?? 'GET', signal: AbortSignal.timeout(15_000),
          headers: { Authorization: auth(), Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
          body: init.body ? JSON.stringify(init.body) : undefined,
        });
      } catch {
        throw new JiraFout(502, 'Jira is niet bereikbaar of antwoordde te langzaam');
      }
      if (r.status === 429 && poging === 1) { await wacht(Math.min(Number(r.headers.get('retry-after')) || 1, 5) * 1000); continue; }
      if (r.ok) return r.status === 204 ? {} : r.json().catch(() => ({}));
      if (r.status === 401) throw new JiraFout(401, 'Jira weigerde de inloggegevens (controleer JIRA_EMAIL en JIRA_API_TOKEN; een token verloopt na een jaar)');
      if (r.status === 403) throw new JiraFout(403, 'Dit Jira-account mag dit niet (rechten op het project?)');
      if (r.status === 404) throw new JiraFout(404, 'Niet gevonden in Jira (controleer site en projectsleutel)');
      if (r.status === 429) throw new JiraFout(429, 'Jira vraagt om even te wachten, probeer het straks opnieuw');
      const detail = await r.json().catch(() => ({})) as { errorMessages?: string[]; errors?: Record<string, string> };
      const tekst = [...(detail.errorMessages ?? []), ...Object.values(detail.errors ?? {})].slice(0, 2).map((t) => schoon(String(t), 150)).join('; ');
      throw new JiraFout(r.status >= 500 ? 502 : 422, `Jira weigerde het verzoek (${r.status})${tekst ? `: ${tekst}` : ''}`);
    }
  }

  return {
    beschikbaar: () => !!(config.jiraEmail && config.jiraApiToken),
    async test(i) {
      const ik = await aanroep(i, '/rest/api/3/myself');
      const p = await aanroep(i, `/rest/api/3/project/${encodeURIComponent(i.project)}`);
      return { naam: schoon(String(ik.displayName ?? ''), 100), project: schoon(String(p.name ?? i.project), 100) };
    },
    async maakAan(i, punt) {
      const url = (sleutel: string) => `https://${i.site}/browse/${sleutel}`;
      // Een eerdere poging kan geslaagd zijn zonder dat we het antwoord kregen: zoek eerst op het label van dit punt.
      const jql = `labels = "${jiraLabel(punt.id)}"`;
      const bestaand = await aanroep(i, `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=key&maxResults=1`);
      const sleutel0 = bestaand.issues?.[0]?.key;
      if (typeof sleutel0 === 'string') return { sleutel: sleutel0, url: url(sleutel0), bestondAl: true };
      let accountId: string | undefined;
      if (punt.eigenaarEmail) {
        const gebruikers = await aanroep(i, `/rest/api/3/user/search?query=${encodeURIComponent(punt.eigenaarEmail)}`).catch(() => []);
        const gelijk = (Array.isArray(gebruikers) ? gebruikers : []).filter((g: { emailAddress?: string; accountId?: string }) => g.emailAddress?.toLowerCase() === punt.eigenaarEmail.toLowerCase());
        if (gelijk.length === 1 && typeof gelijk[0].accountId === 'string') accountId = gelijk[0].accountId;
      }
      const nieuw = await aanroep(i, '/rest/api/3/issue', { method: 'POST', body: bouwTicket(i, punt, accountId) });
      if (typeof nieuw.key !== 'string') throw new JiraFout(502, 'Jira gaf geen ticketsleutel terug');
      return { sleutel: nieuw.key, url: url(nieuw.key), bestondAl: false };
    },
  };
}
