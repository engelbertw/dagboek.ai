import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
    await h.db.execute(`insert into activiteiten (soort, omschrijving) values ('kans', 'x')` as any);
    await expect(h.db.execute(`insert into activiteiten (soort, omschrijving) values ('verzonnen', 'x')` as any)).rejects.toThrow();
    await h.close();
  }, 60_000);
});

describe('migratie 020 (één register)', () => {
  it('verhuist de open punten met dezelfde id en Jira-gegevens naar activiteiten en laat de klantpunten staan', async () => {
    const { mkdtempSync, copyFileSync, readdirSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const bron = fileURLToPath(new URL('../migrations/', import.meta.url));
    const oud = mkdtempSync(join(tmpdir(), 'migr-'));
    for (const f of readdirSync(bron).filter((n) => n < '020')) copyFileSync(join(bron, f), join(oud, f));
    const h = await connectMemory();
    try {
      await migrate(h, oud);
      const rijen = async (q: string) => { const r: any = await h.db.execute(q as any); return r.rows ?? r; };
      await h.db.execute(`insert into topics (titel) values ('Onderwerp')` as any);
      const [{ id: topic }] = await rijen(`select id from topics`);
      await h.db.execute(`insert into open_items (topic_id, tekst, deadline, deadline_oorspronkelijk, deadline_gewijzigd_aantal, jira_sleutel, jira_url, jira_aangemaakt_op, controle_nodig, controle_reden, bron)
        values ('${topic}', 'Offerte maken', '2026-11-06', '2026-11-01', 2, 'PROJ-1', 'https://j/PROJ-1', now(), true, 'eigenaar_onzeker', 'gesprek'),
               ('${topic}', 'Planning maken', null, null, 0, null, null, null, false, null, 'handmatig')` as any);
      await h.db.execute(`update open_items set status = 'afgerond', afgerond_op = now() where tekst = 'Planning maken'` as any);
      await h.db.execute(`insert into klant_activiteiten (soort, omschrijving) values ('kans', 'Hierarchie afnemen')` as any);
      const voor = await rijen(`select id, tekst from open_items order by tekst`);

      expect(await migrate(h)).toEqual(expect.arrayContaining(['020_een_register.sql']));

      const na = await rijen(`select id, soort, omschrijving, topic_id, status, deadline::text as deadline, deadline_oorspronkelijk::text as oorspronkelijk,
        deadline_gewijzigd_aantal as aantal, jira_sleutel, jira_url, controle_nodig, controle_reden, bron, afgerond_op is not null as afgerond from activiteiten where topic_id is not null order by omschrijving`);
      expect(na.map((r: any) => [r.id, r.omschrijving])).toEqual(voor.map((r: any) => [r.id, r.tekst]));
      expect(na[0]).toMatchObject({ soort: 'intern', topic_id: topic, status: 'open', deadline: '2026-11-06', oorspronkelijk: '2026-11-01', aantal: 2, jira_sleutel: 'PROJ-1', jira_url: 'https://j/PROJ-1', controle_nodig: true, controle_reden: 'eigenaar_onzeker', bron: 'gesprek' });
      expect(na[1]).toMatchObject({ omschrijving: 'Planning maken', status: 'afgerond', afgerond: true, bron: 'handmatig' });
      // De bestaande klantpunten blijven staan, en open_items blijft ongemoeid tot een latere migratie.
      expect((await rijen(`select soort from activiteiten where topic_id is null`)).map((r: any) => r.soort)).toEqual(['kans']);
      expect((await rijen(`select count(*)::int as n from open_items`))[0].n).toBe(2);
      await h.db.execute(`insert into activiteiten (soort, omschrijving) values ('intern', 'x')` as any);
      await expect(h.db.execute(`insert into activiteiten (soort, omschrijving) values ('verzonnen', 'x')` as any)).rejects.toThrow();
    } finally {
      await h.close();
      rmSync(oud, { recursive: true, force: true });
    }
  }, 120_000);
});
