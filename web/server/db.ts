import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';

export type Db = PgDatabase<any, typeof schema>;
export interface DbHandle {
  db: Db;
  exec(sqlText: string): Promise<void>;
  close(): Promise<void>;
  /** Voert `fn` uit terwijl een database-brede lock wordt vastgehouden, zodat twee instanties niet tegelijk migreren. Zonder deze functie: geen lock nodig (één verbinding). */
  metLock?<T>(fn: () => Promise<T>): Promise<T>;
}

/** Willekeurig maar vast getal voor de advisory lock van migraties. */
const MIGRATIE_LOCK = 7_302_026;

const migratieMap = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function connectPostgres(url: string): Promise<DbHandle> {
  const { default: pg } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  return {
    db: drizzle(pool, { schema }) as Db,
    exec: async (s) => { await pool.query(s); },
    close: () => pool.end(),
    // Een lock op sessieniveau hoort bij één verbinding: haal die apart op en houd hem vast tot de migraties klaar zijn.
    metLock: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock($1)', [MIGRATIE_LOCK]);
        return await fn();
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATIE_LOCK]).catch(() => {});
        client.release();
      }
    },
  };
}

/** In-process Postgres (WASM) voor tests en lokaal proberen zonder database. */
export async function connectMemory(): Promise<DbHandle> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const client = new PGlite();
  return { db: drizzle(client, { schema }) as unknown as Db, exec: async (s) => { await client.exec(s); }, close: () => client.close() };
}

/** De namen van alle migraties die bij deze versie van de app horen. */
export function migratieNamen(map = migratieMap): string[] {
  return readdirSync(map).filter((f) => f.endsWith('.sql')).sort();
}

export async function migrate(handle: DbHandle, map = migratieMap): Promise<string[]> {
  const uitvoeren = async () => {
    await handle.exec('CREATE TABLE IF NOT EXISTS migraties (naam text PRIMARY KEY, toegepast_op timestamptz NOT NULL DEFAULT now())');
    const { sql } = await import('drizzle-orm');
    const gedaan = new Set(
      ((await handle.db.execute(sql`SELECT naam FROM migraties`)) as unknown as { rows: { naam: string }[] }).rows.map((r) => r.naam),
    );
    const nieuw: string[] = [];
    for (const bestand of migratieNamen(map)) {
      if (gedaan.has(bestand)) continue;
      // Een migratie en de registratie ervan slaagt of faalt samen.
      await handle.exec(`BEGIN;\n${readFileSync(join(map, bestand), 'utf8')}\nINSERT INTO migraties (naam) VALUES ('${bestand}');\nCOMMIT;`);
      nieuw.push(bestand);
    }
    return nieuw;
  };
  // Onder de lock lezen we pas welke migraties al gedaan zijn: een instantie die moest wachten ziet het werk van de ander.
  return handle.metLock ? handle.metLock(uitvoeren) : uitvoeren();
}
