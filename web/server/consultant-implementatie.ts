/**
 * Variant `implementatie` van de consultantdebrief: een module-implementatie bij een gemeente. Alleen configuratie en de regels voor wat het gesprek mag wijzigen.
 * - Automatisch bijgewerkt (met een citaat van de consultant): fase, teststatus en geplande livegang.
 * - Alleen als voorstel bewaard (variantdata), pas overgenomen na bevestiging in het scherm Onderwerp: werkelijke livegang, acceptatie en einde nazorg.
 * Acceptatie telt alleen met de woorden van de consultant zelf. Een implementatie wordt nooit door een gesprek aangemaakt.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { VariantConfig } from './consultant-varianten.js';
import { deadlineConcreet } from './debrief-gedeeld.js';
import { IMPLEMENTATIE_FASEN, TEST_STATUSSEN, implementaties } from './schema.js';
import { citaatKomtVoor, type Beurt } from './vertrouwen.js';

const tekst = (max: number) => z.string().max(max).nullish().transform((v) => v ?? '');
const kleinOf = <T extends readonly [string, ...string[]]>(waarden: T) => z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, '_') : v), z.enum(waarden).nullish().transform((v) => v ?? null)).catch(null);
const datum = z.string().max(20).nullish().transform((v) => v ?? null);

export const implementatieSchema = z.object({
  onderwerp: z.object({ genoemd: tekst(200), bestaand: tekst(200) }).default({ genoemd: '', bestaand: '' }),
  module: tekst(100),
  fase: kleinOf(IMPLEMENTATIE_FASEN), fase_citaat: tekst(300),
  test_status: kleinOf(TEST_STATUSSEN), test_citaat: tekst(300),
  geplande_livegang: datum, geplande_livegang_citaat: tekst(300),
  werkelijke_livegang: datum, werkelijke_livegang_citaat: tekst(300),
  acceptatie_op: datum, acceptatie_citaat: tekst(300),
  nazorg_tot: datum, nazorg_citaat: tekst(300),
});
export type ImplementatieData = z.infer<typeof implementatieSchema>;

/** Een geldige kalenderdatum (YYYY-MM-DD) of null. */
export function isoDatum(ruw: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ruw ?? '').trim());
  if (!m) return null;
  const d = new Date(`${m[0]}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === m[0] ? m[0] : null;
}

/** Een datum telt alleen met een citaat uit het gesprek dat een concrete datumaanduiding bevat ("volgende week" is geen datum voor een livegang). */
const bewezenDatum = (d: string | null, citaat: string, t: Beurt[]) => (isoDatum(d) && citaatKomtVoor(citaat, t) && deadlineConcreet(citaat) ? isoDatum(d) : null);

export function controleerImplementatieData(data: Record<string, unknown>, transcript: Beurt[]): Record<string, unknown> {
  const d = implementatieSchema.parse(data);
  const bewijs = (c: string) => citaatKomtVoor(c, transcript);
  const fase = d.fase && bewijs(d.fase_citaat) ? d.fase : null;
  const test = d.test_status && bewijs(d.test_citaat) ? d.test_status : null;
  const gepland = bewezenDatum(d.geplande_livegang, d.geplande_livegang_citaat, transcript);
  const werkelijk = bewezenDatum(d.werkelijke_livegang, d.werkelijke_livegang_citaat, transcript);
  const acceptatie = bewezenDatum(d.acceptatie_op, d.acceptatie_citaat, transcript);
  const nazorg = bewezenDatum(d.nazorg_tot, d.nazorg_citaat, transcript);
  return {
    onderwerp: d.onderwerp, module: d.module,
    fase, fase_citaat: fase ? d.fase_citaat : '', test_status: test, test_citaat: test ? d.test_citaat : '',
    geplande_livegang: gepland, geplande_livegang_citaat: gepland ? d.geplande_livegang_citaat : '',
    werkelijke_livegang: werkelijk, werkelijke_livegang_citaat: werkelijk ? d.werkelijke_livegang_citaat : '',
    acceptatie_op: acceptatie, acceptatie_citaat: acceptatie ? d.acceptatie_citaat : '',
    nazorg_tot: nazorg, nazorg_citaat: nazorg ? d.nazorg_citaat : '',
  };
}

export const STANDAARD_IMPLEMENTATIE_VRAGEN = [
  '1. Implementatie: welke module wordt bij welke gemeente geïmplementeerd?',
  '2. Werkzaamheden: wat heb je gedaan, bijvoorbeeld inrichten, testen, trainen of beheerders begeleiden?',
  '3. Fase: in welke fase zit de implementatie (voorbereiding, inrichting, test, acceptatie, ingebruikname of nazorg)?',
  '4. Test: is er getest, wat is de uitkomst, en wat moet nog opgelost worden?',
  '5. Acceptatie: heeft de gemeente akkoord gegeven? Vraag wie dat zei en wanneer, in de woorden van de consultant.',
  '6. Livegang: wanneer staat de livegang gepland, en is de module al in gebruik genomen?',
  '7. Blokkades en afhankelijkheden: wat houdt de voortgang tegen, en wat moet eerst door de gemeente of een leverancier gebeuren?',
  '8. Risico\'s: wat kan de livegang of de acceptatie bedreigen?',
  '9. Nazorg: is er nazorg afgesproken, tot wanneer, en wat is de eerstvolgende stap?',
  '10. Gesprekspartners: met wie bij de gemeente heb je gesproken?',
].join('\n');

/** Past alleen toe wat automatisch mag: fase, teststatus en geplande livegang. Alles anders blijft een voorstel in de debrief. */
export async function pasImplementatieToe(tx: Parameters<NonNullable<VariantConfig['toepassen']>>[0], topicId: string, data: Record<string, unknown>): Promise<void> {
  const d = data as Record<string, string | null>;
  const wijziging: Partial<typeof implementaties.$inferInsert> = {};
  if (d.fase) wijziging.fase = d.fase as typeof IMPLEMENTATIE_FASEN[number];
  if (d.test_status) wijziging.testStatus = d.test_status as typeof TEST_STATUSSEN[number];
  if (d.geplande_livegang) wijziging.geplandeLivegang = d.geplande_livegang;
  if (!Object.keys(wijziging).length) return;
  await tx.update(implementaties).set({ ...wijziging, bijgewerktOp: new Date() }).where(eq(implementaties.topicId, topicId));
}

export const IMPLEMENTATIE_VARIANT: VariantConfig = {
  id: 'implementatie',
  naam: 'module-implementatie',
  promptVersie: 'consultant-implementatie-v1',
  trefwoorden: ['implementatie', 'module implementatie', 'module'],
  standaardVragen: STANDAARD_IMPLEMENTATIE_VRAGEN,
  onderwerpType: 'implementatie',
  promptAanvulling: 'geef {"onderwerp":{"genoemd":"naam van de implementatie zoals de consultant die noemde","bestaand":"dezelfde naam precies zoals in <onderwerpen>, anders leeg"},"module":"","fase":"voorbereiding|inrichting|test|acceptatie|ingebruikname|nazorg|afgerond of null","fase_citaat":"","test_status":"niet_gestart|bezig|afgerond of null","test_citaat":"","geplande_livegang":"YYYY-MM-DD of null","geplande_livegang_citaat":"","werkelijke_livegang":"YYYY-MM-DD of null","werkelijke_livegang_citaat":"","acceptatie_op":"YYYY-MM-DD of null","acceptatie_citaat":"","nazorg_tot":"YYYY-MM-DD of null","nazorg_citaat":""}. Elk veld alleen als de consultant het zelf zei, met de letterlijke woorden van de consultant als citaat (een datum alleen met een echte datum in het citaat; "binnenkort" is geen datum). Acceptatie alleen als de consultant zegt dat de gemeente akkoord is gegaan: vul niets in op basis van de assistent of een vermoeden. Raad nooit welke implementatie het is: staat die niet duidelijk in de lijst, laat "bestaand" dan leeg.',
  schema: implementatieSchema,
  controleer: controleerImplementatieData,
  toepassen: pasImplementatieToe,
};
