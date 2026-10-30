import { afterEach, describe, expect, it } from 'vitest';
import { employees, klantContacten, klanten } from '../schema.js';
import { beoordeelLijst, leesLijst } from '../medewerkers-import.js';
import { beoordeelKlantenLijst } from '../klanten-import.js';
import { maakTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

const LIJST = `
Piet Voorbeeld    +31 6 12345601    voorbeeld00@locgov.nl
Klara Testpersoon\t+31 6 12345602\ttest00@locgov.nl

Sam Proef +31 6 12345603 sam.proef@locgov.nl
`;

describe('medewerkers importeren uit een lijst', () => {
  it('leest naam, nummer en e-mail in elke volgorde', () => {
    expect(leesLijst('voorbeeld00@locgov.nl 06-12345601 Piet Voorbeeld')).toEqual([{ naam: 'Piet Voorbeeld', telefoon: '06-12345601', email: 'voorbeeld00@locgov.nl' }]);
    expect(leesLijst(LIJST)).toHaveLength(3);
  });

  it('markeert ongeldige, bestaande en dubbele regels en laat de LOCGOV-naam uit het adres komen', () => {
    const r = beoordeelLijst(`${LIJST}\nZonder Nummer zonder@locgov.nl\n+31612345601 Dubbel Nummer\nKlara Testpersoon +31 6 12345699`, [{ naam: 'Bestaand', telefoon: '0612345603' }]);
    expect(r.map((x) => x.status)).toEqual(['nieuw', 'nieuw', 'bestaat_al', 'ongeldig', 'dubbel_in_lijst', 'dubbel_in_lijst']);
    expect(r[0]).toMatchObject({ naam: 'Piet Voorbeeld', telefoon: '+31612345601', locgovGebruikersnaam: 'voorbeeld00' });
    expect(r[2].reden).toContain('nummer');
  });

  it('toont een voorbeeld zonder iets te wijzigen en voegt daarna alleen de nieuwe regels toe met de gekozen rol', async () => {
    const t = await maakTestApp(); open.push(t);
    const voorbeeld = (await t.api('POST', '/api/employees/import', { tekst: LIJST, rol: 'accountmanager', voorbeeld: true })).json();
    expect(voorbeeld.toegevoegd).toBe(0);
    expect(await t.db.select().from(employees)).toHaveLength(0);

    const r = (await t.api('POST', '/api/employees/import', { tekst: LIJST, rol: 'accountmanager' })).json();
    expect(r.toegevoegd).toBe(3);
    const rijen = await t.db.select().from(employees);
    expect(rijen).toHaveLength(3);
    expect(rijen.every((m) => m.rol === 'accountmanager' && m.actief && !m.toestemmingOp)).toBe(true);
    expect(rijen.find((m) => m.naam === 'Sam Proef')).toMatchObject({ telefoon: '+31612345603', email: 'sam.proef@locgov.nl', locgovGebruikersnaam: 'sam.proef' });

    // Een tweede keer plakken voegt niets toe.
    expect((await t.api('POST', '/api/employees/import', { tekst: LIJST, rol: 'medewerker' })).json().toegevoegd).toBe(0);
    expect(await t.db.select().from(employees)).toHaveLength(3);
    expect((await t.api('POST', '/api/employees/import', { tekst: LIJST, rol: 'baas' })).statusCode).toBe(400);
  });
});

const GEMEENTEN = `Gemeente\tContactpersoon\tFunctie\tRol
Gemeente Voorbeeld;Jan Jansen;Teamleider ICT;Beslisser
;Piet Pieters;Inkoper;Adviseur
Gemeente Andersom | Karin Klaas | Manager | Beslisser
Gemeente Alleen
;;;
`;

describe('gemeenten met contactpersonen importeren', () => {
  it('groepeert per gemeente, neemt een lege eerste kolom over en slaat de kopregel over', () => {
    const r = beoordeelKlantenLijst(GEMEENTEN, [], []);
    expect(r.fouten).toEqual([]);
    expect(r.gemeenten.map((g) => [g.naam, g.contacten.length])).toEqual([['Gemeente Voorbeeld', 2], ['Gemeente Andersom', 1], ['Gemeente Alleen', 0]]);
    expect(r.gemeenten[0].contacten[0]).toEqual({ naam: 'Jan Jansen', functie: 'Teamleider ICT', rol: 'Beslisser', email: '', telefoon: '', status: 'nieuw' });
  });

  it('meldt een regel zonder gemeente en herkent bestaande gemeenten en contactpersonen', () => {
    expect(beoordeelKlantenLijst(';Jan;ICT;Beslisser', [], []).fouten[0]).toContain('Regel 1');
    const r = beoordeelKlantenLijst('gemeente voorbeeld;JAN JANSEN;x;y\ngemeente voorbeeld;Nieuw Persoon;;', [{ id: 'k1', naam: 'Gemeente Voorbeeld' }], [{ klantId: 'k1', naam: 'Jan Jansen' }]);
    expect(r.gemeenten[0]).toMatchObject({ status: 'bestaat_al', klantId: 'k1' });
    expect(r.gemeenten[0].contacten.map((c) => c.status)).toEqual(['bestaat_al', 'nieuw']);
  });

  it('toont een voorbeeld en voegt daarna gemeenten en contactpersonen toe zonder dubbelen', async () => {
    const t = await maakTestApp(); open.push(t);
    const voorbeeld = (await t.api('POST', '/api/klanten/import', { tekst: GEMEENTEN, voorbeeld: true })).json();
    expect(voorbeeld.toegevoegd).toEqual({ gemeenten: 0, contacten: 0, bijgewerkt: 0 });
    expect(await t.db.select().from(klanten)).toHaveLength(0);

    const r = (await t.api('POST', '/api/klanten/import', { tekst: GEMEENTEN, status: 'prospect' })).json();
    expect(r.toegevoegd).toEqual({ gemeenten: 3, contacten: 3, bijgewerkt: 0 });
    const k = await t.db.select().from(klanten);
    expect(k.every((x) => x.status === 'prospect' && x.bron === 'handmatig')).toBe(true);
    expect(await t.db.select().from(klantContacten)).toHaveLength(3);

    // Opnieuw plakken, met één extra contactpersoon bij een bestaande gemeente.
    const tweede = (await t.api('POST', '/api/klanten/import', { tekst: `${GEMEENTEN}\nGemeente Alleen;Eva Eerst;CIO;Opdrachtgever` })).json();
    expect(tweede.toegevoegd).toEqual({ gemeenten: 0, contacten: 1, bijgewerkt: 0 });
    expect(await t.db.select().from(klanten)).toHaveLength(3);
    expect(await t.db.select().from(klantContacten)).toHaveLength(4);
    expect((await t.app.inject({ method: 'POST', url: '/api/klanten/import', payload: { tekst: 'x' } })).statusCode).toBe(401);
  });
});

const LIJST_SALES = [
  'Gemeente\tSamenwerkingsverband\tInwonersaantallen\tSales AM\tContactpersoon\tEmailadres\tTelefoonnummer\tAttritie: Looptijd contract',
  'Gemeente Amersfoort\t\t163.298\tAnouk/Lara?\tSharon de Haas\ts.dehaas@amersfoort.nl\t\t22-05-24',
  'Gemeente Blaricum\tBEL Combinatie\t12.947\tRuben/Lara?\tMarita Rigter\tm.rigter@belcombinatie.nl\t06-23182441\t31-12-24',
  'Gemeente Maasdriel\tBommelerwaard\t26 225\tAnouk/Lara?\tEefje van der Heijden\te.vanderheijden@maasdriel.nl\t\t13-11-23',
  'Gemeente Wageningen\t\t42.790\tAnouk/Lara?\tPeter van der Laan \tpeter.van.der.laan@wageningen.nl\t\t3-2-2031',
  'Gemeente Wijdemeren\t\t24.670\tAnouk/Lara?\t-\t-\t\t31-12-26',
  'Gemeente Bronckhorst\t\t36.012\tRuben/Lara?\tKirsten Hendriks\tgeen-mailadres\t\t1-07-31',
].join('\n');

describe('klantenlijst van sales met extra kolommen', () => {
  it('leest de kolommen via de kopregel, met punten in aantallen, streepjes als leeg en datums dag-maand-jaar', () => {
    const r = beoordeelKlantenLijst(LIJST_SALES, [], []);
    const per = (n: string) => r.gemeenten.find((g) => g.naam === n)!;
    expect(per('Gemeente Amersfoort').velden).toEqual({ samenwerkingsverband: '', inwoners: 163298, salesAm: 'Anouk/Lara?', contractEinde: '2024-05-22' });
    expect(per('Gemeente Blaricum').velden).toMatchObject({ samenwerkingsverband: 'BEL Combinatie', inwoners: 12947, contractEinde: '2024-12-31' });
    expect(per('Gemeente Blaricum').contacten[0]).toMatchObject({ naam: 'Marita Rigter', email: 'm.rigter@belcombinatie.nl', telefoon: '06-23182441' });
    expect(per('Gemeente Maasdriel').velden.inwoners).toBe(26225);
    expect(per('Gemeente Wageningen').velden.contractEinde).toBe('2031-02-03');
    expect(per('Gemeente Wageningen').contacten[0].naam).toBe('Peter van der Laan');
    expect(per('Gemeente Wijdemeren').contacten).toEqual([]); // "-" is geen contactpersoon
    expect(per('Gemeente Bronckhorst').contacten[0].email).toBe('');
    expect(r.fouten).toEqual(['Regel 7: "geen-mailadres" is geen e-mailadres, overgeslagen']);
  });

  it('bewaart de gegevens, vult bij opnieuw plakken alleen lege velden aan en overschrijft niets', async () => {
    const t = await maakTestApp(); open.push(t);
    const r = (await t.api('POST', '/api/klanten/import', { tekst: LIJST_SALES })).json();
    expect(r.toegevoegd).toEqual({ gemeenten: 6, contacten: 5, bijgewerkt: 0 });
    const blaricum = (await t.db.select().from(klanten)).find((k) => k.naam === 'Gemeente Blaricum')!;
    expect(blaricum).toMatchObject({ samenwerkingsverband: 'BEL Combinatie', inwoners: 12947, salesAm: 'Ruben/Lara?', contractEinde: '2024-12-31', status: 'klant' });
    expect((await t.db.select().from(klantContacten)).find((c) => c.naam === 'Marita Rigter')).toMatchObject({ email: 'm.rigter@belcombinatie.nl', telefoon: '06-23182441' });
    // Een handmatige wijziging blijft staan; een leeg veld wordt wel aangevuld.
    await t.api('PATCH', `/api/klanten/${blaricum.id}`, { salesAm: 'Iemand anders', inwoners: null });
    const nogmaals = (await t.api('POST', '/api/klanten/import', { tekst: LIJST_SALES })).json();
    expect(nogmaals.toegevoegd).toEqual({ gemeenten: 0, contacten: 0, bijgewerkt: 1 });
    expect((await t.db.select().from(klanten)).find((k) => k.id === blaricum.id)).toMatchObject({ salesAm: 'Iemand anders', inwoners: 12947 });
  });
});
