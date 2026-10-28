import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig, ontbrekendeInstellingen } from './config.js';
import { connectMemory, connectPostgres, migrate } from './db.js';
import { maakLlmClient } from './llm.js';
import { startScheduler } from './scheduler.js';
import { ruimTranscriptenOp } from './opschoning.js';
import { herstelVastgelopen } from './samenvatten.js';
import { herstelGesprekken } from './gesprek-herstel.js';
import { maakVoiceClient, maakVoiceOpzoeker } from './voice.js';

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
const voice = maakVoiceClient(config);
const llm = maakLlmClient(config);
const app = buildApp({ db: handle.db, config, voice, llm, clientDir: join(hier, '..', 'dist', 'client') });
const opzoeken = maakVoiceOpzoeker(config);
const herstel = async () => {
  await herstelVastgelopen(handle.db);
  const r = await herstelGesprekken({ db: handle.db, llm, opzoeken, achtergrond: (t) => t.catch((e) => console.error('Samenvatten mislukt', e)) });
  if (r.opgelost || r.onderbroken || r.samenvattingen) console.log(`Herstel: ${r.opgelost} opgelost, ${r.onderbroken} onderbroken, ${r.samenvattingen} samenvatting(en) hervat`);
};
await herstel().catch((e) => console.error('Herstel mislukt', e));
const sweeper = setInterval(() => void herstel().catch((e) => console.error('Herstel mislukt', e)), 60_000);
sweeper.unref();
const opschoning = async () => {
  const n = await ruimTranscriptenOp(handle.db, config.transcriptBewaarDagen);
  if (n) console.log(`Transcripten gewist na ${config.transcriptBewaarDagen} dagen: ${n} gesprek(ken)`);
};
await opschoning().catch((e) => console.error('Opschoning mislukt', e));
const opschoner = setInterval(() => void opschoning().catch((e) => console.error('Opschoning mislukt', e)), 6 * 3_600_000);
opschoner.unref();
await app.listen({ port: config.port, host: '0.0.0.0' });
const scheduler = startScheduler({ db: handle.db, voice });
console.log('Planning gestart');
console.log(`dagboek-web luistert op :${config.port}`);

for (const signaal of ['SIGTERM', 'SIGINT']) process.on(signaal, async () => { await scheduler.stop(); await app.close(); await handle.close(); process.exit(0); });
