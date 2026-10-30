import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { calls, employees } from '../schema.js';
import { maakTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

describe('een gesprek verwijderen dat niet meer op te halen is', () => {
  it('verwijdert een mislukt gesprek zonder transcript, maar geen gesproken gesprek, geen transcript en niets dat nog bezig is', async () => {
    const t = await maakTestApp(); open.push(t);
    const [m] = await t.db.insert(employees).values({ naam: 'Job', telefoon: '0612345678' }).returning();
    const oud = new Date(Date.now() - 60 * 60_000);
    const maak = async (waarden: Partial<typeof calls.$inferInsert>) => (await t.db.insert(calls).values({ employeeId: m.id, createdAt: oud, ...waarden }).returning())[0].id;
    const mislukt = await maak({ status: 'mislukt' });
    const hangt = await maak({ status: 'belt', engine: 'elevenlabs_agent' });
    const vers = await maak({ status: 'belt', createdAt: new Date() });
    const gesproken = await maak({ status: 'gesproken', transcript: [{ role: 'user', content: 'hoi' }] });
    const metTranscript = await maak({ status: 'mislukt', transcript: [{ role: 'user', content: 'hoi' }] });

    for (const id of [vers, gesproken, metTranscript]) expect((await t.api('DELETE', `/api/calls/${id}`)).statusCode).toBe(409);
    for (const id of [mislukt, hangt]) expect((await t.api('DELETE', `/api/calls/${id}`)).statusCode).toBe(200);
    expect((await t.api('DELETE', `/api/calls/${mislukt}`)).statusCode).toBe(404);
    expect(await t.db.select().from(calls).where(eq(calls.id, hangt))).toHaveLength(0);
    expect(await t.db.select().from(calls)).toHaveLength(3);
  });
});
