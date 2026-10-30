import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import { JiraFout, bouwTicket, maakJiraClient, schoneSite, type JiraClient, type JiraPunt } from '../jira.js';
import { activiteiten } from '../schema.js';
import { maakTestApp } from './helpers.js';

const open: Awaited<ReturnType<typeof maakTestApp>>[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

const INST = { site: 'acme.atlassian.net', project: 'PROJ', issuetype: 'Task' };
const PUNT: JiraPunt = { id: '11111111-1111-4111-8111-111111111111', tekst: 'Offerte sturen', onderwerp: 'Klant X', eigenaar: 'Daan', eigenaarEmail: 'daan@acme.nl', deadline: '2026-11-06', link: 'https://dagboek.test/onderwerp/1' };
const config = loadConfig({ JIRA_EMAIL: 'bot@acme.nl', JIRA_API_TOKEN: 'geheim-token' } as any);
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

function nepFetch(antwoorden: Response[]) {
  const aanroepen: { url: string; method: string; body?: any; auth?: string }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    aanroepen.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined, auth: (init.headers as any).Authorization });
    return antwoorden.shift() ?? json(500, {});
  }) as unknown as typeof fetch;
  return { f, aanroepen };
}
const geenWacht = async () => {};

describe('jira-client', () => {
  it('accepteert alleen atlassian.net als site', () => {
    expect(schoneSite('https://Acme.atlassian.net/jira/x')).toBe('acme.atlassian.net');
    expect(schoneSite('acme.example.com')).toBeNull();
    expect(schoneSite('evil.com/.atlassian.net')).toBeNull();
    expect(schoneSite('acme.atlassian.net.evil.com')).toBeNull();
  });

  it('zoekt eerst op het label en maakt dan een ticket met eigenaar, deadline en label', async () => {
    const { f, aanroepen } = nepFetch([json(200, { issues: [] }), json(200, [{ emailAddress: 'daan@acme.nl', accountId: 'acc-1' }]), json(201, { key: 'PROJ-7' })]);
    const t = await maakJiraClient(config, f, geenWacht).maakAan(INST, PUNT);
    expect(t).toEqual({ sleutel: 'PROJ-7', url: 'https://acme.atlassian.net/browse/PROJ-7', bestondAl: false });
    expect(aanroepen[0].url).toContain(encodeURIComponent(`labels = "dagboek-${PUNT.id}"`));
    const velden = aanroepen[2].body.fields;
    expect(velden).toMatchObject({ summary: 'Offerte sturen', duedate: '2026-11-06', assignee: { accountId: 'acc-1' }, project: { key: 'PROJ' }, issuetype: { name: 'Task' } });
    expect(velden.labels).toContain(`dagboek-${PUNT.id}`);
    expect(aanroepen[2].auth).toBe(`Basic ${Buffer.from('bot@acme.nl:geheim-token').toString('base64')}`);
  });

  it('maakt geen tweede ticket als het label al bestaat', async () => {
    const { f, aanroepen } = nepFetch([json(200, { issues: [{ key: 'PROJ-3' }] })]);
    expect(await maakJiraClient(config, f, geenWacht).maakAan(INST, PUNT)).toMatchObject({ sleutel: 'PROJ-3', bestondAl: true });
    expect(aanroepen).toHaveLength(1);
  });

  it('wijst niet toe als het e-mailadres niet precies één gebruiker oplevert', async () => {
    const { f, aanroepen } = nepFetch([json(200, { issues: [] }), json(200, [{ emailAddress: 'ander@acme.nl', accountId: 'x' }]), json(201, { key: 'PROJ-8' })]);
    await maakJiraClient(config, f, geenWacht).maakAan(INST, PUNT);
    expect(aanroepen[2].body.fields.assignee).toBeUndefined();
  });

  it('probeert één keer opnieuw bij 429 en geeft duidelijke fouten voor 401, 404 en 400', async () => {
    const een = nepFetch([json(429, {}, { 'retry-after': '1' }), json(200, { issues: [{ key: 'PROJ-1' }] })]);
    expect((await maakJiraClient(config, een.f, geenWacht).maakAan(INST, PUNT)).sleutel).toBe('PROJ-1');
    const twee = nepFetch([json(429, {}), json(429, {})]);
    await expect(maakJiraClient(config, twee.f, geenWacht).maakAan(INST, PUNT)).rejects.toMatchObject({ status: 429 });
    await expect(maakJiraClient(config, nepFetch([json(401, {})]).f, geenWacht).maakAan(INST, PUNT)).rejects.toThrow(/inloggegevens/);
    await expect(maakJiraClient(config, nepFetch([json(404, {})]).f, geenWacht).test(INST)).rejects.toMatchObject({ status: 404 });
    const fout = await maakJiraClient(config, nepFetch([json(200, { issues: [] }), json(200, []), json(400, { errors: { issuetype: 'Ongeldig issuetype' } })]).f, geenWacht).maakAan(INST, PUNT).catch((e) => e);
    expect(fout).toBeInstanceOf(JiraFout);
    expect(fout.message).toContain('Ongeldig issuetype');
    expect(fout.message).not.toContain('geheim-token');
  });

  it('maakt van een netwerkfout een nette melding', async () => {
    const f = (async () => { throw new Error('socket hang up met geheim-token'); }) as unknown as typeof fetch;
    const fout = await maakJiraClient(config, f, geenWacht).maakAan(INST, PUNT).catch((e) => e);
    expect(fout).toMatchObject({ status: 502 });
    expect(fout.message).not.toContain('geheim-token');
  });

  it('koppelt het ingestelde team aan het ticket', () => {
    const team = 'a9249ebd-cccb-4d5e-be27-fc98fdc877be';
    expect(bouwTicket({ ...INST, teamId: team }, PUNT).fields).toMatchObject({ customfield_10001: team });
    expect(bouwTicket(INST, PUNT).fields).not.toHaveProperty('customfield_10001');
  });

  it('begrenst en reinigt tekst uit het gesprek', () => {
    const t = bouwTicket(INST, { ...PUNT, tekst: `Doe dit\n\u0000nu ${'x'.repeat(400)}` });
    expect(t.fields.summary.length).toBeLessThanOrEqual(255);
    expect(t.fields.summary).not.toMatch(/[\n\u0000]/);
  });
});

