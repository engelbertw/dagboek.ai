import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SERVICE_KEY, WACHTWOORD, maakTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof maakTestApp>>;
beforeAll(async () => { t = await maakTestApp(); }, 60_000);
afterAll(async () => { await t.close(); });

describe('toegang', () => {
  it('weigert api-aanroepen zonder sessie', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/topics' })).statusCode).toBe(401);
  });
  it('weigert een verkeerd wachtwoord en een vervalste sessie', async () => {
    const fout = await t.app.inject({ method: 'POST', url: '/api/login', payload: { email: 'beheer@test.nl', wachtwoord: 'fout' } });
    expect(fout.statusCode).toBe(401);
    const nep = await t.app.inject({ method: 'GET', url: '/api/topics', cookies: { dagboek_sessie: 'eyJ.x' } });
    expect(nep.statusCode).toBe(401);
  });
  it('geeft na inloggen toegang', async () => {
    expect((await t.api('GET', '/api/me')).json()).toEqual({ ingelogd: true, email: 'beheer@test.nl', naam: 'Beheerder', rol: 'beheerder', keycloak: false, noodlogin: true, gebruikersbeheer: false });
    expect((await t.app.inject({ method: 'GET', url: '/api/me' })).json()).toEqual({ ingelogd: false, keycloak: false, noodlogin: true, gebruikersbeheer: false });
    expect(WACHTWOORD.length).toBeGreaterThan(11);
  });
  it('blokkeert na 5 mislukte pogingen', async () => {
    for (let i = 0; i < 5; i++) await t.app.inject({ method: 'POST', url: '/api/login', payload: { email: 'x@y.nl', wachtwoord: 'fout' }, remoteAddress: '10.0.0.9' });
    const r = await t.app.inject({ method: 'POST', url: '/api/login', payload: { email: 'beheer@test.nl', wachtwoord: WACHTWOORD }, remoteAddress: '10.0.0.9' });
    expect(r.statusCode).toBe(429);
  });
  it('beschermt de interne callback met de servicesleutel', async () => {
    expect((await t.app.inject({ method: 'POST', url: '/api/intern/calls/00000000-0000-4000-8000-000000000000/resultaat', payload: { status: 'gesproken' } })).statusCode).toBe(401);
    const goed = await t.app.inject({ method: 'POST', url: '/api/intern/calls/00000000-0000-4000-8000-000000000000/resultaat', payload: { status: 'gesproken' }, headers: { 'x-service-key': SERVICE_KEY } });
    expect(goed.statusCode).toBe(404);
  });
});

