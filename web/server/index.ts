import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig, ontbrekendeInstellingen } from './config.js';
import { connectMemory, connectPostgres, migrate } from './db.js';
import { maakLlmClient } from './llm.js';
import { startScheduler } from './scheduler.js';
import { voerOpschoningUit } from './opschoning.js';
import { herstelVastgelopen } from './samenvatten.js';
import { herstelGesprekken } from './gesprek-herstel.js';
import { foutcode, log } from './log.js';
import { maakVoiceClient, maakVoiceOpzoeker } from './voice.js';

const config = loadConfig();
const ontbreekt = ontbrekendeInstellingen(config);
if (ontbreekt.length) {
  log('error', 'start.instellingen_ontbreken', { namen: ontbreekt.join(',') });
  process.exit(1);
}

// DATABASE_URL=memory draait op een tijdelijke in-process database, alleen om lokaal te proberen.
const handle = config.databaseUrl === 'memory' ? await connectMemory() : await connectPostgres(config.databaseUrl);
const nieuw = await migrate(handle);
if (nieuw.length) log('info', 'start.migraties', { toegepast: nieuw.join(',') });

const hier = dirname(fileURLToPath(import.meta.url));
const voice = maakVoiceClient(config);
const llm = maakLlmClient(config);
const app = buildApp({ db: handle.db, config, voice, llm, clientDir: join(hier, '..', 'dist', 'client') });
const opzoeken = maakVoiceOpzoeker(config);
const herstel = async () => {
  await herstelVastgelopen(handle.db);
  const r = await herstelGesprekken({ db: handle.db, llm, opzoeken, achtergrond: (t) => t.catch((e) => log('error', 'samenvatten.mislukt', { foutcode: foutcode(e) })) });
  if (r.opgelost || r.onderbroken || r.samenvattingen) log('info', 'herstel', { ...r });
};
await herstel().catch((e) => log('error', 'herstel.mislukt', { foutcode: foutcode(e) }));
const sweeper = setInterval(() => void herstel().catch((e) => log('error', 'herstel.mislukt', { foutcode: foutcode(e) })), 60_000);
sweeper.unref();
const opschoning = () => voerOpschoningUit(handle.db, config.transcriptBewaarDagen);
await opschoning();
const opschoner = setInterval(() => void opschoning(), 6 * 3_600_000);
opschoner.unref();
await app.listen({ port: config.port, host: '0.0.0.0' });
const scheduler = startScheduler({ db: handle.db, voice });
log('info', 'start.klaar', { poort: config.port });

for (const signaal of ['SIGTERM', 'SIGINT']) process.on(signaal, async () => { await scheduler.stop(); await app.close(); await handle.close(); process.exit(0); });
