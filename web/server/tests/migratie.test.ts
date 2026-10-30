import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { connectMemory, migrate } from '../db.js';

describe('migratie 003 (e-mail)', () => {
  it('haalt een e-mailadres uit de notitie en laat andere notities ongemoeid', async () => {
    const h = await connectMemory();
    // De migratie is al gedraaid op een lege tabel; draai de verhuizing uit het bestand opnieuw op nieuwe rijen.
    await migrate(h);
    await h.db.execute(`insert into employees (naam, telefoon, notitie) values ('A','1','E-mail: a@b.nl'), ('B','2','Eerst bellen na 10 uur'), ('C','3','E-mail: c@d.nl en meer')` as any);
    const verhuis = readFileSync(new URL('../migrations/003_email.sql', import.meta.url), 'utf8').split('\n').find((r) => r.startsWith('UPDATE employees'))!;
    await h.db.execute(verhuis as any);
    const r: any = await h.db.execute(`select naam, email, notitie from employees order by naam` as any);
    const rijen = r.rows ?? r;
    expect(rijen).toEqual([
      { naam: 'A', email: 'a@b.nl', notitie: '' },
      { naam: 'B', email: '', notitie: 'Eerst bellen na 10 uur' },
      { naam: 'C', email: '', notitie: 'E-mail: c@d.nl en meer' },
    ]);
    await h.close();
  }, 60_000);
});

describe('migratie 019 (verkoop-debrief)', () => {
  it('laat bestaande medewerkers en gesprekken op hun oude soort en weigert onbekende waarden', async () => {
    const h = await connectMemory();
    await migrate(h);
    await h.db.execute(`insert into employees (naam, telefoon) values ('A','1')` as any);
    await h.db.execute(`insert into calls (employee_id) select id from employees` as any);
    const r: any = await h.db.execute(`select e.rol, c.type from employees e join calls c on c.employee_id = e.id` as any);
    expect((r.rows ?? r)[0]).toEqual({ rol: 'medewerker', type: 'dagboek' });
    await expect(h.db.execute(`update employees set rol = 'baas'` as any)).rejects.toThrow();
    await expect(h.db.execute(`update calls set type = 'iets'` as any)).rejects.toThrow();
    await expect(h.db.execute(`insert into klanten (naam, status) values ('K', 'onzin')` as any)).rejects.toThrow();
    // Eén bezoek per gesprek, en een activiteit zonder klant mag (wacht dan op controle).
    await h.db.execute(`insert into klanten (naam) values ('K')` as any);
    const klant: any = await h.db.execute(`select id from klanten` as any);
    const call: any = await h.db.execute(`select id from calls` as any);
    const kid = (klant.rows ?? klant)[0].id, cid = (call.rows ?? call)[0].id;
    await h.db.execute(`insert into bezoeken (klant_id, call_id) values ('${kid}', '${cid}')` as any);
    await expect(h.db.execute(`insert into bezoeken (klant_id, call_id) values ('${kid}', '${cid}')` as any)).rejects.toThrow();
    await h.db.execute(`insert into klant_activiteiten (soort, omschrijving) values ('kans', 'x')` as any);
    await expect(h.db.execute(`insert into klant_activiteiten (soort, omschrijving) values ('verzonnen', 'x')` as any)).rejects.toThrow();
    await h.close();
  }, 60_000);
});
