import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { activiteiten, calls, consultantDebriefs, employees, klantContacten, klanten, samenverderSessies, topics } from '../schema.js';
import { magDoen } from '../rollen.js';
import { maakTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

const over = (dagen: number) => new Date(Date.now() + dagen * 86_400_000).toISOString().slice(0, 10);

async function opzet() {
  const t = await maakTestApp();
  open.push(t);
  const [a] = await t.db.insert(klanten).values({ naam: 'Gemeente A', status: 'klant' }).returning();
  const [b] = await t.db.insert(klanten).values({ naam: 'Gemeente B', status: 'klant' }).returning();
  const [contactA] = await t.db.insert(klantContacten).values({ klantId: a.id, naam: 'Piet' }).returning();
  const [contactB] = await t.db.insert(klantContacten).values({ klantId: b.id, naam: 'Kees' }).returning();
  const [karin] = await t.db.insert(employees).values({ naam: 'Karin', telefoon: '0611111111', consultant: true }).returning();
  const [inactief] = await t.db.insert(employees).values({ naam: 'Oud', telefoon: '0622222222', actief: false }).returning();
  const [topicA] = await t.db.insert(topics).values({ titel: 'Zaakgericht', klantId: a.id }).returning();
  const [topicB] = await t.db.insert(topics).values({ titel: 'Elders', klantId: b.id }).returning();
  const programma = async (klantId = a.id, extra: Record<string, unknown> = {}) =>
    (await t.api('POST', '/api/samenverder/programmas', { klantId, pakket: 'SamenVerder 2026', periodeVan: '2026-01-01', ...extra })).json();
  const sessie = async (programmaId: string, extra: Record<string, unknown> = {}) =>
    (await t.api('POST', `/api/samenverder/programmas/${programmaId}/sessies`, { datum: over(7), ...extra })).json();
  return { t, a, b, contactA, contactB, karin, inactief, topicA, topicB, programma, sessie };
}

describe('programma’s', () => {
  it('maakt een programma per gemeente en periode, ook voor eerdere jaren', async () => {
    const o = await opzet();
    const p = await o.programma();
    expect(p).toMatchObject({ klantId: o.a.id, pakket: 'SamenVerder 2026', periodeVan: '2026-01-01', periodeTot: null, status: 'actief', bron: 'handmatig' });
    await o.programma(o.a.id, { periodeVan: '2025-01-01', periodeTot: '2025-12-31', status: 'afgerond' });
    const lijst = (await o.t.api('GET', `/api/samenverder/programmas?klantId=${o.a.id}`)).json();
    expect(lijst.map((x: { periodeVan: string }) => x.periodeVan)).toEqual(['2026-01-01', '2025-01-01']);
    expect((await o.t.api('GET', '/api/samenverder/programmas?status=afgerond')).json()).toHaveLength(1);
  });

  it('weigert ongeldige invoer', async () => {
    const o = await opzet();
    const post = (b: unknown) => o.t.api('POST', '/api/samenverder/programmas', b);
    expect((await post({ klantId: o.a.id, periodeVan: '2026-02-31' })).statusCode).toBe(400);
    expect((await post({ klantId: o.a.id, periodeVan: '2026-06-01', periodeTot: '2026-01-01' })).statusCode).toBe(400);
    expect((await post({ klantId: '00000000-0000-4000-8000-000000000000', periodeVan: '2026-01-01' })).statusCode).toBe(400);
    expect((await post({ periodeVan: '2026-01-01' })).statusCode).toBe(400);
    const p = await o.programma();
    expect((await o.t.api('PATCH', `/api/samenverder/programmas/${p.id}`, { periodeTot: '2025-01-01' })).statusCode).toBe(400);
    expect((await o.t.api('PATCH', `/api/samenverder/programmas/${p.id}`, { klantId: o.b.id })).json().klantId).toBe(o.a.id); // de gemeente is niet te wijzigen
    expect((await o.t.api('GET', '/api/samenverder/programmas/geen-uuid')).statusCode).toBe(404);
  });

  it('zet de gemeente niet kwijt door haar te verwijderen zolang er een programma is', async () => {
    const o = await opzet();
    await o.programma();
    await expect(o.t.db.delete(klanten).where(eq(klanten.id, o.a.id))).rejects.toThrow();
  });

  it('telt per programma wat gepland en uitgevoerd is en toont de volgende sessie', async () => {
    const o = await opzet();
    const p = await o.programma();
    const s1 = await o.sessie(p.id, { datum: over(5) });
    await o.sessie(p.id, { datum: over(20) });
    const s3 = await o.sessie(p.id, { datum: over(-3) });
    await o.t.api('POST', `/api/samenverder/sessies/${s3.id}/uitgevoerd`, {});
    await o.t.api('POST', `/api/samenverder/sessies/${s1.id}/annuleer`, {});
    const [rij] = (await o.t.api('GET', '/api/samenverder/programmas')).json();
    expect(rij).toMatchObject({ klantNaam: 'Gemeente A', aantalGepland: 1, aantalUitgevoerd: 1, aantalSessies: 2, volgendeSessie: over(20), laatsteSessie: over(-3) });
  });

  it('verwijdert een programma met sessies, behalve als er uitgevoerde sessies zijn', async () => {
    const o = await opzet();
    const p = await o.programma();
    const s = await o.sessie(p.id);
    expect((await o.t.api('DELETE', `/api/samenverder/programmas/${p.id}`)).statusCode).toBe(200);
    expect(await o.t.db.select().from(samenverderSessies)).toHaveLength(0);
    const q = await o.programma();
    const u = await o.sessie(q.id);
    await o.t.api('POST', `/api/samenverder/sessies/${u.id}/uitgevoerd`, {});
    expect((await o.t.api('DELETE', `/api/samenverder/programmas/${q.id}`)).statusCode).toBe(409);
    expect(s.id).toBeTruthy();
  });
});

describe('gedeeltelijke wijzigingen', () => {
  it('laat velden die niet worden meegestuurd ongemoeid', async () => {
    const o = await opzet();
    const p = await o.programma(o.a.id, { periodeTot: '2026-12-31', opmerking: 'Belangrijk', status: 'actief' });
    const r = (await o.t.api('PATCH', `/api/samenverder/programmas/${p.id}`, { pakket: 'Ander pakket' })).json();
    expect(r).toMatchObject({ pakket: 'Ander pakket', periodeTot: '2026-12-31', opmerking: 'Belangrijk', periodeVan: '2026-01-01' });
    const s = await o.sessie(p.id, { onderwerp: 'Thema', doel: 'Doel', omvangDagen: 0.5, extra: true, soort: 'online', dagnummer: 3, consultantIds: [o.karin.id], contactpersoonId: o.contactA.id });
    const w = (await o.t.api('PATCH', `/api/samenverder/sessies/${s.id}`, { onderwerp: 'Nieuw' })).json();
    expect(w).toMatchObject({ onderwerp: 'Nieuw', doel: 'Doel', omvangDagen: 0.5, extra: true, soort: 'online', dagnummer: 3, contactpersoonId: o.contactA.id, datum: s.datum });
    expect((await o.t.api('GET', `/api/samenverder/programmas/${p.id}`)).json().sessies[0].consultants).toHaveLength(1);
    const ond = (await o.t.api('POST', `/api/samenverder/sessies/${s.id}/onderwerpen`, { titel: 'A', status: 'voorgesteld', topicId: o.topicA.id })).json();
    const o2 = (await o.t.api('PATCH', `/api/samenverder/onderwerpen/${ond.id}`, { titel: 'B' })).json();
    expect(o2).toMatchObject({ titel: 'B', status: 'voorgesteld', topicId: o.topicA.id });
  });
});

describe('sessies', () => {
  it('plant een sessie met datum, omvang, consultants en contactpersoon van dezelfde gemeente', async () => {
    const o = await opzet();
    const p = await o.programma();
    const s = await o.sessie(p.id, { soort: 'kickstart', dagnummer: 1, omvangDagen: 0.5, consultantIds: [o.karin.id], contactpersoonId: o.contactA.id, onderwerp: 'Start', extra: true });
    expect(s).toMatchObject({ soort: 'kickstart', dagnummer: 1, omvangDagen: 0.5, status: 'gepland', extra: true, bevestigdOp: null });
    const d = (await o.t.api('GET', `/api/samenverder/programmas/${p.id}`)).json();
    expect(d.klant).toEqual({ id: o.a.id, naam: 'Gemeente A' });
    expect(d.sessies[0]).toMatchObject({ omvangDagen: 0.5, contactpersoonNaam: 'Piet', consultants: [{ id: o.karin.id, naam: 'Karin' }] });
  });

  it('weigert een sessie zonder datum, met onmogelijke omvang of met koppelingen buiten de gemeente', async () => {
    const o = await opzet();
    const p = await o.programma();
    const post = (b: unknown) => o.t.api('POST', `/api/samenverder/programmas/${p.id}/sessies`, b);
    expect((await post({})).statusCode).toBe(400);
    for (const omvang of [0, -1, 21, 0.001]) expect((await post({ datum: over(3), omvangDagen: omvang })).statusCode).toBe(400);
    expect((await post({ datum: over(3), contactpersoonId: o.contactB.id })).statusCode).toBe(400);
    expect((await post({ datum: over(3), consultantIds: [o.inactief.id] })).statusCode).toBe(400);
    expect((await post({ datum: over(3), soort: 'feest' })).statusCode).toBe(400);
    expect((await o.t.api('POST', '/api/samenverder/programmas/00000000-0000-4000-8000-000000000000/sessies', { datum: over(3) })).statusCode).toBe(404);
    expect(await o.t.db.select().from(samenverderSessies)).toHaveLength(0);
  });

  it('wijzigt een sessie maar haalt de datum niet weg bij een geplande sessie', async () => {
    const o = await opzet();
    const p = await o.programma();
    const s = await o.sessie(p.id, { consultantIds: [o.karin.id] });
    expect((await o.t.api('PATCH', `/api/samenverder/sessies/${s.id}`, { datum: null })).statusCode).toBe(400);
    const r = await o.t.api('PATCH', `/api/samenverder/sessies/${s.id}`, { omvangDagen: 2, onderwerp: 'Nieuw', consultantIds: [] });
    expect(r.json()).toMatchObject({ omvangDagen: 2, onderwerp: 'Nieuw' });
    expect((await o.t.api('GET', `/api/samenverder/programmas/${p.id}`)).json().sessies[0].consultants).toEqual([]);
  });

  it('laat alleen een beheerder een sessie op uitgevoerd zetten, één keer, met bevestiging', async () => {
    const o = await opzet();
    const p = await o.programma();
    const s = await o.sessie(p.id);
    const r = await o.t.api('POST', `/api/samenverder/sessies/${s.id}/uitgevoerd`, {});
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'uitgevoerd' });
    expect(r.json().bevestigdDoor).toBeTruthy();
    expect(r.json().bevestigdOp).toBeTruthy();
    expect((await o.t.api('POST', `/api/samenverder/sessies/${s.id}/uitgevoerd`, {})).statusCode).toBe(409);
    expect((await o.t.api('POST', `/api/samenverder/sessies/${s.id}/annuleer`, {})).statusCode).toBe(409);
    expect((await o.t.api('DELETE', `/api/samenverder/sessies/${s.id}`)).statusCode).toBe(409);
  });

  it('annuleert en plant weer in, en vraagt dan een datum', async () => {
    const o = await opzet();
    const p = await o.programma();
    const s = await o.sessie(p.id);
    expect((await o.t.api('POST', `/api/samenverder/sessies/${s.id}/annuleer`, {})).json().status).toBe('geannuleerd');
    const nieuweDatum = over(30);
    const r = await o.t.api('POST', `/api/samenverder/sessies/${s.id}/heropen`, { datum: nieuweDatum });
    expect(r.json()).toMatchObject({ status: 'gepland', datum: nieuweDatum, bevestigdOp: null });
    await o.t.api('POST', `/api/samenverder/sessies/${s.id}/uitgevoerd`, {});
    const terug = await o.t.api('POST', `/api/samenverder/sessies/${s.id}/heropen`, {});
    expect(terug.json()).toMatchObject({ status: 'gepland', bevestigdOp: null, bevestigdDoor: null });
  });

  it('verplaatst een sessie naar een nieuwe sessie die telt, en laat de oude als verplaatst staan', async () => {
    const o = await opzet();
    const p = await o.programma();
    const s = await o.sessie(p.id, { consultantIds: [o.karin.id], omvangDagen: 0.5, onderwerp: 'Thema' });
    await o.t.api('POST', `/api/samenverder/sessies/${s.id}/onderwerpen`, { titel: 'Zaaktypen' });
    const afgehandeld = (await o.t.api('POST', `/api/samenverder/sessies/${s.id}/onderwerpen`, { titel: 'Klaar', status: 'afgehandeld' })).json();
    const nieuweDatum = over(40);
    const r = await o.t.api('POST', `/api/samenverder/sessies/${s.id}/verplaats`, { datum: nieuweDatum });
    expect(r.statusCode).toBe(201);
    const n = r.json();
    expect(n).toMatchObject({ datum: nieuweDatum, status: 'gepland', omvangDagen: 0.5, onderwerp: 'Thema' });
    const d = (await o.t.api('GET', `/api/samenverder/programmas/${p.id}`)).json();
    const oud = d.sessies.find((x: { id: string }) => x.id === s.id);
    const nw = d.sessies.find((x: { id: string }) => x.id === n.id);
    expect(oud).toMatchObject({ status: 'verplaatst', verplaatstNaarId: n.id });
    expect(nw.consultants.map((c: { naam: string }) => c.naam)).toEqual(['Karin']);
    expect(nw.onderwerpen.map((x: { titel: string }) => x.titel)).toEqual(['Zaaktypen']); // afgehandeld gaat niet mee
    expect(afgehandeld.id).toBeTruthy();
    const [rij] = (await o.t.api('GET', '/api/samenverder/programmas')).json();
    expect(rij).toMatchObject({ aantalGepland: 1, aantalSessies: 1 });
    expect((await o.t.api('PATCH', `/api/samenverder/sessies/${s.id}`, { onderwerp: 'x' })).statusCode).toBe(409);
    expect((await o.t.api('DELETE', `/api/samenverder/sessies/${n.id}`)).statusCode).toBe(409); // de verplaatste sessie wijst ernaar
    expect((await o.t.api('POST', `/api/samenverder/sessies/${s.id}/verplaats`, { datum: over(50) })).statusCode).toBe(409);
  });

  it('verwerkt twee gelijktijdige statuswijzigingen maar één keer', async () => {
    const o = await opzet();
    const p = await o.programma();
    const s = await o.sessie(p.id);
    const r = await Promise.all([
      o.t.api('POST', `/api/samenverder/sessies/${s.id}/uitgevoerd`, {}),
      o.t.api('POST', `/api/samenverder/sessies/${s.id}/uitgevoerd`, {}),
      o.t.api('POST', `/api/samenverder/sessies/${s.id}/annuleer`, {}),
    ]);
    expect(r.filter((x) => x.statusCode === 200)).toHaveLength(1);
  });
});