function nepJira(opties: { beschikbaar?: boolean; fout?: JiraFout } = {}) {
  const gemaakt: JiraPunt[] = [];
  const client: JiraClient = {
    beschikbaar: () => opties.beschikbaar ?? true,
    test: async () => ({ naam: 'Dagboek-bot', project: 'Project' }),
    maakAan: async (_i, p) => { if (opties.fout) throw opties.fout; gemaakt.push(p); return { sleutel: `PROJ-${gemaakt.length}`, url: `https://acme.atlassian.net/browse/PROJ-${gemaakt.length}`, bestondAl: false }; },
  };
  return { client, gemaakt };
}

async function met(jira: JiraClient) {
  const t = await maakTestApp(undefined, undefined, jira); open.push(t);
  const topic = (await t.api('POST', '/api/topics', { titel: 'Klant X' })).json();
  const maak = async (tekst: string) => (await t.api('POST', '/api/activiteiten', { topicId: topic.id, omschrijving: tekst })).json();
  return { t, topic, maak };
}

describe('jira-koppeling in de app', () => {
  it('valideert de instellingen en bewaart ze', async () => {
    const { t } = await met(nepJira().client);
    expect((await t.api('PUT', '/api/instellingen/jira', { site: 'acme.example.com', project: 'PROJ', issuetype: 'Task' })).statusCode).toBe(400);
    expect((await t.api('PUT', '/api/instellingen/jira', { site: 'acme.atlassian.net', project: 'p', issuetype: 'Task' })).statusCode).toBe(400);
    const r = (await t.api('PUT', '/api/instellingen/jira', { site: 'https://acme.atlassian.net', project: 'proj', issuetype: 'Task' })).json();
    expect(r).toMatchObject({ site: 'acme.atlassian.net', project: 'PROJ', geconfigureerd: true });
    expect(JSON.stringify(r)).not.toContain('token');
  });

  it('bewaart een team-id en weigert een ongeldig id', async () => {
    const { t } = await met(nepJira().client);
    const basis = { site: 'acme.atlassian.net', project: 'PROJ', issuetype: 'Story' };
    expect((await t.api('PUT', '/api/instellingen/jira', { ...basis, teamId: 'geen-uuid' })).statusCode).toBe(400);
    expect((await t.api('PUT', '/api/instellingen/jira', { ...basis, teamId: 'a9249ebd-cccb-4d5e-be27-fc98fdc877be' })).json()).toMatchObject({ teamId: 'a9249ebd-cccb-4d5e-be27-fc98fdc877be' });
    expect((await t.api('PUT', '/api/instellingen/jira', basis)).json()).toMatchObject({ teamId: '' });
  });

  it('weigert tickets zolang Jira niet is ingesteld', async () => {
    const { t, maak } = await met(nepJira().client);
    const p = await maak('Iets');
    expect((await t.api('POST', '/api/activiteiten/jira', { ids: [p.id] })).statusCode).toBe(409);
  });

  it('toont een voorbeeld zonder iets aan te maken, en maakt daarna het ticket één keer aan', async () => {
    const jira = nepJira();
    const { t, maak } = await met(jira.client);
    await t.api('PUT', '/api/instellingen/jira', { site: 'acme.atlassian.net', project: 'PROJ', issuetype: 'Task' });
    const p = await maak('Offerte sturen');
    const voorbeeld = (await t.api('POST', '/api/activiteiten/jira', { ids: [p.id], voorbeeld: true })).json();
    expect(voorbeeld.resultaat[0]).toMatchObject({ status: 'voorbeeld', samenvatting: 'Offerte sturen', project: 'PROJ' });
    expect(jira.gemaakt).toHaveLength(0);

    const r = (await t.api('POST', '/api/activiteiten/jira', { ids: [p.id] })).json();
    expect(r.resultaat[0]).toMatchObject({ status: 'aangemaakt', sleutel: 'PROJ-1' });
    expect(jira.gemaakt[0].link).toBe(`https://dagboek.test/onderwerp/${p.topicId}`);
    const rij = (await t.db.select().from(activiteiten).where(eq(activiteiten.id, p.id)))[0];
    expect(rij).toMatchObject({ jiraSleutel: 'PROJ-1', jiraUrl: 'https://acme.atlassian.net/browse/PROJ-1' });
    expect((await t.api('GET', '/api/activiteiten')).json()[0]).toMatchObject({ jiraSleutel: 'PROJ-1' });

    const opnieuw = (await t.api('POST', '/api/activiteiten/jira', { ids: [p.id] })).json();
    expect(opnieuw.resultaat[0]).toMatchObject({ status: 'overgeslagen', reden: 'al_in_jira' });
    expect(jira.gemaakt).toHaveLength(1);
  });

  it('slaat afgeronde punten en punten die controle nodig hebben over, tenzij bevestigd', async () => {
    const jira = nepJira();
    const { t, maak } = await met(jira.client);
    await t.api('PUT', '/api/instellingen/jira', { site: 'acme.atlassian.net', project: 'PROJ', issuetype: 'Task' });
    const klaar = await maak('Klaar'); const controle = await maak('Onzeker');
    await t.api('PATCH', `/api/activiteiten/${klaar.id}`, { status: 'afgerond' });
    await t.db.update(activiteiten).set({ controleNodig: true, controleReden: 'eigenaar_onzeker' }).where(eq(activiteiten.id, controle.id));
    const r = (await t.api('POST', '/api/activiteiten/jira', { ids: [klaar.id, controle.id] })).json();
    expect(r.resultaat.map((x: any) => x.reden)).toEqual(['afgerond', 'controle_nodig']);
    expect(jira.gemaakt).toHaveLength(0);
    const bevestigd = (await t.api('POST', '/api/activiteiten/jira', { ids: [controle.id], controleBevestigd: true })).json();
    expect(bevestigd.resultaat[0].status).toBe('aangemaakt');
  });

  it('laat een fout van Jira het punt ongemoeid en stopt bij ongeldige inloggegevens', async () => {
    const jira = nepJira({ fout: new JiraFout(401, 'Jira weigerde de inloggegevens') });
    const { t, maak } = await met(jira.client);
    await t.api('PUT', '/api/instellingen/jira', { site: 'acme.atlassian.net', project: 'PROJ', issuetype: 'Task' });
    const a = await maak('A'); const b = await maak('B');
    const r = (await t.api('POST', '/api/activiteiten/jira', { ids: [a.id, b.id] })).json();
    expect(r.resultaat).toHaveLength(1);
    expect(r.resultaat[0]).toMatchObject({ status: 'fout' });
    expect((await t.db.select().from(activiteiten).where(eq(activiteiten.id, a.id)))[0].jiraSleutel).toBeNull();
  });

  it('test de verbinding en meldt ontbrekende inloggegevens', async () => {
    const goed = await met(nepJira().client);
    expect((await goed.t.api('POST', '/api/instellingen/jira/test')).statusCode).toBe(409);
    await goed.t.api('PUT', '/api/instellingen/jira', { site: 'acme.atlassian.net', project: 'PROJ', issuetype: 'Task' });
    expect((await goed.t.api('POST', '/api/instellingen/jira/test')).json()).toMatchObject({ ok: true, naam: 'Dagboek-bot' });
    const zonder = await met(nepJira({ beschikbaar: false }).client);
    await zonder.t.api('PUT', '/api/instellingen/jira', { site: 'acme.atlassian.net', project: 'PROJ', issuetype: 'Task' });
    expect((await zonder.t.api('POST', '/api/instellingen/jira/test')).statusCode).toBe(409);
  });
});
