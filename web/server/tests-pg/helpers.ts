import { randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { connectPostgres, type DbHandle } from '../db.js';

export const BASIS_URL = process.env.TEST_DATABASE_URL ?? '';
export const migratieMap = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Een verse, lege database in de testserver (elke test zijn eigen), en een functie om hem weer te verwijderen. */
export async function maakDatabase(): Promise<{ url: string; verwijder: () => Promise<void> }> {
  if (!BASIS_URL) throw new Error('TEST_DATABASE_URL ontbreekt: draai dit via `npm run test:pg`');
  const naam = `test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: BASIS_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${naam}`);
  await admin.end();
  const url = new URL(BASIS_URL);
  url.pathname = `/${naam}`;
  return {
    url: url.toString(),
    verwijder: async () => {
      const a = new pg.Client({ connectionString: BASIS_URL });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${naam} WITH (FORCE)`);
      await a.end();
    },
  };
}

/** Kopieert alleen de migraties tot en met `tot` (bijvoorbeeld '009') naar een tijdelijke map: de stand van een database vóór de nieuwere migraties. */
export function migratiesTot(tot: string): string {
  const map = mkdtempSync(join(tmpdir(), 'migraties-'));
  for (const f of readdirSync(migratieMap).filter((x) => x.endsWith('.sql') && x.slice(0, 3) <= tot)) cpSync(join(migratieMap, f), join(map, f));
  return map;
}

export async function maakHandles(url: string, aantal: number): Promise<DbHandle[]> {
  return Promise.all(Array.from({ length: aantal }, () => connectPostgres(url)));
}

export const pool = (url: string, max = 10) => new pg.Pool({ connectionString: url, max });
