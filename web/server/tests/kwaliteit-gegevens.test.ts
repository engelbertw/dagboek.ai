import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { afstand, schoonTelefoon, splitsNaam, telefoonSleutel, vergelijkNamen } from '../namen.js';
import { legContactenVast } from '../debrief-gedeeld.js';
import { activiteiten, calls, consultantDebriefContacten, consultantDebriefs, employees, implementaties, klantContacten, klanten, samenverderProgrammas, samenverderSessies, topics } from '../schema.js';
import { magDoen } from '../rollen.js';
import { maakTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

describe('namen vergelijken', () => {
  it('ziet spelfouten van de spraakherkenning als dezelfde persoon', () => {
    expect(vergelijkNamen('Edwin Muntinga', 'Edwin Mentenga')).toBe('bijna');
    expect(vergelijkNamen('Edwin Muntinga', 'Edwin Munterga')).toBe('bijna');
    expect(vergelijkNamen('Edwin Muntinga', 'edwin  muntinga')).toBe('gelijk');
    expect(vergelijkNamen('Mevrouw De Boer', 'De Boer')).toBe('gelijk');
    expect(vergelijkNamen('Muntinga Edwin', 'Edwin Muntinga')).toBe('gelijk');
    expect(vergelijkNamen('E. Muntinga', 'Edwin Muntinga')).toBe('bijna');
  });
  it('houdt verschillende personen uit elkaar', () => {
    expect(vergelijkNamen('Edwin Muntinga', 'Wim Munterga')).toBeNull();
    expect(vergelijkNamen('Karin Jansen', 'Karin Pietersen')).toBeNull();
    expect(vergelijkNamen('Edwin', 'Edwin Muntinga')).toBeNull(); // één naamdeel is te weinig
    expect(vergelijkNamen('', 'Edwin Muntinga')).toBeNull();
  });
  it('rekent een omwisseling van twee letters als één bewerking', () => {
    expect(afstand('muntinga', 'mutninga')).toBe(1);
    expect(afstand('abc', 'abc')).toBe(0);
    expect(afstand('', 'abc')).toBe(3);
  });
  it('herkent telefoonnummers in verschillende schrijfwijzen als hetzelfde', () => {
    expect(telefoonSleutel('31653236242')).toBe(telefoonSleutel('06 53236242'));
    expect(telefoonSleutel('+31 6 5323 6242')).toBe(telefoonSleutel('0653236242'));
    expect(telefoonSleutel('1234')).toBeNull();
    expect(schoonTelefoon('31653236242')).toBe('+31653236242');
    expect(schoonTelefoon('06 5323 6242')).toBe('+31653236242');
    expect(schoonTelefoon('0031653236242')).toBe('+31653236242');
    expect(schoonTelefoon('onbekend')).toBe('onbekend');
  });
  it('haalt een e-mailadres en telefoonnummer uit een naamveld', () => {
    expect(splitsNaam('Edwin Muntinga emuntinga@aaenhunze.nl 31653236242')).toEqual({ naam: 'Edwin Muntinga', email: 'emuntinga@aaenhunze.nl', telefoon: '31653236242' });
    expect(splitsNaam('Edwin Muntinga')).toBeNull();
    expect(splitsNaam('Karin <karin@voorbeeld.nl>')).toMatchObject({ naam: 'Karin', email: 'karin@voorbeeld.nl', telefoon: null });
  });
});

async function opzet() {
  const t = await maakTestApp();
  open.push(t);
  const [k] = await t.db.insert(klanten).values({ naam: 'Aa en Hunze', status: 'klant' }).returning();
  const [k2] = await t.db.insert(klanten).values({ naam: 'Gemeente Elders', status: 'klant' }).returning();
  const maak = async (v: Partial<typeof klantContacten.$inferInsert> & { naam: string }, klantId = k.id) => (await t.db.insert(klantContacten).values({ klantId, ...v }).returning())[0];
  const schermafdruk = async () => ({
    a: await maak({ naam: 'Edwin Mentenga', rol: 'Gesprekspartner bij de klant tijdens de evaluatie' }),
    b: await maak({ naam: 'Edwin Muntinga', email: 'emuntinga@aaenhunze.nl', telefoon: '31653236242' }),
    c: await maak({ naam: 'Edwin Muntinga emuntinga@aaenhunze.nl 31653236242', functie: 'Informatiemanager', rol: 'beslisser' }),
    d: await maak({ naam: 'Wim Munterga', functie: 'Informatiemanager', rol: 'Gesprekspartner bij het klantbezoek' }),
  });
  const kwaliteit = async (q = '') => (await t.api('GET', `/api/kwaliteit${q}`)).json();
  return { t, k, k2, maak, schermafdruk, kwaliteit };
}

describe('kwaliteitscontrole', () => {
  it('vindt de dubbelen uit het voorbeeld en laat een andere persoon met rust', async () => {
    const o = await opzet();
    const s = await o.schermafdruk();
    const r = await o.kwaliteit('?soort=dubbel_contact');
    expect(r.bevindingen).toHaveLength(1);
    const ids = r.bevindingen[0].contacten.map((c: { id: string }) => c.id).sort();
    expect(ids).toEqual([s.a.id, s.b.id, s.c.id].sort());
    expect(r.bevindingen[0]).toMatchObject({ klantNaam: 'Aa en Hunze', ernst: 'hoog' });
    expect(r.bevindingen[0].uitleg).toMatch(/zelfde e-mailadres/);
  });

  it('stelt voor het e-mailadres en telefoonnummer uit het naamveld naar de juiste velden te verplaatsen', async () => {
    const o = await opzet();
    const s = await o.schermafdruk();
    const [b] = (await o.kwaliteit('?soort=gegevens_in_naam')).bevindingen;
    expect(b.voorstel).toEqual({ contactId: s.c.id, naam: 'Edwin Muntinga', email: 'emuntinga@aaenhunze.nl', telefoon: '+31653236242' });
    const r = await o.t.api('PATCH', `/api/klant-contacten/${s.c.id}`, { naam: b.voorstel.naam, email: b.voorstel.email, telefoon: b.voorstel.telefoon });
    expect(r.statusCode).toBe(200);
    expect((await o.kwaliteit('?soort=gegevens_in_naam')).bevindingen).toHaveLength(0);
  });

  it('merkt een afwijkende schrijfwijze, een onvolledige naam en ontbrekende functie op', async () => {
    const o = await opzet();
    await o.maak({ naam: 'Piet Jansen', telefoon: '0612345678', functie: 'Manager' });
    await o.maak({ naam: 'Klaas', functie: 'Manager' });
    await o.maak({ naam: 'Anna de Vries', email: 'geen-adres' });
    const r = await o.kwaliteit();
    const per = (soort: string) => r.bevindingen.filter((b: { soort: string }) => b.soort === soort).map((b: { contacten: { naam: string }[] }) => b.contacten[0].naam);
    expect(per('contact_formaat').sort()).toEqual(['Anna de Vries', 'Piet Jansen']);
    expect(per('naam_onvolledig')).toEqual(['Klaas']);
    expect(per('contact_onvolledig')).toContain('Anna de Vries');
    expect(r.bevindingen.find((b: { soort: string; contacten: { naam: string }[] }) => b.soort === 'contact_formaat' && b.contacten[0].naam === 'Piet Jansen').voorstel).toEqual({ contactId: expect.any(String), telefoon: '+31612345678' });
  });

  it('vindt dubbele gemeenten op naam', async () => {
    const o = await opzet();
    await o.t.db.insert(klanten).values({ naam: 'Gemeente Goes', status: 'klant' });
    await o.t.db.insert(klanten).values({ naam: 'Goes', status: 'voorgesteld' });
    const r = await o.kwaliteit('?soort=dubbele_klant');
    const groepen = r.bevindingen.map((b: { klanten: { naam: string }[] }) => b.klanten.map((x) => x.naam).sort());
    expect(groepen).toContainEqual(['Gemeente Goes', 'Goes']);
    expect(groepen).toHaveLength(1);
  });

  it('vindt open punten die op elkaar lijken en laat afgeronde en andere soorten met rust', async () => {
    const o = await opzet();
    await o.t.db.insert(activiteiten).values([
      { klantId: o.k.id, soort: 'actie', omschrijving: 'Offerte versturen naar de gemeente' },
      { klantId: o.k.id, soort: 'actie', omschrijving: 'Offerte naar de gemeente versturen' },
      { klantId: o.k.id, soort: 'intern', omschrijving: 'Offerte versturen naar de gemeente' },
      { klantId: o.k.id, soort: 'actie', omschrijving: 'Offerte versturen naar de gemeente', status: 'afgerond' },
      { klantId: o.k.id, soort: 'actie', omschrijving: 'Contract verlengen voor 2027' },
    ]);
    const r = await o.kwaliteit('?soort=dubbele_activiteit');
    expect(r.bevindingen).toHaveLength(1);
    expect(r.bevindingen[0].activiteiten).toHaveLength(2);
  });

  it('bewaart "geen probleem" en toont de melding opnieuw zodra er een contactpersoon bij komt', async () => {
    const o = await opzet();
    await o.schermafdruk();
    const [b] = (await o.kwaliteit('?soort=dubbel_contact')).bevindingen;
    expect((await o.t.api('POST', '/api/kwaliteit/besluiten', { sleutel: b.sleutel, soort: 'dubbel_contact' })).statusCode).toBe(200);
    expect((await o.kwaliteit('?soort=dubbel_contact')).bevindingen).toHaveLength(0);
    const alles = (await o.kwaliteit('?soort=dubbel_contact&besloten=1')).bevindingen;
    expect(alles).toHaveLength(1);
    expect(alles[0].besloten).toBe(true);
    await o.maak({ naam: 'Edwin Muntenga' });
    const nieuw = (await o.kwaliteit('?soort=dubbel_contact')).bevindingen;
    expect(nieuw).toHaveLength(1);
    expect(nieuw[0].sleutel).not.toBe(b.sleutel);
    expect((await o.t.api('POST', '/api/kwaliteit/besluiten/terugdraaien', { sleutel: b.sleutel })).statusCode).toBe(200);
    expect((await o.t.api('POST', '/api/kwaliteit/besluiten/terugdraaien', { sleutel: b.sleutel })).statusCode).toBe(404);
    expect((await o.t.api('POST', '/api/kwaliteit/besluiten', { sleutel: 'onzin', soort: 'dubbel_contact' })).statusCode).toBe(400);
  });

  it('filtert op gemeente en telt per soort', async () => {
    const o = await opzet();
    await o.schermafdruk();
    await o.maak({ naam: 'Klaas', functie: 'Manager' }, o.k2.id);
    expect((await o.kwaliteit(`?klantId=${o.k2.id}`)).bevindingen.map((b: { soort: string }) => b.soort)).toEqual(['naam_onvolledig']);
    const alles = await o.kwaliteit();
    expect(alles.perSoort.dubbel_contact).toBe(1);
    expect(alles.totaal).toBe(Object.values(alles.perSoort as Record<string, number>).reduce((a, b) => a + b, 0));
  });
});

describe('contactpersonen samenvoegen', () => {
  it('vult lege velden aan, overschrijft niets en verhuist alles wat aan de anderen hing', async () => {
    const o = await opzet();
    const s = await o.schermafdruk();
    const [karin] = await o.t.db.insert(employees).values({ naam: 'Karin', telefoon: '0611111111' }).returning();
    const [call] = await o.t.db.insert(calls).values({ employeeId: karin.id, status: 'gesproken', type: 'consultant_debrief' }).returning();
    const [debrief] = await o.t.db.insert(consultantDebriefs).values({ callId: call.id, employeeId: karin.id, klantId: o.k.id }).returning();
    await o.t.db.insert(consultantDebriefContacten).values([{ debriefId: debrief.id, contactId: s.a.id }, { debriefId: debrief.id, contactId: s.b.id }]);
    const [punt] = await o.t.db.insert(activiteiten).values({ klantId: o.k.id, soort: 'actie', omschrijving: 'Testlijst aanleveren', contactId: s.a.id }).returning();
    const [topic] = await o.t.db.insert(topics).values({ titel: 'Uitrol', klantId: o.k.id }).returning();
    await o.t.db.insert(implementaties).values({ topicId: topic.id, module: 'Zaken', contactpersoonId: s.a.id });
    const [prog] = await o.t.db.insert(samenverderProgrammas).values({ klantId: o.k.id, periodeVan: '2026-01-01' }).returning();
    const [sessie] = await o.t.db.insert(samenverderSessies).values({ programmaId: prog.id, datum: '2026-02-01', contactpersoonId: s.a.id }).returning();

    const r = await o.t.api('POST', '/api/klant-contacten/samenvoegen', { behoudId: s.b.id, verwijderIds: [s.a.id, s.c.id] });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ behouden: s.b.id, samengevoegd: 2 });
    expect(r.json().aangevuld.sort()).toEqual(['functie', 'rol']);
    const [b] = await o.t.db.select().from(klantContacten).where(eq(klantContacten.id, s.b.id));
    expect(b).toMatchObject({ naam: 'Edwin Muntinga', email: 'emuntinga@aaenhunze.nl', telefoon: '31653236242', functie: 'Informatiemanager' });
    expect(await o.t.db.select().from(klantContacten).where(eq(klantContacten.id, s.a.id))).toHaveLength(0);
    expect((await o.t.db.select().from(activiteiten).where(eq(activiteiten.id, punt.id)))[0].contactId).toBe(s.b.id);
    expect((await o.t.db.select().from(implementaties))[0].contactpersoonId).toBe(s.b.id);
    expect((await o.t.db.select().from(samenverderSessies).where(eq(samenverderSessies.id, sessie.id)))[0].contactpersoonId).toBe(s.b.id);
    expect((await o.t.db.select().from(consultantDebriefContacten)).map((x) => x.contactId)).toEqual([s.b.id]);
    expect((await o.kwaliteit('?soort=dubbel_contact')).bevindingen).toHaveLength(0);
  });

  it('meldt een afwijkende waarde in plaats van die te overschrijven', async () => {
    const o = await opzet();
    const a = await o.maak({ naam: 'Edwin Muntinga', email: 'a@voorbeeld.nl' });
    const b = await o.maak({ naam: 'Edwin Muntinga', email: 'b@voorbeeld.nl' });
    const r = (await o.t.api('POST', '/api/klant-contacten/samenvoegen', { behoudId: a.id, verwijderIds: [b.id] })).json();
    expect(r.conflicten).toEqual(['email: b@voorbeeld.nl']);
    expect((await o.t.db.select().from(klantContacten).where(eq(klantContacten.id, a.id)))[0].email).toBe('a@voorbeeld.nl');
  });

  it('voegt alleen samen binnen één gemeente en weigert onbekende of lege keuzes', async () => {
    const o = await opzet();
    const a = await o.maak({ naam: 'Edwin Muntinga' });
    const elders = await o.maak({ naam: 'Edwin Muntinga' }, o.k2.id);
    const post = (b: unknown) => o.t.api('POST', '/api/klant-contacten/samenvoegen', b);
    expect((await post({ behoudId: a.id, verwijderIds: [elders.id] })).statusCode).toBe(400);
    expect((await post({ behoudId: a.id, verwijderIds: [a.id] })).statusCode).toBe(400);
    expect((await post({ behoudId: a.id, verwijderIds: [] })).statusCode).toBe(400);
    expect((await post({ behoudId: a.id, verwijderIds: ['00000000-0000-4000-8000-000000000000'] })).statusCode).toBe(404);
    expect(await o.t.db.select().from(klantContacten)).toHaveLength(2);
  });
});

