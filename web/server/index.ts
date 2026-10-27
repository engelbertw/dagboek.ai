import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig, ontbrekendeInstellingen } from './config.js';
import { connectMemory, connectPostgres, migrate } from './db.js';
import { maakLlmClient } from './llm.js';
import { herstelVastgelopen } from './samenvatten.js';
import { maakVoiceClient } from './voice.js';

const config = loadConfig();
const ontbreekt = ontbrekendeInstellingen(config);
if (ontbreekt.length) {
  console.error(`Ontbrekende instellingen: ${ontbreekt.join(', ')}`);
  process.exit(1);
}

// DATABASE_URL=memory draait op een tijdelijke in-process database, alleen om lokaal te proberen.
const handle = config.databaseUrl === 'memory' ? await connectMemory() : await connectPostgres(config.databaseUrl);
const nieuw = await migrate(handle);
if (nieuw.length) console.log(`Migraties toegepast: ${nieuw.join(', ')}`);

const hier = dirname(fileURLToPath(import.meta.url));
const app = buildApp({ db: handle.db, config, voice: maakVoiceClient(config), llm: maakLlmClient(config), clientDir: join(hier, '..', 'dist', 'client') });
await herstelVastgelopen(handle.db);
const sweeper = setInterval(() => void herstelVastgelopen(handle.db).catch(() => {}), 5 * 60_000);
sweeper.unref();
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`dagboek-web luistert op :${config.port}`);

for (const signaal of ['SIGTERM', 'SIGINT']) process.on(signaal, async () => { await app.close(); await handle.close(); process.exit(0); });
