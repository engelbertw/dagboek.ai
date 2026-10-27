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
