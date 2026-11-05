import { and, eq, inArray, sql } from 'drizzle-orm';
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
import { activiteiten, calls, suggesties, updates } from './schema.js';
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

  // Een dagboekgesprek dat eigenlijk een debrief was (bijvoorbeeld een klantbezoek dat via 'Bel nu' als dagboek is gevoerd): een beheerder zet het om, waarna het
  // alsnog als debrief wordt verwerkt. Heeft het dagboek er al iets uit weggeschreven, dan weigert dit eerst met een overzicht (409); met `opruimen: true` worden
  // precies de rijen van dít gesprek verwijderd (updates, punten, suggesties) en volgt de debrief. Wat het dagboek daarnaast bij andere punten deed (een punt als afgerond
  // of te controleren markeren) wordt niet teruggedraaid; dat staat in het overzicht.
  app.post('/api/calls/:id/als-debrief', async (req, reply) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const { route, opruimen } = z.object({ route: z.enum(['verkoop', 'consultancy']), opruimen: z.boolean().optional() }).parse(req.body);
    const [call] = await db.select({
      type: calls.type, status: calls.status, heeftTranscript: sql<boolean>`${calls.transcript} is not null`, samenvattingStatus: calls.samenvattingStatus, ruw: calls.samenvattingRuw,
    }).from(calls).where(eq(calls.id, id));
    if (!call) return reply.code(404).send({ fout: 'Gesprek niet gevonden' });
    if (call.type !== 'dagboek') return reply.code(409).send({ fout: 'Alleen een dagboekgesprek kan worden omgezet', reden: 'geen_dagboek' });
    if (call.status !== 'gesproken' || !call.heeftTranscript) return reply.code(409).send({ fout: 'Alleen een afgerond gesprek met transcript kan worden omgezet', reden: 'geen_transcript' });
    if (call.samenvattingStatus === 'bezig') return reply.code(409).send({ fout: 'Dit gesprek wordt nu samengevat. Probeer het over een minuut opnieuw.', reden: 'bezig' });

    const aantal = async (tabel: typeof updates | typeof activiteiten | typeof suggesties) => {
      const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(tabel).where(eq(tabel.callId, id));
      return r.n;
    };
    const uitvoer = { updates: await aantal(updates), punten: await aantal(activiteiten), suggesties: await aantal(suggesties) };
    const [{ n: bewerkt }] = await db.select({ n: sql<number>`count(*)::int` }).from(updates).where(and(eq(updates.callId, id), sql`${updates.bewerktOp} is not null`));
    const [{ n: metJira }] = await db.select({ n: sql<number>`count(*)::int` }).from(activiteiten).where(and(eq(activiteiten.callId, id), sql`${activiteiten.jiraSleutel} is not null`));
    // Het dagboek kan bij andere punten iets hebben gedaan (afgerond of voor controle gemarkeerd); dat is niet terug te draaien en wordt hier alleen gemeld.
    const onderwerpenRuw = (call.ruw as { onderwerpen?: { afgeronde_open_punten?: unknown[] }[] } | null)?.onderwerpen ?? [];
    const gevolgen = { puntenAfgerondOfGemarkeerd: onderwerpenRuw.reduce((som, o) => som + (Array.isArray(o.afgeronde_open_punten) ? o.afgeronde_open_punten.length : 0), 0), bewerkteUpdates: bewerkt };
    const heeftUitvoer = uitvoer.updates + uitvoer.punten + uitvoer.suggesties > 0 || gevolgen.puntenAfgerondOfGemarkeerd > 0;
    if (heeftUitvoer && !opruimen) {
      return reply.code(409).send({
        fout: 'Dit gesprek is al als dagboek verwerkt. Omzetten verwijdert eerst wat het dagboek eruit heeft opgeslagen.', reden: 'al_verwerkt', uitvoer, gevolgen,
      });
    }
    if (metJira > 0) {
      return reply.code(409).send({ fout: 'Een punt uit dit dagboekgesprek is al naar Jira gezet en kan niet worden opgeruimd.', reden: 'punt_in_jira', uitvoer, gevolgen });
    }

    const resultaat = await db.transaction(async (tx) => {
      const gezet = await tx.update(calls).set({
        type: routeNaarType(route), routeBron: 'beheerder', routeCitaat: null, samenvattingStatus: 'geen', samenvattingRuw: null, samenvattingFout: null,
      }).where(and(eq(calls.id, id), eq(calls.type, 'dagboek'), eq(calls.status, 'gesproken'), sql`${calls.transcript} is not null`,
        inArray(calls.samenvattingStatus, ['geen', 'mislukt', 'onduidelijk', 'geen_inhoud', 'klaar']))).returning({ id: calls.id });
      if (!gezet.length) return null;
      const u = await tx.delete(updates).where(eq(updates.callId, id)).returning({ id: updates.id });
      const p = await tx.delete(activiteiten).where(eq(activiteiten.callId, id)).returning({ id: activiteiten.id });
      const sg = await tx.delete(suggesties).where(eq(suggesties.callId, id)).returning({ id: suggesties.id });
      return { updates: u.length, punten: p.length, suggesties: sg.length };
    });
    if (!resultaat) return reply.code(409).send({ fout: 'Dit gesprek is intussen gewijzigd; vernieuw het scherm en probeer het opnieuw.', reden: 'gewijzigd' });
    await logGebeurtenis(db, id, 'web', `route:beheerder:${route}`);
    await logGebeurtenis(db, id, 'web', `omgezet_van:dagboek:verwijderd_updates=${resultaat.updates}_punten=${resultaat.punten}_suggesties=${resultaat.suggesties}`);
    return reply.code(202).send(await samenvattenGesprek({ db, llm }, id));
  });
}
