/**
 * Datakwaliteit van wat al is vastgelegd: dubbele contactpersonen, klanten en punten, en gegevens die op de verkeerde plek of in een vreemde vorm staan.
 * Alles is deterministisch (geen taalmodel) en alleen een aanwijzing: de accountmanager beoordeelt en voert uit (samenvoegen, verbeteren of "geen probleem").
 * Een beoordeling "geen probleem" wordt bewaard onder een sleutel van de betrokken records; komt er een record bij, dan verschijnt de melding opnieuw.
 */
import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from './db.js';
import { lijktOpBestaand } from './kwaliteit.js';
import { emailSleutel, schoonTelefoon, splitsNaam, telefoonSleutel, vergelijkNamen, naamDelen, afstand } from './namen.js';
import {
  activiteiten, consultantDebriefContacten, employees, implementaties, klantContacten, klanten, kwaliteitBesluiten, samenverderSessies,
} from './schema.js';
import { normaliseer } from './vertrouwen.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const BEVINDING_SOORTEN = ['dubbel_contact', 'dubbele_klant', 'dubbele_activiteit', 'gegevens_in_naam', 'naam_onvolledig', 'contact_formaat', 'contact_onvolledig'] as const;
export type BevindingSoort = (typeof BEVINDING_SOORTEN)[number];

export interface ContactItem { id: string; naam: string; functie: string; rol: string; email: string; telefoon: string; aangemaakt: string; bron: 'gesprek' | 'handmatig'; gebruik: number }
export interface KlantItem { id: string; naam: string; status: string; afasId: string | null; aantalContacten: number; aantalPunten: number }
export interface ActiviteitItem { id: string; soort: string; omschrijving: string; eigenaar: string; deadline: string | null; aangemaakt: string; bron: string; metCitaat: boolean }

export interface Bevinding {
  sleutel: string;
  soort: BevindingSoort;
  ernst: 'hoog' | 'laag';
  klantId: string;
  klantNaam: string;
  accountmanagerNaam: string | null;
  uitleg: string;
  contacten?: ContactItem[];
  klanten?: KlantItem[];
  activiteiten?: ActiviteitItem[];
  /** Een voorgestelde verbetering voor één contactpersoon, door de accountmanager toe te passen met "Bewerken". */
  voorstel?: { contactId: string; naam?: string; email?: string; telefoon?: string };
  besloten: boolean;
}

const sleutelVan = (soort: string, ids: string[]) => `${soort}:${createHash('sha1').update([...ids].sort().join('|')).digest('hex').slice(0, 24)}`;

/** Groepeert elementen die via `paar` met elkaar in verband staan (transitief). */
function groepeer<T extends { id: string }>(lijst: T[], paar: (a: T, b: T) => string[]): { leden: T[]; redenen: string[] }[] {
  const ouder = new Map(lijst.map((x) => [x.id, x.id]));
  const vind = (i: string): string => (ouder.get(i) === i ? i : (ouder.set(i, vind(ouder.get(i)!)), ouder.get(i)!));
  const redenen = new Map<string, Set<string>>();
  for (let i = 0; i < lijst.length; i++) {
    for (let j = i + 1; j < lijst.length; j++) {
      const r = paar(lijst[i], lijst[j]);
      if (!r.length) continue;
      ouder.set(vind(lijst[i].id), vind(lijst[j].id));
      for (const x of r) { const s = redenen.get(lijst[i].id) ?? new Set(); s.add(x); redenen.set(lijst[i].id, s); const t = redenen.get(lijst[j].id) ?? new Set(); t.add(x); redenen.set(lijst[j].id, t); }
    }
  }
  const groepen = new Map<string, T[]>();
  for (const x of lijst) groepen.set(vind(x.id), [...(groepen.get(vind(x.id)) ?? []), x]);
  return [...groepen.values()].filter((g) => g.length > 1).map((leden) => ({ leden, redenen: [...new Set(leden.flatMap((l) => [...(redenen.get(l.id) ?? [])]))] }));
}

/** Waarom lijken deze twee contactpersonen op elkaar? Leeg als er niets op wijst. */
export function contactRedenen(a: { naam: string; email: string; telefoon: string }, b: { naam: string; email: string; telefoon: string }): string[] {
  const r: string[] = [];
  const ea = emailSleutel(a.email); const eb = emailSleutel(b.email);
  if (ea && ea === eb) r.push('zelfde e-mailadres');
  const ta = telefoonSleutel(a.telefoon); const tb = telefoonSleutel(b.telefoon);
  if (ta && ta === tb) r.push('zelfde telefoonnummer');
  const g = vergelijkNamen(a.naam, b.naam);
  if (g === 'gelijk') r.push('dezelfde naam');
  else if (g === 'bijna') r.push('bijna dezelfde naam (mogelijk een spelfout)');
  return r;
}