describe('dagboek', () => {
  let medewerker: any, project: any, topic: any;

  it('maakt medewerker, project en onderwerp aan en toont ze in het overzicht', async () => {
    medewerker = (await t.api('POST', '/api/employees', { naam: 'Daan van Hooft', telefoon: '0612345678' })).json();
    project = (await t.api('POST', '/api/projects', { naam: 'MijnServices' })).json();
    topic = (await t.api('POST', '/api/topics', {
      titel: 'Offertes', type: 'thema', projectId: project.id, eigenaarId: medewerker.id, aanwijzingen: 'status van bestaande offertes',
    })).json();
    const lijst = (await t.api('GET', '/api/topics')).json();
    expect(lijst).toHaveLength(1);
    expect(lijst[0]).toMatchObject({ titel: 'Offertes', projectNaam: 'MijnServices', eigenaarNaam: 'Daan van Hooft', openPunten: 0, laatsteUpdate: null });
  });

  it('bewaart een e-mailadres en weigert een ongeldig adres', async () => {
    const m = (await t.api('POST', '/api/employees', { naam: 'Mail Test', telefoon: '0611111111', email: ' Mail.Test@Voorbeeld.NL ' })).json();
    expect(m.email).toBe('mail.test@voorbeeld.nl');
    expect((await t.api('PATCH', `/api/employees/${m.id}`, { email: 'geen-adres' })).statusCode).toBe(400);
    expect((await t.api('PATCH', `/api/employees/${m.id}`, { email: '' })).json().email).toBe('');
    await t.api('DELETE', `/api/employees/${m.id}`);
  });

  it('bewaart een LOCGOV-gebruikersnaam en weigert een e-mailadres of spaties daarin', async () => {
    const m = (await t.api('POST', '/api/employees', { naam: 'Locgov Test', telefoon: '0622222222', locgovGebruikersnaam: ' WIJNHO00 ' })).json();
    expect(m.locgovGebruikersnaam).toBe('wijnho00');
    expect((await t.api('PATCH', `/api/employees/${m.id}`, { locgovGebruikersnaam: 'wijnho00@locgov.nl' })).statusCode).toBe(400);
    expect((await t.api('PATCH', `/api/employees/${m.id}`, { locgovGebruikersnaam: 'twee woorden' })).statusCode).toBe(400);
    await t.api('DELETE', `/api/employees/${m.id}`);
  });

  it('laat bij een deelwijziging de overige velden ongemoeid', async () => {
    const m = (await t.api('POST', '/api/employees', {
      naam: 'Deel Test', telefoon: '0633333333', email: 'deel@test.nl', locgovGebruikersnaam: 'deel00', taal: 'en', actief: false, notitie: 'Niet voor 10 uur bellen',
    })).json();
    const na = (await t.api('PATCH', `/api/employees/${m.id}`, { toestemming: true })).json();
    expect(na).toMatchObject({ email: 'deel@test.nl', locgovGebruikersnaam: 'deel00', taal: 'en', actief: false, notitie: 'Niet voor 10 uur bellen' });
    expect(na.toestemmingOp).not.toBeNull();

    const p = (await t.api('POST', '/api/projects', { naam: 'Deelproject', omschrijving: 'Uitleg', status: 'afgerond' })).json();
    expect((await t.api('PATCH', `/api/projects/${p.id}`, { naam: 'Deelproject 2' })).json()).toMatchObject({ omschrijving: 'Uitleg', status: 'afgerond' });

    const o = (await t.api('POST', '/api/topics', { titel: 'Deelonderwerp', type: 'taak', status: 'wacht', projectId: p.id, eigenaarId: m.id, aanwijzingen: 'let op' })).json();
    expect((await t.api('PATCH', `/api/topics/${o.id}`, { titel: 'Deelonderwerp 2' })).json()).toMatchObject({ type: 'taak', status: 'wacht', projectId: p.id, eigenaarId: m.id, aanwijzingen: 'let op' });

    const sch = (await t.api('POST', '/api/plannings', { naam: 'Ochtend', dagen: [1], tijden: ['09:00'], actief: false, maxPogingen: 4, employeeIds: [m.id] })).json();
    expect((await t.api('PATCH', `/api/plannings/${sch.id}`, { tijden: ['10:00'] })).json()).toMatchObject({ naam: 'Ochtend', actief: false, maxPogingen: 4, employeeIds: [m.id] });
    await t.api('DELETE', `/api/employees/${m.id}`);
    await t.api('DELETE', `/api/projects/${p.id}`);
  });

  it('weigert ongeldige invoer en onbekende id’s', async () => {
    expect((await t.api('POST', '/api/topics', { titel: '' })).statusCode).toBe(400);
    expect((await t.api('POST', '/api/employees', { naam: 'X' })).statusCode).toBe(400);
    expect((await t.api('GET', '/api/topics/niet-een-uuid')).statusCode).toBe(400);
    expect((await t.api('GET', '/api/topics/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
  });

  it('legt updates vast en bewaart de historie bij bewerken', async () => {
    const u = (await t.api('POST', `/api/topics/${topic.id}/updates`, { samenvatting: 'Offerte verstuurd', besluiten: '' })).json();
    expect(u.bron).toBe('handmatig');
    await t.api('PATCH', `/api/updates/${u.id}`, { samenvatting: 'Offerte verstuurd en akkoord', besluiten: 'Start in november' });
    await t.api('PATCH', `/api/updates/${u.id}`, { samenvatting: 'Offerte verstuurd en akkoord', besluiten: 'Start in november' }); // geen wijziging
    const historie = (await t.api('GET', `/api/updates/${u.id}/historie`)).json();
    expect(historie).toHaveLength(1);
    expect(historie[0].vorigeSamenvatting).toBe('Offerte verstuurd');
    const detail = (await t.api('GET', `/api/topics/${topic.id}`)).json();
    expect(detail.updates[0]).toMatchObject({ samenvatting: 'Offerte verstuurd en akkoord' });
    expect(detail.updates[0].bewerktOp).toBeTruthy();
  });

  it('beheert open punten en telt ze in het overzicht', async () => {
    const p = (await t.api('POST', `/api/topics/${topic.id}/open-items`, { tekst: 'Akkoord klant' })).json();
    await t.api('POST', `/api/topics/${topic.id}/open-items`, { tekst: 'Intern overleg' });
    expect((await t.api('GET', '/api/topics')).json()[0].openPunten).toBe(2);
    const klaar = (await t.api('PATCH', `/api/open-items/${p.id}`, { status: 'afgerond' })).json();
    expect(klaar.afgerondOp).toBeTruthy();
    expect((await t.api('GET', '/api/topics')).json()[0].openPunten).toBe(1);
  });

  it('rondt een onderwerp af en filtert op status', async () => {
    const r = (await t.api('PATCH', `/api/topics/${topic.id}`, { status: 'afgerond' })).json();
    expect(r.afgerondOp).toBeTruthy();
    expect((await t.api('GET', '/api/topics?status=actief')).json()).toHaveLength(0);
    expect((await t.api('GET', '/api/topics?status=afgerond')).json()).toHaveLength(1);
    await t.api('PATCH', `/api/topics/${topic.id}`, { status: 'actief' });
    expect((await t.api('GET', `/api/topics/${topic.id}`)).json().afgerondOp).toBeNull();
  });

  it('beheert planningen met geldige tijden en ontdubbelt ze', async () => {
    expect((await t.api('POST', '/api/plannings', { dagen: [1, 3], tijden: ['25:00'], employeeIds: [medewerker.id] })).statusCode).toBe(400);
    expect((await t.api('POST', '/api/plannings', { dagen: [1, 3], tijden: [], employeeIds: [medewerker.id] })).statusCode).toBe(400);
    expect((await t.api('POST', '/api/plannings', { dagen: [1], tijden: ['09:00'], employeeIds: [] })).statusCode).toBe(400);
    expect((await t.api('POST', '/api/plannings', { dagen: [1], tijden: ['09:00'], employeeIds: ['00000000-0000-4000-8000-000000000000'] })).statusCode).toBe(400);
    const s = (await t.api('POST', '/api/plannings', { dagen: [3, 1, 1], tijden: ['16:00', '09:30', '09:30'], employeeIds: [medewerker.id, medewerker.id] })).json();
    expect(s).toMatchObject({ dagen: [1, 3], tijden: ['09:30', '16:00'], maxPogingen: 2, employeeIds: [medewerker.id] });
    expect((await t.api('DELETE', `/api/plannings/${s.id}`)).statusCode).toBe(200);
  });
});

describe('bellen', () => {
  it('stuurt de opdracht met laatste update en open punten naar de voice-service', async () => {
    const m = (await t.api('POST', '/api/employees', { naam: 'Jarich', telefoon: '0687654321' })).json();
    const tp = (await t.api('POST', '/api/topics', { titel: 'Architectuur Common Ground', eigenaarId: m.id, aanwijzingen: 'keuzes en afhankelijkheden' })).json();
    await t.api('POST', `/api/topics/${tp.id}/updates`, { samenvatting: 'Referentie-architectuur besproken' });
    await t.api('POST', `/api/topics/${tp.id}/open-items`, { tekst: 'Besluit over API-gateway' });
    await t.api('POST', '/api/topics', { titel: 'Afgerond ding', eigenaarId: m.id, status: 'afgerond' });

    const r = await t.api('POST', `/api/employees/${m.id}/bel`);
    expect(r.statusCode).toBe(202);
    const opdracht = t.opdrachten.at(-1)!;
    expect(opdracht).toMatchObject({ telefoonnummer: '0687654321', medewerker: 'Jarich', toestemming_nodig: true });
    expect(opdracht.onderwerpen).toHaveLength(1);
    expect(opdracht.onderwerpen[0]).toMatchObject({
      titel: 'Architectuur Common Ground', laatste_update: 'Referentie-architectuur besproken', open_punten: ['Besluit over API-gateway'],
    });
    const call = (await t.api('GET', `/api/calls/${r.json().callId}`)).json();
    expect(call).toMatchObject({ status: 'belt', voiceCallId: 'voice-123' });

    await t.api('PATCH', `/api/employees/${m.id}`, { toestemming: true });
    await t.api('POST', `/api/employees/${m.id}/bel`);
    expect(t.opdrachten.at(-1)!.toestemming_nodig).toBe(false);
  });

  it('verwerkt de uitkomst van de voice-service en houdt een eindstatus vast', async () => {
    const m = (await t.api('POST', '/api/employees', { naam: 'Piet', telefoon: '0611111111' })).json();
    const { callId } = (await t.api('POST', `/api/employees/${m.id}/bel`)).json();
    const meld = (payload: object) => t.app.inject({ method: 'POST', url: `/api/intern/calls/${callId}/resultaat`, payload, headers: { 'x-service-key': SERVICE_KEY } });
    await meld({ status: 'gesprek' });
    await meld({ status: 'gesproken', transcript: [{ role: 'assistant', content: 'Hoi' }] });
    expect((await meld({ status: 'niet_bereikt' })).json().genegeerd).toBe(true);
    const call = (await t.api('GET', `/api/calls/${callId}`)).json();
    expect(call.status).toBe('gesproken');
    expect(call.transcript).toEqual([{ role: 'assistant', content: 'Hoi' }]);
    expect(call.afgerondOp).toBeTruthy();
  });

  it('weigert te bellen als de medewerker inactief is en meldt een voicefout', async () => {
    const m = (await t.api('POST', '/api/employees', { naam: 'Inactief', telefoon: '0622222222', actief: false })).json();
    expect((await t.api('POST', `/api/employees/${m.id}/bel`)).statusCode).toBe(409);
  });
});

describe('mislukt bellen', () => {
  it('zet het gesprek op mislukt als de voice-service weigert', async () => {
    const x = await maakTestApp({ gebeld: false, reden: 'uurlimiet voor uitgaande gesprekken bereikt' });
    const m = (await x.api('POST', '/api/employees', { naam: 'Kees', telefoon: '0633333333' })).json();
    const r = await x.api('POST', `/api/employees/${m.id}/bel`);
    expect(r.statusCode).toBe(502);
    expect((await x.api('GET', `/api/calls/${r.json().callId}`)).json()).toMatchObject({ status: 'mislukt', fout: 'uurlimiet voor uitgaande gesprekken bereikt' });
    await x.close();
  }, 60_000);
});
