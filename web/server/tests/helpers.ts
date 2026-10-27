import { buildApp } from '../app.js';
import { hashWachtwoord } from '../auth.js';
import type { Config } from '../config.js';
import { connectMemory, migrate } from '../db.js';
import type { BelOpdracht, BelResultaat } from '../voice.js';

export const WACHTWOORD = 'een-lang-testwachtwoord';
export const SERVICE_KEY = 'servicesleutel-voor-tests';

export async function maakTestApp(voiceAntwoord: BelResultaat = { gebeld: true, call_id: 'voice-123' }) {
  const handle = await connectMemory();
  await migrate(handle);
  const config: Config = {
    port: 0, databaseUrl: '', sessionSecret: 'geheim-voor-tests', adminEmail: 'beheer@test.nl',
    adminPasswordHash: hashWachtwoord(WACHTWOORD), secureCookies: false, voiceUrl: '', voiceAdminToken: '', serviceKey: SERVICE_KEY,
  };
  const opdrachten: BelOpdracht[] = [];
  const app = buildApp({ db: handle.db, config, voice: async (o) => { opdrachten.push(o); return voiceAntwoord; } });
  await app.ready();

  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'beheer@test.nl', wachtwoord: WACHTWOORD } });
  const sessie = String(login.cookies[0].value);
  const api = (method: string, url: string, payload?: unknown) =>
    app.inject({ method: method as any, url, payload: payload as any, cookies: { dagboek_sessie: sessie } });
  return { app, api, opdrachten, close: async () => { await app.close(); await handle.close(); } };
}
