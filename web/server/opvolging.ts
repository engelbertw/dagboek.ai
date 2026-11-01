/**
 * Opvolging van vervolgsignalen. Een consultant legt een behoefte vast die mogelijk buiten de huidige opdracht valt (een vervolgsignaal); of dat een commerciële
 * kans is, beoordeelt iemand van accountmanagement. Dat mag een beheerder of de accountmanager van die gemeente.
 * - Het signaal blijft staan met zijn citaat en wordt alleen afgerond; er wordt niets verwijderd of herschreven.
 * - Bij "kans" ontstaat een nieuw, leeg punt (geen bedrag, fase, beslisser of datum) met een verwijzing naar het signaal; de omschrijving wordt één keer overgenomen,
 *   het citaat en het transcript niet. De accountmanager van de gemeente wordt de eigenaar.
 * - Het besluit staat in een register dat niet wordt aangepast (`opvolgingen`), één per signaal.
 */
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.js';
import { ACCOUNTMANAGER_ROL, normaleRol, BEHEERDER_ROL } from './rollen.js';
import { activiteiten, consultantDebriefs, employees, klanten, OPVOLG_BESLUITEN, opvolgingen } from './schema.js';

export interface OpvolgSessie { email: string; naam?: string; rol?: string }

const idParam = z.string().uuid();
const body = z.object({ besluit: z.enum(OPVOLG_BESLUITEN), reden: z.string().trim().max(500).default('') });

export function registreerOpvolging(app: FastifyInstance, db: Db, sessie: (req: FastifyRequest) => OpvolgSessie | null) {
  /** Wie mag over dit signaal beslissen? Een beheerder altijd; een accountmanager alleen voor een gemeente waarvan die zelf de accountmanager is. */
  async function mag(req: FastifyRequest, klantId: string): Promise<{ ok: true; door: string } | { ok: false }> {
    const s = sessie(req);
    if (!s) return { ok: false };
    const rol = normaleRol(s.rol);
    const door = (s.naam || s.email).slice(0, 200);
    if (rol === BEHEERDER_ROL) return { ok: true, door };
    if (rol !== ACCOUNTMANAGER_ROL) return { ok: false };
    const [klant] = await db.select({ accountmanagerId: klanten.accountmanagerId }).from(klanten).where(eq(klanten.id, klantId));
    if (!klant?.accountmanagerId) return { ok: false };
    const [medewerker] = await db.select({ email: employees.email, actief: employees.actief }).from(employees).where(eq(employees.id, klant.accountmanagerId));
    const eigen = !!medewerker?.actief && !!medewerker.email && medewerker.email.trim().toLowerCase() === s.email.trim().toLowerCase();
    return eigen ? { ok: true, door } : { ok: false };
  }

  // Wat er met een signaal is besloten, met de weg terug naar de debrief en de woorden van de consultant.
  app.get('/api/activiteiten/:id/opvolging', async (req, reply) => {
    const id = idParam.safeParse((req.params as { id: string }).id);
    const [signaal] = id.success ? await db.select().from(activiteiten).where(and(eq(activiteiten.id, id.data), eq(activiteiten.soort, 'vervolgsignaal'))) : [];
    if (!signaal) return reply.code(404).send({ fout: 'Vervolgsignaal niet gevonden' });
    const [besluit] = await db.select().from(opvolgingen).where(eq(opvolgingen.signaalId, signaal.id));
    const [debrief] = signaal.callId ? await db.select({ id: consultantDebriefs.id, variant: consultantDebriefs.variant, createdAt: consultantDebriefs.createdAt }).from(consultantDebriefs).where(eq(consultantDebriefs.callId, signaal.callId)) : [];
    return {
      signaal: { id: signaal.id, omschrijving: signaal.omschrijving, citaat: signaal.citaat, klantId: signaal.klantId, status: signaal.status, controleNodig: signaal.controleNodig, debrief: debrief ?? null },
      opvolging: besluit ? { besluit: besluit.besluit, reden: besluit.reden, door: besluit.door, op: besluit.op, kansId: besluit.nieuwActiviteitId } : null,
    };
  });

  app.post('/api/activiteiten/:id/opvolging', async (req, reply) => {
    const id = idParam.safeParse((req.params as { id: string }).id);
    const b = body.parse(req.body);
    if (!id.success) return reply.code(404).send({ fout: 'Vervolgsignaal niet gevonden' });
    const [voor] = await db.select({ klantId: activiteiten.klantId, soort: activiteiten.soort }).from(activiteiten).where(eq(activiteiten.id, id.data));
    if (!voor || voor.soort !== 'vervolgsignaal') return reply.code(404).send({ fout: 'Vervolgsignaal niet gevonden' });
    if (!voor.klantId) return reply.code(409).send({ fout: 'Dit signaal hoort bij geen gemeente en kan niet worden opgevolgd' });
    const toegang = await mag(req, voor.klantId);
    if (!toegang.ok) return reply.code(403).send({ fout: 'Alleen een beheerder of de accountmanager van deze gemeente beslist over een vervolgsignaal' });
    if (b.besluit === 'geen_vervolg' && !b.reden) return reply.code(400).send({ fout: 'Geef een reden voor geen vervolg' });

    const uitkomst = await db.transaction(async (tx) => {
      const [signaal] = await tx.select().from(activiteiten).where(eq(activiteiten.id, id.data)).for('update');
      if (!signaal || signaal.soort !== 'vervolgsignaal' || !signaal.klantId) return { code: 404 as const, fout: 'Vervolgsignaal niet gevonden' };
      if (signaal.controleNodig) return { code: 409 as const, fout: 'Dit signaal is nog niet gecontroleerd; keur het eerst goed of wijs het af' };
      if ((await tx.select({ id: opvolgingen.id }).from(opvolgingen).where(eq(opvolgingen.signaalId, signaal.id))).length) return { code: 409 as const, fout: 'Over dit signaal is al besloten' };
      let kansId: string | null = null;
      if (b.besluit === 'kans') {
        const [klant] = await tx.select({ accountmanagerId: klanten.accountmanagerId }).from(klanten).where(eq(klanten.id, signaal.klantId));
        // Een leeg punt: wat een accountmanager nog niet weet (bedrag, fase, beslisser, datum) wordt niet ingevuld.
        const [kans] = await tx.insert(activiteiten).values({
          klantId: signaal.klantId, soort: 'kans', omschrijving: signaal.omschrijving, details: {}, citaat: '', bron: 'handmatig',
          eigenaarId: klant?.accountmanagerId ?? null, bronActiviteitId: signaal.id,
        }).returning({ id: activiteiten.id });
        kansId = kans.id;
      }
      await tx.insert(opvolgingen).values({ signaalId: signaal.id, besluit: b.besluit, reden: b.reden, door: toegang.door, nieuwActiviteitId: kansId });
      await tx.update(activiteiten).set({ status: 'afgerond', afgerondOp: new Date() }).where(eq(activiteiten.id, signaal.id));
      return { code: 201 as const, kansId };
    });
    if (uitkomst.code !== 201) return reply.code(uitkomst.code).send({ fout: uitkomst.fout });
    return reply.code(201).send({ besluit: b.besluit, kansId: uitkomst.kansId });
  });
}