describe('dubbelen voorkomen', () => {
  it('waarschuwt bij een bijna gelijke contactpersoon en voegt toe na bevestiging', async () => {
    const o = await opzet();
    await o.maak({ naam: 'Edwin Muntinga', email: 'emuntinga@aaenhunze.nl' });
    const r = await o.t.api('POST', `/api/klanten/${o.k.id}/contacten`, { naam: 'Edwin Mentenga' });
    expect(r.statusCode).toBe(409);
    expect(r.json().fout).toMatch(/^Mogelijk dubbel/);
    expect(r.json().details[0]).toContain('Edwin Muntinga');
    expect(await o.t.db.select().from(klantContacten)).toHaveLength(1);
    expect((await o.t.api('POST', `/api/klanten/${o.k.id}/contacten`, { naam: 'Edwin Mentenga', bevestig: true })).statusCode).toBe(201);
    // zelfde e-mailadres met een andere naam telt ook
    expect((await o.t.api('POST', '/api/klant-contacten', { klantId: o.k.id, naam: 'Iemand Anders', email: 'EMuntinga@aaenhunze.nl' })).statusCode).toBe(409);
    // een andere gemeente heeft geen last van deze contactpersonen
    expect((await o.t.api('POST', '/api/klant-contacten', { klantId: o.k2.id, naam: 'Edwin Muntinga' })).statusCode).toBe(201);
    // een echt andere persoon wordt gewoon toegevoegd
    expect((await o.t.api('POST', `/api/klanten/${o.k.id}/contacten`, { naam: 'Wim Jansen' })).statusCode).toBe(201);
  });

  it('waarschuwt bij een gemeente die lijkt op een bestaande klant', async () => {
    const o = await opzet();
    const r = await o.t.api('POST', '/api/klanten', { naam: 'Gemeente Aa en Hunze' });
    expect(r.statusCode).toBe(409);
    expect(r.json().details).toEqual(['Aa en Hunze']);
    expect((await o.t.api('POST', '/api/klanten', { naam: 'Gemeente Aa en Hunze', bevestig: true })).statusCode).toBe(201);
    expect((await o.t.api('POST', '/api/klanten', { naam: 'Gemeente Nieuw' })).statusCode).toBe(201);
  });

  it('legt in een gesprek geen nieuwe contactpersoon vast als de naam bijna gelijk is aan een bestaande', async () => {
    const o = await opzet();
    const bestaand = await o.maak({ naam: 'Edwin Muntinga', functie: 'Informatiemanager' });
    const [m] = await o.t.db.insert(employees).values({ naam: 'Karin', telefoon: '0611111111' }).returning();
    const [call] = await o.t.db.insert(calls).values({ employeeId: m.id, status: 'gesproken', type: 'consultant_debrief' }).returning();
    const transcript = [{ role: 'user', content: 'Ik sprak Edwin Mentenga en Karin Pietersen.' }];
    const r = await legContactenVast(o.t.db, o.k.id, call.id, [{ naam: 'Edwin Mentenga', functie: '', rol: '' }, { naam: 'Karin Pietersen', functie: 'manager', rol: '' }], transcript);
    expect(r.onzeker).toEqual(['Edwin Mentenga']);
    expect(r.gekoppeld).toHaveLength(1);
    const namen = (await o.t.db.select().from(klantContacten)).map((c) => c.naam).sort();
    expect(namen).toEqual(['Edwin Muntinga', 'Karin Pietersen']);
    expect(bestaand.id).toBeTruthy();
  });
});

describe('rechten', () => {
  it('laat de accountmanager de kwaliteit beoordelen en opschonen', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    for (const [m, pad] of [['GET', '/api/kwaliteit'], ['POST', '/api/kwaliteit/besluiten'], ['POST', '/api/kwaliteit/besluiten/terugdraaien'], ['POST', '/api/klant-contacten/samenvoegen']] as const) {
      expect(magDoen('accountmanager', m, pad)).toBe(true);
    }
    expect(magDoen('accountmanager', 'DELETE', `/api/klanten/${id}`)).toBe(false);
    expect(magDoen('accountmanager', 'POST', `/api/klanten/${id}/controle`)).toBe(false); // gemeenten samenvoegen blijft bij de beheerder
    expect(magDoen('accountmanager', 'GET', '/api/gesprekken')).toBe(false);
  });
});
