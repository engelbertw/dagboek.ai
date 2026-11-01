import { afterEach, describe, expect, it } from 'vitest';
import { maakSessie } from '../auth.js';
import { activiteiten, calls, consultantDebriefs, employees, implementaties, klanten, samenverderProgrammas, topics } from '../schema.js';
import { maakTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof maakTestApp>>;
const open: T[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

async function opzet() {
  const t = await maakTestApp(); open.push(t);
  const [con] = await t.db.insert(employees).values({ naam: 'Coen', telefoon: '0611111111', rol: 'medewerker', consultant: true }).returning();
  const [k] = await t.db.insert(klanten).values({ naam: 'Gemeente A', status: 'klant' }).returning();
  const [project] = await t.db.insert(topics).values({ titel: 'Zaaksysteem', type: 'project', klantId: k.id }).returning();
  const [afgerond] = await t.db.insert(topics).values({ titel: 'Oud project', type: 'project', klantId: k.id, status: 'afgerond' }).returning();
  const [impl] = await t.db.insert(topics).values({ titel: 'Module Bezwaren', type: 'thema', klantId: k.id }).returning();
  await t.db.insert(implementaties).values({ topicId: impl.id, module: 'Bezwaren', fase: 'test' });
  const [prog] = await t.db.insert(samenverderProgrammas).values({ klantId: k.id, periodeVan: '2026-01-01' }).returning();
  const punt = (over: Partial<typeof activiteiten.$inferInsert>) => t.db.insert(activiteiten).values({ klantId: k.id, soort: 'blokkade', omschrijving: 'x', ...over });
  const als = (email: string, rol: string) => {
    const cookies = { dagboek_sessie: maakSessie(email, t.config.sessionSecret, Date.now(), { naam: email, rol }) };
    return (method: string, url: string) => t.app.inject({ method: method as any, url, cookies });
  };
  return { t, con, k, project, afgerond, impl, prog, punt, als };
}

describe('overzicht consultancy', () => {
  it('telt projecten en implementaties apart en laat afgeronde buiten beschouwing', async () => {
    const o = await opzet();
    const r = (await o.t.api('GET', '/api/consultancy')).json();
    expect(r.projecten.map((p: any) => p.titel)).toEqual(['Zaaksysteem']);
    expect(r.implementaties).toMatchObject([{ titel: 'Module Bezwaren', module: 'Bezwaren', fase: 'test' }]);
    expect(r.tellingen).toMatchObject({ projecten: 1, implementaties: 1, programmas: 1 });
  });

  it('telt alleen gecontroleerde open punten en leidt geen scores af', async () => {
    const o = await opzet();
    await o.punt({ topicId: o.project.id });
    await o.punt({ topicId: o.project.id, soort: 'afhankelijkheid' });
    await o.punt({ topicId: o.project.id, controleNodig: true });
    await o.punt({ topicId: o.project.id, status: 'afgerond' });
    await o.punt({ topicId: o.project.id, soort: 'risico' });
    await o.punt({ topicId: o.impl.id });
    await o.punt({ soort: 'vervolgsignaal' });
    await o.punt({ soort: 'vervolgsignaal', controleNodig: true });
    const r = (await o.t.api('GET', '/api/consultancy')).json();
    expect(r.projecten[0]).toMatchObject({ openBlokkades: 2, openRisicos: 1 });
    expect(r.implementaties[0].openBlokkades).toBe(1);
    expect(r.tellingen).toMatchObject({ openBlokkades: 3, openVervolgsignalen: 1 });
    expect(JSON.stringify(r)).not.toMatch(/score|rang|tevreden|behoud/i);
  });

  it('toont de laatste gecontroleerde debrief per onderwerp', async () => {
    const o = await opzet();
    const [c] = await o.t.db.insert(calls).values({ employeeId: o.con.id, type: 'consultant_debrief' }).returning();
    await o.t.db.insert(consultantDebriefs).values({ callId: c.id, employeeId: o.con.id, variant: 'project', klantId: o.k.id, topicId: o.project.id });
    const r = (await o.t.api('GET', '/api/consultancy')).json();
    expect(r.projecten[0].laatsteDebrief).toEqual(expect.any(String));
    expect(r.implementaties[0].laatsteDebrief).toBeNull();
  });

  it('is leesbaar voor beheerder en accountmanager, niet voor administratie', async () => {
    const o = await opzet();
    expect((await o.als('am@test.nl', 'accountmanager')('GET', '/api/consultancy')).statusCode).toBe(200);
    expect((await o.als('adm@test.nl', 'administratie')('GET', '/api/consultancy')).statusCode).toBe(403);
  });
});

describe('werkfilters en programmalijst', () => {
  it('filtert activiteiten op programma, variant en consultant', async () => {
    const o = await opzet();
    const [c] = await o.t.db.insert(calls).values({ employeeId: o.con.id, type: 'consultant_debrief' }).returning();
    await o.t.db.insert(consultantDebriefs).values({ callId: c.id, employeeId: o.con.id, variant: 'samenverder', klantId: o.k.id });
    await o.punt({ callId: c.id, samenverderProgrammaId: o.prog.id, omschrijving: 'uit debrief' });
    await o.punt({ omschrijving: 'los' });
    const lijst = async (q: string) => (await o.t.api('GET', `/api/activiteiten?${q}`)).json().map((a: any) => a.omschrijving);
    expect(await lijst(`programmaId=${o.prog.id}`)).toEqual(['uit debrief']);
    expect(await lijst('variant=samenverder')).toEqual(['uit debrief']);
    expect(await lijst('variant=project')).toEqual([]);
    expect(await lijst(`consultantId=${o.con.id}`)).toEqual(['uit debrief']);
    expect(await lijst('')).toHaveLength(2);
  });

  it('geeft de programmalijst de nieuwe feiten', async () => {
    const o = await opzet();
    await o.punt({ samenverderProgrammaId: o.prog.id });
    await o.punt({ samenverderProgrammaId: o.prog.id, soort: 'actie' });
    await o.punt({ samenverderProgrammaId: o.prog.id, soort: 'vervolgsignaal' });
    const [p] = (await o.t.api('GET', '/api/samenverder/programmas')).json();
    expect(p).toMatchObject({ openActies: 1, openBlokkades: 1, openSignalen: 1, laatsteDebrief: null, evaluatiesUitgevoerd: 0, volgendeEvaluatie: null, volgendeSessie: null });
  });
});
