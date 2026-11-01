/**
 * Variant `samenverder` van de consultantdebrief: een SamenVerder-dag (of dagdeel) bij een gemeente. Alleen configuratie en de regels voor wat het gesprek mag vastleggen.
 * - Het programma en de sessie worden alleen gekoppeld als ze eenduidig bestaan (gepland, recent, bij deze gemeente en deze consultant); anders Controle nodig. Er wordt niets aangemaakt.
 * - Het gesprek zet een sessie nooit op uitgevoerd en wijzigt nooit een omvang, datum of budget: wat de consultant daarover zegt blijft een voorstel in `variantdata.sessie_voorstel`.
 * - Een voorgesteld volgend onderwerp wordt als voorstel aan de eerstvolgende geplande sessie gehangen, met de sessie waarin het werd voorgesteld.
 * - Een samenwerkingssignaal wordt een risico met `details.categorie = 'samenwerking'` en altijd met een citaat; er komt nooit een score of oordeel.
 */
import { and, asc, eq, gte, gt, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { VariantConfig } from './consultant-varianten.js';
import { activiteiten, samenverderProgrammas, samenverderSessieConsultants, samenverderSessieOnderwerpen, samenverderSessies, SESSIE_SOORTEN } from './schema.js';
import { citaatKomtVoor, normaliseer, type Beurt } from './vertrouwen.js';

const tekst = (max: number) => z.string().max(max).nullish().transform((v) => v ?? '');
const janee = z.preprocess((v) => (typeof v === 'string' ? (['ja', 'true'].includes(v.trim().toLowerCase()) ? true : ['nee', 'false'].includes(v.trim().toLowerCase()) ? false : null) : v), z.boolean().nullish().transform((v) => v ?? null)).catch(null);
const dagtype = z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, '') : v), z.enum(SESSIE_SOORTEN).nullish().transform((v) => v ?? null)).catch(null);
const duur = z.number().gt(0).max(20).nullish().transform((v) => v ?? null).catch(null);

export const samenverderSchema = z.object({
  dagtype, dagtype_citaat: tekst(300),
  doel: tekst(500), doel_citaat: tekst(300),
  onderwerp: tekst(300), onderwerp_citaat: tekst(300),
  afgerond: janee, afgerond_citaat: tekst(300),
  sessie_voorstel: z.object({ uitgevoerd: janee, duur_dagen: duur, citaat: tekst(300) }).default({ uitgevoerd: null, duur_dagen: null, citaat: '' }),
  volgend_onderwerp: tekst(300), volgend_onderwerp_citaat: tekst(300),
  extra_sessie_nodig: janee, extra_sessie_citaat: tekst(300),
  evaluatie: tekst(1000), evaluatie_citaat: tekst(300),
  samenwerkingssignalen: z.array(z.object({ omschrijving: tekst(300), citaat: tekst(300) })).max(5).default([]),
});

/** Houdt van elk veld alleen over wat met de woorden van de consultant in het gesprek te bewijzen is. */
export function controleerSamenverderData(data: Record<string, unknown>, transcript: Beurt[]): Record<string, unknown> {
  const d = samenverderSchema.parse(data);
  const bewijs = (c: string) => citaatKomtVoor(c, transcript);
  const mits = <T>(waarde: T, citaat: string, leeg: T): [T, string] => (waarde !== leeg && bewijs(citaat) ? [waarde, citaat] : [leeg, '']);
  const [soort, soortC] = mits(d.dagtype, d.dagtype_citaat, null);
  const [doel, doelC] = mits(d.doel, d.doel_citaat, '');
  const [onderwerp, onderwerpC] = mits(d.onderwerp, d.onderwerp_citaat, '');
  const [afgerond, afgerondC] = mits(d.afgerond, d.afgerond_citaat, null);
  const [volgend, volgendC] = mits(d.volgend_onderwerp, d.volgend_onderwerp_citaat, '');
  const [extra, extraC] = mits(d.extra_sessie_nodig, d.extra_sessie_citaat, null);
  const [evaluatie, evaluatieC] = mits(d.evaluatie, d.evaluatie_citaat, '');
  const sv = d.sessie_voorstel;
  const voorstelBewezen = bewijs(sv.citaat) && (sv.uitgevoerd !== null || sv.duur_dagen !== null);
  return {
    dagtype: soort, dagtype_citaat: soortC, doel, doel_citaat: doelC, onderwerp, onderwerp_citaat: onderwerpC, afgerond, afgerond_citaat: afgerondC,
    sessie_voorstel: voorstelBewezen ? { uitgevoerd: sv.uitgevoerd, duur_dagen: sv.duur_dagen, citaat: sv.citaat } : { uitgevoerd: null, duur_dagen: null, citaat: '' },
    volgend_onderwerp: volgend, volgend_onderwerp_citaat: volgendC, extra_sessie_nodig: extra, extra_sessie_citaat: extraC, evaluatie, evaluatie_citaat: evaluatieC,
    samenwerkingssignalen: d.samenwerkingssignalen.filter((s) => s.omschrijving.trim() && bewijs(s.citaat)),
  };
}