describe('onderwerpen en wat er is vastgelegd', () => {
  it('koppelt alleen onderwerpen van dezelfde gemeente en voorstellen uit hetzelfde programma', async () => {
    const o = await opzet();
    const p = await o.programma();
    const q = await o.programma(o.a.id, { periodeVan: '2025-01-01' });
    const s = await o.sessie(p.id);
    const anders = await o.sessie(q.id);
    const post = (b: unknown) => o.t.api('POST', `/api/samenverder/sessies/${s.id}/onderwerpen`, b);
    expect((await post({ titel: 'Zaakgericht', topicId: o.topicA.id })).statusCode).toBe(201);
    expect((await post({ titel: 'Elders', topicId: o.topicB.id })).statusCode).toBe(400);
    expect((await post({ titel: 'X', voorgesteldInSessieId: anders.id })).statusCode).toBe(400);
    expect((await post({ titel: '  ' })).statusCode).toBe(400);
    const lijst = (await o.t.api('GET', `/api/samenverder/programmas/${p.id}`)).json().sessies[0].onderwerpen;
    const [ond] = lijst;
    expect((await o.t.api('PATCH', `/api/samenverder/onderwerpen/${ond.id}`, { status: 'afgehandeld' })).json().status).toBe('afgehandeld');
    expect((await o.t.api('DELETE', `/api/samenverder/onderwerpen/${ond.id}`)).statusCode).toBe(200);
    expect((await o.t.api('DELETE', `/api/samenverder/onderwerpen/${ond.id}`)).statusCode).toBe(404);
  });

  it('toont per sessie de debriefs en punten die eraan hangen, maar niet wat gecontroleerd moet worden', async () => {
    const o = await opzet();
    const p = await o.programma();
    const s = await o.sessie(p.id);
    const [call] = await o.t.db.insert(calls).values({ employeeId: o.karin.id, status: 'gesproken', type: 'consultant_debrief' }).returning();
    await o.t.db.insert(consultantDebriefs).values({ callId: call.id, employeeId: o.karin.id, variant: 'samenverder', klantId: o.a.id, programmaId: p.id, sessieId: s.id, samenvatting: 'Mooie dag.' });
    await o.t.db.insert(activiteiten).values([
      { klantId: o.a.id, soort: 'besluit', omschrijving: 'Start in januari', samenverderProgrammaId: p.id, samenverderSessieId: s.id },
      { klantId: o.a.id, soort: 'actie', omschrijving: 'Onbevestigd', controleNodig: true, samenverderProgrammaId: p.id, samenverderSessieId: s.id },
    ]);
    const sessie = (await o.t.api('GET', `/api/samenverder/programmas/${p.id}`)).json().sessies[0];
    expect(sessie.debriefs).toEqual([expect.objectContaining({ samenvatting: 'Mooie dag.', door: 'Karin' })]);
    expect(sessie.activiteiten.map((a: { omschrijving: string }) => a.omschrijving)).toEqual(['Start in januari']);
  });

  it('staat in de bezoekvoorbereiding van de gemeente', async () => {
    const o = await opzet();
    const p = await o.programma();
    await o.sessie(p.id, { datum: over(10) });
    const v = (await o.t.api('GET', `/api/klanten/${o.a.id}/voorbereiding`)).json();
    expect(v.samenverder).toEqual([expect.objectContaining({ id: p.id, pakket: 'SamenVerder 2026', aantalGepland: 1, aantalUitgevoerd: 0, volgendeSessie: over(10), laatsteSamenvatting: null, bron: 'werkregister' })]);
    expect((await o.t.api('GET', `/api/klanten/${o.b.id}/voorbereiding`)).json().samenverder).toEqual([]);
  });
});

describe('rechten', () => {
  it('laat een accountmanager SamenVerder lezen maar niet wijzigen', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(magDoen('accountmanager', 'GET', '/api/samenverder/programmas')).toBe(true);
    expect(magDoen('accountmanager', 'GET', `/api/samenverder/programmas/${id}`)).toBe(true);
    for (const [m, pad] of [['POST', '/api/samenverder/programmas'], ['PATCH', `/api/samenverder/programmas/${id}`], ['DELETE', `/api/samenverder/programmas/${id}`],
      ['POST', `/api/samenverder/programmas/${id}/sessies`], ['PATCH', `/api/samenverder/sessies/${id}`], ['POST', `/api/samenverder/sessies/${id}/uitgevoerd`],
      ['POST', `/api/samenverder/sessies/${id}/onderwerpen`], ['DELETE', `/api/samenverder/onderwerpen/${id}`]] as const) expect(magDoen('accountmanager', m, pad)).toBe(false);
    expect(magDoen('beheerder', 'POST', `/api/samenverder/sessies/${id}/uitgevoerd`)).toBe(true);
  });
});
