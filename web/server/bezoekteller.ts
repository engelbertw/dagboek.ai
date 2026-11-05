import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.js';
import { vandaagNL } from './samenvatten.js';
import { bezoeken, employees } from './schema.js';

/** Teller voor het dagboek: hoeveel klantbezoeken heeft het team gedaan in een periode. Een klantbezoek is een verwerkte verkoop-debrief (tabel `bezoeken`). */
export const PERIODES = ['jaar', 'kwartaal', 'maand'] as const;
export type Periode = (typeof PERIODES)[number];

const pad = (n: number) => String(n).padStart(2, '0');
const laatsteDag = (jaar: number, maand: number) => new Date(Date.UTC(jaar, maand, 0)).getUTCDate();

/** De grenzen (beide inclusief, als datum) van de lopende periode, op basis van de datum van vandaag in Nederland. */
export function periodeGrenzen(periode: Periode, vandaag: string): { van: string; tot: string } {
  const [j, m] = vandaag.split('-').map(Number);
  if (periode === 'jaar') return { van: `${j}-01-01`, tot: `${j}-12-31` };
  if (periode === 'maand') return { van: `${j}-${pad(m)}-01`, tot: `${j}-${pad(m)}-${laatsteDag(j, m)}` };
  const eerste = Math.floor((m - 1) / 3) * 3 + 1;
  return { van: `${j}-${pad(eerste)}-01`, tot: `${j}-${pad(eerste + 2)}-${laatsteDag(j, eerste + 2)}` };
}

export interface BezoekTeller {
  periode: Periode; van: string; tot: string; bezoeken: number; klanten: number;
  perAccountmanager: { naam: string; aantal: number }[];
}

export async function bezoekTeller(db: Db, periode: Periode, nu = new Date()): Promise<BezoekTeller> {
  const { van, tot } = periodeGrenzen(periode, vandaagNL(nu));
  // De datum van het bezoek zelf; zonder datum telt de dag waarop het verslag is gemaakt.
  const dag = sql`coalesce(${bezoeken.datum}, (${bezoeken.createdAt} at time zone 'Europe/Amsterdam')::date)`;
  const rijen = await db.select({ naam: employees.naam, klantId: bezoeken.klantId })
    .from(bezoeken).leftJoin(employees, eq(employees.id, bezoeken.accountmanagerId))
    .where(and(sql`${dag} >= ${van}::date`, sql`${dag} <= ${tot}::date`));
  const per = new Map<string, number>();
  for (const r of rijen) per.set(r.naam ?? 'Onbekend', (per.get(r.naam ?? 'Onbekend') ?? 0) + 1);
  return {
    periode, van, tot, bezoeken: rijen.length, klanten: new Set(rijen.map((r) => r.klantId).filter(Boolean)).size,
    perAccountmanager: [...per].map(([naam, aantal]) => ({ naam, aantal })).sort((a, b) => b.aantal - a.aantal || a.naam.localeCompare(b.naam, 'nl')),
  };
}

export function registreerBezoekteller(app: FastifyInstance, db: Db) {
  app.get('/api/dagboek/bezoekteller', async (req) => {
    const { periode } = z.object({ periode: z.enum(PERIODES).default('jaar') }).parse(req.query);
    return bezoekTeller(db, periode);
  });
}