export const STANDAARD_SAMENVERDER_VRAGEN = [
  '1. Sessie: bij welke gemeente was je, en wat voor dag was het (kickstart, uitvoeringsdag, online, tussenevaluatie of eindevaluatie)?',
  '2. Doel en onderwerp: wat was het doel van de dag en welk onderwerp is behandeld?',
  '3. Werkzaamheden: wat heb je gedaan?',
  '4. Resultaat: wat is er bereikt, en is het onderwerp afgerond?',
  '5. Besluiten en afspraken: wat is besloten, en met wie is wat afgesproken?',
  '6. Acties: wat moet de gemeente nog doen, wat moeten wij intern oppakken, en wanneer?',
  '7. Blokkades en risico\'s: wat houdt de voortgang tegen, en wat kan het programma bedreigen?',
  '8. Vervolg: welk onderwerp stel je voor als volgende, en is er een extra sessie nodig?',
  '9. Evaluatie: bij een tussen- of eindevaluatie, wat werd er geëvalueerd en wat kwam eruit?',
  '10. Samenwerking: is er iets in de samenwerking met de gemeente dat opvalt en dat je wilt vastleggen?',
  '11. Gesprekspartners: met wie bij de gemeente heb je gesproken?',
].join('\n');

const dagenTerug = (iso: string, n: number) => new Date(new Date(`${iso}T12:00:00Z`).getTime() - n * 86_400_000).toISOString().slice(0, 10);
/** Hoeveel dagen terug een geplande sessie nog bij een debrief kan horen (een consultant belt soms pas de volgende dag of na het weekend). */
const TERUGKIJKEN_DAGEN = 7;

export const koppelSamenverder: NonNullable<VariantConfig['koppel']> = async (tx, { klantId, employeeId, vandaag }) => {
  const programmas = await tx.select({ id: samenverderProgrammas.id }).from(samenverderProgrammas)
    .where(and(eq(samenverderProgrammas.klantId, klantId), eq(samenverderProgrammas.status, 'actief')));
  if (!programmas.length) return { programmaId: null, sessieId: null, reden: 'programma_onbekend' };
  const sessies = await tx.select({ id: samenverderSessies.id, programmaId: samenverderSessies.programmaId }).from(samenverderSessies)
    .where(and(inArray(samenverderSessies.programmaId, programmas.map((p) => p.id)), eq(samenverderSessies.status, 'gepland'),
      gte(samenverderSessies.datum, dagenTerug(vandaag, TERUGKIJKEN_DAGEN)), lte(samenverderSessies.datum, vandaag)));
  const toegewezen = sessies.length ? await tx.select().from(samenverderSessieConsultants).where(inArray(samenverderSessieConsultants.sessieId, sessies.map((s) => s.id))) : [];
  const eigen = sessies.filter((s) => toegewezen.some((t) => t.sessieId === s.id && t.employeeId === employeeId));
  const zonder = sessies.filter((s) => !toegewezen.some((t) => t.sessieId === s.id));
  const kandidaten = eigen.length ? eigen : zonder;
  const programmaIds = new Set(kandidaten.map((k) => k.programmaId));
  const programmaId = programmas.length === 1 ? programmas[0].id : programmaIds.size === 1 ? [...programmaIds][0] : null;
  if (kandidaten.length === 1) return { programmaId: kandidaten[0].programmaId, sessieId: kandidaten[0].id, reden: null };
  return { programmaId, sessieId: null, reden: programmaId ? 'sessie_onbekend' : 'programma_onbekend' };
};