const GEMEENTE_VOORVOEGSEL = /^(gemeente|stad|dorp)\s+/;
const klantSleutel = (naam: string) => normaliseer(naam).replace(GEMEENTE_VOORVOEGSEL, '');

/** Is dit (bijna) dezelfde gemeentenaam als een bestaande klant? */
export function lijktOpBestaandeKlant(naam: string, bestaande: { naam: string; afasId?: string | null }[]): { naam: string }[] {
  const x = klantSleutel(naam);
  if (!x) return [];
  return bestaande.filter((k) => { const y = klantSleutel(k.naam); return x === y || (x.length >= 6 && y.length >= 6 && afstand(x, y) <= 1); });
}

export async function bepaalBevindingen(db: Db, filter: { klantId?: string; accountmanagerId?: string; soort?: BevindingSoort; metBesloten?: boolean } = {}): Promise<Bevinding[]> {
  const klantRijen = await db.select({ k: klanten, accountmanagerNaam: employees.naam }).from(klanten).leftJoin(employees, eq(klanten.accountmanagerId, employees.id)).orderBy(asc(klanten.naam));
  const besloten = new Set((await db.select({ s: kwaliteitBesluiten.sleutel }).from(kwaliteitBesluiten)).map((b) => b.s));
  const klantNaam = new Map(klantRijen.map((r) => [r.k.id, r.k.naam]));
  const amNaam = new Map(klantRijen.map((r) => [r.k.id, r.accountmanagerNaam]));
  const inFilter = (klantId: string) => (!filter.klantId || filter.klantId === klantId) && (!filter.accountmanagerId || klantRijen.find((r) => r.k.id === klantId)?.k.accountmanagerId === filter.accountmanagerId);
  const uit: Bevinding[] = [];
  const voeg = (b: Omit<Bevinding, 'sleutel' | 'besloten' | 'klantNaam' | 'accountmanagerNaam'> & { ids: string[] }) => {
    if (filter.soort && b.soort !== filter.soort) return;
    const { ids, ...rest } = b;
    const sleutel = sleutelVan(b.soort, ids);
    const isBesloten = besloten.has(sleutel);
    if (isBesloten && !filter.metBesloten) return;
    uit.push({ ...rest, sleutel, besloten: isBesloten, klantNaam: klantNaam.get(b.klantId) ?? '', accountmanagerNaam: amNaam.get(b.klantId) ?? null });
  };

  // ── Contactpersonen
  const contactRijen = await db.select().from(klantContacten).orderBy(asc(klantContacten.createdAt));
  const gebruikActiv = await db.select({ id: activiteiten.contactId, n: sql<number>`count(*)::int` }).from(activiteiten).where(sql`${activiteiten.contactId} is not null`).groupBy(activiteiten.contactId);
  const gebruikDebrief = await db.select({ id: consultantDebriefContacten.contactId, n: sql<number>`count(*)::int` }).from(consultantDebriefContacten).groupBy(consultantDebriefContacten.contactId);
  const gebruik = new Map<string, number>();
  for (const g of [...gebruikActiv, ...gebruikDebrief]) if (g.id) gebruik.set(g.id, (gebruik.get(g.id) ?? 0) + g.n);
  const item = (c: typeof contactRijen[number]): ContactItem => ({
    id: c.id, naam: c.naam, functie: c.functie, rol: c.rol, email: c.email, telefoon: c.telefoon, aangemaakt: c.createdAt.toISOString(), bron: c.callId ? 'gesprek' : 'handmatig', gebruik: gebruik.get(c.id) ?? 0,
  });
  const perKlant = new Map<string, typeof contactRijen>();
  for (const c of contactRijen) perKlant.set(c.klantId, [...(perKlant.get(c.klantId) ?? []), c]);
  for (const [klantId, lijst] of perKlant) {
    if (!inFilter(klantId)) continue;
    // Vergelijk met wat er feitelijk staat: een e-mailadres of telefoonnummer in het naamveld telt mee als e-mail of telefoon.
    const effectief = (c: typeof lijst[number]) => { const s = splitsNaam(c.naam); return { id: c.id, naam: s?.naam || c.naam, email: c.email || s?.email || '', telefoon: c.telefoon || s?.telefoon || '' }; };
    const vlak = lijst.map(effectief);
    for (const g of groepeer(vlak, (a, b) => contactRedenen(a, b))) {
      voeg({ soort: 'dubbel_contact', ernst: 'hoog', klantId, ids: g.leden.map((l) => l.id), contacten: g.leden.map((l) => item(lijst.find((c) => c.id === l.id)!)),
        uitleg: `Mogelijk dezelfde persoon: ${g.redenen.join(', ')}. Voeg samen als het dezelfde persoon is.` });
    }
    for (const c of lijst) {
      const gesplitst = splitsNaam(c.naam);
      if (gesplitst) {
        voeg({ soort: 'gegevens_in_naam', ernst: 'hoog', klantId, ids: [c.id], contacten: [item(c)],
          voorstel: { contactId: c.id, naam: gesplitst.naam || c.naam, ...(gesplitst.email && !c.email ? { email: gesplitst.email } : {}), ...(gesplitst.telefoon && !c.telefoon ? { telefoon: schoonTelefoon(gesplitst.telefoon) } : {}) },
          uitleg: 'Er staat een e-mailadres of telefoonnummer in het naamveld. Zet het in het juiste veld.' });
        continue;
      }
      if (naamDelen(c.naam).length < 2) voeg({ soort: 'naam_onvolledig', ernst: 'laag', klantId, ids: [c.id], contacten: [item(c)], uitleg: 'Alleen een voornaam of achternaam; vul de volledige naam aan als die bekend is.' });
      const email = c.email.trim();
      const tel = c.telefoon.trim();
      const telVoorstel = tel && schoonTelefoon(tel) !== tel ? schoonTelefoon(tel) : null;
      const emailFout = !!email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
      const telFout = !!tel && telefoonSleutel(tel) === null;
      if (emailFout || telFout || telVoorstel) {
        voeg({ soort: 'contact_formaat', ernst: 'laag', klantId, ids: [c.id], contacten: [item(c)], ...(telVoorstel ? { voorstel: { contactId: c.id, telefoon: telVoorstel } } : {}),
          uitleg: emailFout ? 'Het e-mailadres lijkt niet te kloppen.' : telFout ? 'Het telefoonnummer lijkt niet compleet.' : 'Het telefoonnummer staat in een afwijkende schrijfwijze.' });
      }
      if (!c.functie.trim() && !c.rol.trim()) voeg({ soort: 'contact_onvolledig', ernst: 'laag', klantId, ids: [c.id], contacten: [item(c)], uitleg: 'Functie en rol ontbreken.' });
    }
  }

  // ── Klanten (over alle gemeenten heen)
  if (!filter.klantId && !filter.accountmanagerId) {
    const [contactAantal, puntAantal] = await Promise.all([
      db.select({ id: klantContacten.klantId, n: sql<number>`count(*)::int` }).from(klantContacten).groupBy(klantContacten.klantId),
      db.select({ id: activiteiten.klantId, n: sql<number>`count(*)::int` }).from(activiteiten).where(sql`${activiteiten.klantId} is not null`).groupBy(activiteiten.klantId),
    ]);
    const nc = new Map(contactAantal.map((r) => [r.id, r.n])); const np = new Map(puntAantal.map((r) => [r.id!, r.n]));
    const kl = klantRijen.map((r) => r.k);
    for (const g of groepeer(kl, (a, b) => {
      const r: string[] = [];
      const x = klantSleutel(a.naam); const y = klantSleutel(b.naam);
      if (x && x === y) r.push('dezelfde naam');
      else if (x.length >= 6 && y.length >= 6 && afstand(x, y) <= 1) r.push('bijna dezelfde naam');
      return r;
    })) {
      voeg({ soort: 'dubbele_klant', ernst: 'hoog', klantId: g.leden[0].id, ids: g.leden.map((l) => l.id),
        klanten: g.leden.map((k) => ({ id: k.id, naam: k.naam, status: k.status, afasId: k.afasId, aantalContacten: nc.get(k.id) ?? 0, aantalPunten: np.get(k.id) ?? 0 })),
        uitleg: `Mogelijk dezelfde gemeente: ${g.redenen.join(', ')}. Een beheerder voegt ze samen op de klantpagina als het dezelfde is.` });
    }
  }

  // ── Open punten die op elkaar lijken, per gemeente
  const punten = await db.select({ a: activiteiten, eigenaarNaam: employees.naam }).from(activiteiten).leftJoin(employees, eq(activiteiten.eigenaarId, employees.id))
    .where(and(eq(activiteiten.status, 'open'), sql`${activiteiten.klantId} is not null`)).orderBy(asc(activiteiten.createdAt));
  const puntPerKlant = new Map<string, typeof punten>();
  for (const p of punten) puntPerKlant.set(p.a.klantId!, [...(puntPerKlant.get(p.a.klantId!) ?? []), p]);
  for (const [klantId, lijst] of puntPerKlant) {
    if (!inFilter(klantId)) continue;
    const vlak = lijst.map((p) => ({ id: p.a.id, ...p }));
    for (const g of groepeer(vlak, (x, y) => (x.a.soort === y.a.soort && lijktOpBestaand(x.a.omschrijving, [y.a.omschrijving]) ? ['lijkt inhoudelijk op elkaar'] : []))) {
      voeg({ soort: 'dubbele_activiteit', ernst: 'hoog', klantId, ids: g.leden.map((l) => l.id),
        activiteiten: g.leden.map((l) => ({ id: l.a.id, soort: l.a.soort, omschrijving: l.a.omschrijving, eigenaar: l.eigenaarNaam ?? l.a.eigenaarExtern, deadline: l.a.deadline, aangemaakt: l.a.createdAt.toISOString(), bron: l.a.bron, metCitaat: !!l.a.citaat })),
        uitleg: 'Deze open punten lijken op elkaar. Houd het beste over en verwijder de rest.' });
    }
  }

  const volgorde = (b: Bevinding) => (b.ernst === 'hoog' ? 0 : 1);
  return uit.sort((a, b) => volgorde(a) - volgorde(b) || a.klantNaam.localeCompare(b.klantNaam, 'nl') || a.soort.localeCompare(b.soort));
}

