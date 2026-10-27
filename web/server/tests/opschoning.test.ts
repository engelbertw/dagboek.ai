import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ruimTranscriptenOp } from '../opschoning.js';
import { calls } from '../schema.js';
import { maakTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof maakTestApp>>;
beforeAll(async () => { t = await maakTestApp(); }, 60_000);
afterAll(async () => { await t.close(); });

const dagenGeleden = (n: number) => new Date(Date.now() - n * 86_400_000);

describe('bewaartermijn transcripten', () => {
  it('wist alleen oude transcripten en laat samenvattingen en lopende samenvattingen met rust', async () => {
    const m = (await t.api('POST', '/api/employees', { naam: 'Daan', telefoon: '0612345678' })).json();
    const maak = async (leeftijd: number, samenvattingStatus: 'klaar' | 'bezig') => {
      const [c] = await t.db.insert(calls).values({
        employeeId: m.id, status: 'gesproken', afgerondOp: dagenGeleden(leeftijd), samenvattingStatus,
        transcript: [{ role: 'user', content: 'hallo' }], samenvattingRuw: { x: 1 },
      }).returning();
      return c.id;
    };
    const oud = await maak(31, 'klaar');
    const recent = await maak(29, 'klaar');
    const oudBezig = await maak(40, 'bezig');

    expect(await ruimTranscriptenOp(t.db, 30)).toBe(1);
    const lees = async (id: string) => (await t.db.select().from(calls).where(eq(calls.id, id)))[0];
    expect((await lees(oud)).transcript).toBeNull();
    expect((await lees(oud)).samenvattingRuw).toBeNull();
    expect((await lees(oud)).samenvattingStatus).toBe('klaar');
    expect((await lees(recent)).transcript).not.toBeNull();
    expect((await lees(oudBezig)).transcript).not.toBeNull();
    expect(await ruimTranscriptenOp(t.db, 30)).toBe(0);
  });

  it('doet niets bij een ongeldige termijn', async () => {
    expect(await ruimTranscriptenOp(t.db, 0)).toBe(0);
    expect(await ruimTranscriptenOp(t.db, NaN)).toBe(0);
  });
});