export const bewaarSamenverderVoorstellen: NonNullable<VariantConfig['naOpslaan']> = async (tx, { klantId, callId, programmaId, sessieId, data }) => {
  const d = data as { volgend_onderwerp?: string; samenwerkingssignalen?: { omschrijving: string; citaat: string }[] };
  // Het volgende onderwerp hoort bij de eerstvolgende geplande sessie van hetzelfde programma; is die er niet, dan blijft het voorstel in de debrief staan.
  if (d.volgend_onderwerp && sessieId && programmaId) {
    const [huidige] = await tx.select({ datum: samenverderSessies.datum }).from(samenverderSessies).where(eq(samenverderSessies.id, sessieId));
    const volgende = huidige?.datum
      ? (await tx.select({ id: samenverderSessies.id }).from(samenverderSessies)
        .where(and(eq(samenverderSessies.programmaId, programmaId), eq(samenverderSessies.status, 'gepland'), gt(samenverderSessies.datum, huidige.datum)))
        .orderBy(asc(samenverderSessies.datum)).limit(1))[0]
      : undefined;
    if (volgende) {
      const bestaand = await tx.select({ titel: samenverderSessieOnderwerpen.titel }).from(samenverderSessieOnderwerpen).where(eq(samenverderSessieOnderwerpen.sessieId, volgende.id));
      if (!bestaand.some((b) => normaliseer(b.titel) === normaliseer(d.volgend_onderwerp!))) {
        await tx.insert(samenverderSessieOnderwerpen).values({ sessieId: volgende.id, titel: d.volgend_onderwerp.slice(0, 300), status: 'voorgesteld', voorgesteldInSessieId: sessieId });
      }
    }
  }
  for (const s of d.samenwerkingssignalen ?? []) {
    await tx.insert(activiteiten).values({
      klantId, soort: 'risico', omschrijving: s.omschrijving.trim().slice(0, 400), citaat: s.citaat.trim(), callId,
      details: { categorie: 'samenwerking' }, samenverderProgrammaId: programmaId, samenverderSessieId: sessieId,
    });
  }
};

export const SAMENVERDER_VARIANT: VariantConfig = {
  id: 'samenverder',
  naam: 'SamenVerder-dag',
  promptVersie: 'consultant-samenverder-v1',
  trefwoorden: ['samenverder', 'samen verder', 'samenverderdag', 'samenverder dag'],
  standaardVragen: STANDAARD_SAMENVERDER_VRAGEN,
  promptAanvulling: 'geef {"dagtype":"kickstart|uitvoering|online|tussenevaluatie|eindevaluatie of null","dagtype_citaat":"","doel":"","doel_citaat":"","onderwerp":"","onderwerp_citaat":"","afgerond":"ja|nee|null (is het onderwerp van de dag afgerond)","afgerond_citaat":"","sessie_voorstel":{"uitgevoerd":"ja|nee|null","duur_dagen":"getal of null (alleen als de consultant een duur noemde, een halve dag is 0.5)","citaat":""},"volgend_onderwerp":"","volgend_onderwerp_citaat":"","extra_sessie_nodig":"ja|nee|null","extra_sessie_citaat":"","evaluatie":"","evaluatie_citaat":"","samenwerkingssignalen":[{"omschrijving":"feitelijk, zonder oordeel of score","citaat":""}]}. Elk veld alleen als de consultant het zelf zei, met de letterlijke woorden van de consultant als citaat; laat leeg of null als het niet is genoemd. "sessie_voorstel" is alleen wat de consultant zegt over of de dag heeft plaatsgevonden en hoe lang; het is een voorstel en verandert niets aan de planning. Een samenwerkingssignaal is een concreet feit uit de samenwerking met de gemeente (bijvoorbeeld afspraken die niet worden nagekomen of juist een zeer actieve betrokkenheid), nooit een oordeel, cijfer of tevredenheid.',
  schema: samenverderSchema,
  controleer: controleerSamenverderData,
  koppel: koppelSamenverder,
  naOpslaan: bewaarSamenverderVoorstellen,
};