export async function bewaarBesluit(db: Db, sleutel: string, soort: string, door: string | null): Promise<void> {
  await db.insert(kwaliteitBesluiten).values({ sleutel, soort, door }).onConflictDoNothing();
}
export async function verwijderBesluit(db: Db, sleutel: string): Promise<boolean> {
  return (await db.delete(kwaliteitBesluiten).where(eq(kwaliteitBesluiten.sleutel, sleutel)).returning({ s: kwaliteitBesluiten.sleutel })).length > 0;
}

/** Bestaande contactpersonen van een klant die op deze (nog te bewaren) contactpersoon lijken. Gebruikt om dubbelen te voorkomen bij het toevoegen. */
export async function zoekMogelijkeDubbelen(db: Db | Tx, klantId: string, kandidaat: { naam: string; email?: string; telefoon?: string }, behalveId?: string) {
  const rijen = await db.select().from(klantContacten).where(and(eq(klantContacten.klantId, klantId), behalveId ? ne(klantContacten.id, behalveId) : undefined));
  return rijen.filter((c) => contactRedenen({ naam: kandidaat.naam, email: kandidaat.email ?? '', telefoon: kandidaat.telefoon ?? '' }, c).length > 0);
}

export interface SamenvoegUitkomst { behouden: string; samengevoegd: number; aangevuld: string[]; conflicten: string[] }

