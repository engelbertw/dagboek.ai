import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.js';
import type { LlmClient } from './llm.js';
import { logGebeurtenis } from './call-log.js';
import { ingeschakeldeVarianten, variantConfig } from './consultant-varianten.js';
import {
  bewaarConsultantDebrief, bewaarConsultantVragen, leesConsultantDebrief, leesConsultantVragen, leesVorigeConsultantVragen, STANDAARD_CONSULTANT_VRAGEN,
} from './instellingen.js';
import { routeNaarType } from './routering.js';
import { calls } from './schema.js';
import { samenvattenGesprek } from './samenvatten.js';

const uuid = z.string().uuid();

/** Instellingen en beheer rond de consultantdebriefs. Alleen voor beheerders (zie rollen.ts: niet in de lijst voor accountmanagers). */
export function registreerConsultantRoutes(app: FastifyInstance, db: Db, llm: LlmClient) {
  const aan = async () => ({ aan: await leesConsultantDebrief(db), varianten: ingeschakeldeVarianten().map((v) => ({ id: v.id, naam: v.naam })) });
  app.get('/api/instellingen/consultant-debrief', aan);
  app.put('/api/instellingen/consultant-debrief', async (req) => {
    await bewaarConsultantDebrief(db, z.object({ aan: z.boolean() }).parse(req.body).aan);
    return aan();
  });

  // Checklists: 'algemeen' en één per ingeschakelde variant. De vaste regels (privacy, betrouwbaarheid, gespreksfasen) staan in code en zijn niet te wijzigen.
  const standaardVoor = (sleutel: string) => (sleutel === 'algemeen' ? STANDAARD_CONSULTANT_VRAGEN : variantConfig(sleutel)?.standaardVragen);
  const vragen = async (sleutel: string) => {
    const standaard = standaardVoor(sleutel)!;
    return { sleutel, ...(await leesConsultantVragen(db, sleutel, standaard)), vorige: await leesVorigeConsultantVragen(db, sleutel) };
  };
  app.get('/api/instellingen/consultant-vragen/:sleutel', async (req, reply) => {
    const sleutel = z.string().max(30).parse((req.params as { sleutel: string }).sleutel);
    return standaardVoor(sleutel) === undefined ? reply.code(404).send({ fout: 'Onbekende checklist' }) : vragen(sleutel);
  });
  app.put('/api/instellingen/consultant-vragen/:sleutel', async (req, reply) => {
    const sleutel = z.string().max(30).parse((req.params as { sleutel: string }).sleutel);
    const standaard = standaardVoor(sleutel);
    if (standaard === undefined) return reply.code(404).send({ fout: 'Onbekende checklist' });
    const { waarde } = z.object({ waarde: z.string().max(8000) }).parse(req.body);
    await bewaarConsultantVragen(db, sleutel, waarde, standaard);
    return vragen(sleutel);
  });

  // Bij een dubbele rol kon de route niet uit het gesprek worden bewezen: een beheerder kiest hem (en kijkt daarvoor in het transcript), waarna het gesprek alsnog wordt verwerkt.
  app.post('/api/calls/:id/route', async (req, reply) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const { route } = z.object({ route: z.enum(['verkoop', 'consultancy']) }).parse(req.body);
    const gezet = await db.update(calls).set({ type: routeNaarType(route), routeBron: 'beheerder', routeCitaat: null })
      .where(and(eq(calls.id, id), eq(calls.type, 'debrief_keuze'), eq(calls.status, 'gesproken'))).returning({ id: calls.id });
    if (!gezet.length) return reply.code(409).send({ fout: 'Alleen een afgerond gesprek met een nog onbepaalde route kan een route krijgen' });
    await logGebeurtenis(db, id, 'web', `route:beheerder:${route}`);
    return reply.code(202).send(await samenvattenGesprek({ db, llm }, id));
  });
}
