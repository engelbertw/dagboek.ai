import { afterEach, describe, expect, it } from 'vitest';
import { bezoekTeller, periodeGrenzen } from '../bezoekteller.js';
import { magDoen } from '../rollen.js';
import { bezoeken, employees, klanten } from '../schema.js';
import { maakTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

describe('periodegrenzen', () => {
  it('geeft kalenderjaar, kwartaal en maand, ook bij schrikkeljaar en jaarwisseling', () => {
    expect(periodeGrenzen('jaar', '2026-11-05')).toEqual({ van: '2026-01-01', tot: '2026-12-31' });
    expect(periodeGrenzen('kwartaal', '2026-11-05')).toEqual({ van: '2026-10-01', tot: '2026-12-31' });
    expect(periodeGrenzen('kwartaal', '2026-03-31')).toEqual({ van: '2026-01-01', tot: '2026-03-31' });
    expect(periodeGrenzen('kwartaal', '2026-04-01')).toEqual({ van: '2026-04-01', tot: '2026-06-30' });
    expect(periodeGrenzen('maand', '2028-02-10')).toEqual({ van: '2028-02-01', tot: '2028-02-29' });
    expect(periodeGrenzen('maand', '2026-12-31')).toEqual({ van: '2026-12-01', tot: '2026-12-31' });
  });
});

describe('bezoekteller', () => {
  async function opzet() {
    const t = await maakTestApp(); open.push(t);
    const [irma, daan] = await t.db.insert(employees).values([{ naam: 'Irma', telefoon: '+31611111111', rol: 'accountmanager' }, { naam: 'Daan', telefoon: '+31622222222', rol: 'accountmanager' }]).returning();
    const [venlo, tiel] = await t.db.insert(klanten).values([{ naam: 'Venlo', status: 'klant', bron: 'handmatig' }, { naam: 'Tiel', status: 'klant', bron: 'handmatig' }]).returning();
    return { t, irma, daan, venlo, tiel };
  }
  const NU = new Date('2026-11-05T10:00:00Z');

  it('telt bezoeken in de periode, verschillende gemeenten en per accountmanager', async () => {
    const { t, irma, daan, venlo, tiel } = await opzet();
    await t.db.insert(bezoeken).values([
      { klantId: venlo.id, accountmanagerId: irma.id, datum: '2026-11-04', samenvatting: 'a' },
      { klantId: venlo.id, accountmanagerId: irma.id, datum: '2026-10-02', samenvatting: 'b' },
      { klantId: tiel.id, accountmanagerId: daan.id, datum: '2026-03-10', samenvatting: 'c' },
      { klantId: tiel.id, accountmanagerId: daan.id, datum: '2025-12-31', samenvatting: 'vorig jaar' },
      { klantId: null, accountmanagerId: null, datum: '2026-01-01', klantNaamGenoemd: 'Onbekend' },
    ]);
    const jaar = await bezoekTeller(t.db, 'jaar', NU);
    expect(jaar).toMatchObject({ bezoeken: 4, klanten: 2, van: '2026-01-01', tot: '2026-12-31' });
    expect(jaar.perAccountmanager).toEqual([{ naam: 'Daan', aantal: 1 }, { naam: 'Irma', aantal: 2 }, { naam: 'Onbekend', aantal: 1 }].sort((a, b) => b.aantal - a.aantal || a.naam.localeCompare(b.naam)));
    expect(await bezoekTeller(t.db, 'kwartaal', NU)).toMatchObject({ bezoeken: 2, klanten: 1 });
    expect(await bezoekTeller(t.db, 'maand', NU)).toMatchObject({ bezoeken: 1, klanten: 1 });
  });

  it('valt zonder datum terug op de dag van het verslag, in Nederlandse tijd', async () => {
    const { t, irma, venlo } = await opzet();
    // 31 dec 23:30 UTC is in Nederland al 1 januari.
    await t.db.insert(bezoeken).values({ klantId: venlo.id, accountmanagerId: irma.id, samenvatting: 'x', createdAt: new Date('2026-12-31T23:30:00Z') });
    expect((await bezoekTeller(t.db, 'jaar', new Date('2027-01-01T12:00:00Z'))).bezoeken).toBe(1);
    expect((await bezoekTeller(t.db, 'jaar', NU)).bezoeken).toBe(0);
  });

  it('geeft nullen zonder bezoeken en werkt via de route, met een standaardperiode en een ongeldige periode als fout', async () => {
    const { t } = await opzet();
    const r = await t.api('GET', '/api/dagboek/bezoekteller');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ periode: 'jaar', bezoeken: 0, klanten: 0, perAccountmanager: [] });
    expect((await t.api('GET', '/api/dagboek/bezoekteller?periode=eeuw')).statusCode).toBeGreaterThanOrEqual(400);
  });

  it('is leesbaar voor beheerder, accountmanager en consultant, niet voor administratie, en niet te wijzigen', () => {
    for (const rol of ['beheerder', 'accountmanager', 'consultant']) expect(magDoen(rol, 'GET', '/api/dagboek/bezoekteller'), rol).toBe(true);
    expect(magDoen('administratie', 'GET', '/api/dagboek/bezoekteller')).toBe(false);
    for (const rol of ['accountmanager', 'consultant']) expect(magDoen(rol, 'POST', '/api/dagboek/bezoekteller')).toBe(false);
  });
});