/**
 * Voegt contactpersonen van dezelfde gemeente samen in één: lege velden van het behouden contact worden aangevuld, bestaande waarden worden nooit overschreven
 * (een afwijkende waarde komt in `conflicten`), en alles wat naar de samengevoegde personen wees (punten, debriefs, sessies, implementaties) wijst daarna naar het behouden contact.
 */
export async function voegContactenSamen(db: Db, behoudId: string, verwijderIds: string[]): Promise<SamenvoegUitkomst | { fout: string; code: 400 | 404 }> {
  const ids = [...new Set(verwijderIds)].filter((i) => i !== behoudId);
  if (!ids.length) return { fout: 'Kies minstens één andere contactpersoon om samen te voegen', code: 400 };
  return db.transaction(async (tx) => {
    const rijen = await tx.select().from(klantContacten).where(inArray(klantContacten.id, [behoudId, ...ids])).for('update');
    const behoud = rijen.find((r) => r.id === behoudId);
    if (!behoud || rijen.length !== ids.length + 1) return { fout: 'Contactpersoon niet gevonden', code: 404 as const };
    if (rijen.some((r) => r.klantId !== behoud.klantId)) return { fout: 'Alleen contactpersonen van dezelfde gemeente kunnen worden samengevoegd', code: 400 as const };
    const aangevuld: string[] = []; const conflicten: string[] = [];
    const nieuw = { functie: behoud.functie, rol: behoud.rol, email: behoud.email, telefoon: behoud.telefoon, callId: behoud.callId };
    for (const r of rijen.filter((x) => x.id !== behoudId)) {
      for (const veld of ['functie', 'rol', 'email', 'telefoon'] as const) {
        if (!r[veld].trim()) continue;
        if (!nieuw[veld].trim()) { nieuw[veld] = r[veld]; aangevuld.push(veld); }
        else if (normaliseer(nieuw[veld]) !== normaliseer(r[veld])) conflicten.push(`${veld}: ${r[veld]}`);
      }
      if (!nieuw.callId && r.callId) nieuw.callId = r.callId;
    }
    await tx.update(klantContacten).set(nieuw).where(eq(klantContacten.id, behoudId));
    await tx.update(activiteiten).set({ contactId: behoudId }).where(inArray(activiteiten.contactId, ids));
    await tx.update(samenverderSessies).set({ contactpersoonId: behoudId }).where(inArray(samenverderSessies.contactpersoonId, ids));
    await tx.update(implementaties).set({ contactpersoonId: behoudId }).where(inArray(implementaties.contactpersoonId, ids));
    // De koppeling met debriefs heeft een samengestelde sleutel: eerst de nieuwe koppelingen leggen (dubbelen negeren), dan de oude laten verdwijnen met het contact.
    const gekoppeld = await tx.select({ debriefId: consultantDebriefContacten.debriefId }).from(consultantDebriefContacten).where(inArray(consultantDebriefContacten.contactId, ids));
    for (const g of gekoppeld) await tx.insert(consultantDebriefContacten).values({ debriefId: g.debriefId, contactId: behoudId }).onConflictDoNothing();
    await tx.delete(klantContacten).where(inArray(klantContacten.id, ids));
    return { behouden: behoudId, samengevoegd: ids.length, aangevuld: [...new Set(aangevuld)], conflicten };
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

const uuid = z.string().uuid();

/** Alleen beheerder en accountmanager (zie rollen.ts). De accountmanager is degene die opschoont en verbetert. */
export function registreerKwaliteit(app: FastifyInstance, db: Db, wie: (req: FastifyRequest) => string | null) {
  app.get('/api/kwaliteit', async (req) => {
    const q = z.object({
      klantId: uuid.optional(), accountmanagerId: uuid.optional(), soort: z.enum(BEVINDING_SOORTEN).optional(), besloten: z.enum(['0', '1']).optional(),
    }).parse(req.query);
    const bevindingen = await bepaalBevindingen(db, { klantId: q.klantId, accountmanagerId: q.accountmanagerId, soort: q.soort, metBesloten: q.besloten === '1' });
    const perSoort: Record<string, number> = {};
    for (const b of bevindingen) if (!b.besloten) perSoort[b.soort] = (perSoort[b.soort] ?? 0) + 1;
    return { bevindingen, perSoort, totaal: Object.values(perSoort).reduce((a, b) => a + b, 0) };
  });

  app.post('/api/kwaliteit/besluiten', async (req) => {
    const b = z.object({ sleutel: z.string().regex(/^[a-z_]+:[0-9a-f]{24}$/), soort: z.enum(BEVINDING_SOORTEN) }).parse(req.body);
    await bewaarBesluit(db, b.sleutel, b.soort, wie(req));
    return { ok: true };
  });
  app.post('/api/kwaliteit/besluiten/terugdraaien', async (req, reply) => {
    const b = z.object({ sleutel: z.string().regex(/^[a-z_]+:[0-9a-f]{24}$/) }).parse(req.body);
    return (await verwijderBesluit(db, b.sleutel)) ? { ok: true } : reply.code(404).send({ fout: 'Besluit niet gevonden' });
  });

  app.post('/api/klant-contacten/samenvoegen', async (req, reply) => {
    const b = z.object({ behoudId: uuid, verwijderIds: z.array(uuid).min(1).max(10) }).parse(req.body);
    const uitkomst = await voegContactenSamen(db, b.behoudId, b.verwijderIds);
    return 'fout' in uitkomst ? reply.code(uitkomst.code).send({ fout: uitkomst.fout }) : uitkomst;
  });
}
