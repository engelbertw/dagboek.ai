/**
 * Variant `project` van de consultantdebrief: werk binnen een project bij een gemeente. Alleen configuratie; de verwerking staat in consultant-debrief.ts.
 * Het model geeft hoogstens de fase, een scopewijziging en de volgende mijlpaal terug, elk met de woorden van de consultant als bewijs.
 * Een project wordt nooit aangemaakt door een gesprek: wat niet te koppelen is komt onder Controle nodig.
 */
import { z } from 'zod';
import type { VariantConfig } from './consultant-varianten.js';
import { citaatKomtVoor } from './vertrouwen.js';

const tekst = (max: number) => z.string().max(max).nullish().transform((v) => v ?? '');

export const PROJECT_FASEN = ['voorbereiding', 'uitvoering', 'oplevering', 'nazorg', 'afgerond'] as const;

export const projectSchema = z.object({
  onderwerp: z.object({ genoemd: tekst(200), bestaand: tekst(200) }).default({ genoemd: '', bestaand: '' }),
  fase: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(PROJECT_FASEN).nullish().transform((v) => v ?? null)).catch(null),
  fase_citaat: tekst(300),
  scope_wijziging: tekst(400),
  scope_citaat: tekst(300),
  volgende_mijlpaal: tekst(200),
  mijlpaal_citaat: tekst(300),
});

export const STANDAARD_PROJECT_VRAGEN = [
  '1. Project: over welk project bij welke gemeente gaat het, en wat is het doel ervan?',
  '2. Werkzaamheden: wat heb je gedaan?',
  '3. Resultaat: wat is er opgeleverd of bereikt?',
  '4. Besluiten en afspraken: wat is besloten, en met wie is wat afgesproken?',
  '5. Voortgang: in welke fase zit het project, en is de scope gewijzigd?',
  '6. Blokkades en afhankelijkheden: wat houdt de voortgang tegen, en wat moet eerst door een ander gebeuren?',
  '7. Risico\'s: wat kan de planning of de kwaliteit bedreigen?',
  '8. Vervolg: wat is de volgende mijlpaal of stap, wie doet wat, en wanneer?',
  '9. Gesprekspartners: met wie bij de gemeente heb je gesproken?',
].join('\n');

/** Een fase, scopewijziging of mijlpaal blijft alleen staan als de woorden van de consultant erbij in het gesprek staan. */
export function controleerProjectData(data: Record<string, unknown>, transcript: Parameters<typeof citaatKomtVoor>[1]): Record<string, unknown> {
  const d = projectSchema.parse(data);
  const bewijs = (c: string) => citaatKomtVoor(c, transcript);
  return {
    onderwerp: d.onderwerp,
    fase: d.fase && bewijs(d.fase_citaat) ? d.fase : null, fase_citaat: d.fase && bewijs(d.fase_citaat) ? d.fase_citaat : '',
    scope_wijziging: d.scope_wijziging && bewijs(d.scope_citaat) ? d.scope_wijziging : '', scope_citaat: d.scope_wijziging && bewijs(d.scope_citaat) ? d.scope_citaat : '',
    volgende_mijlpaal: d.volgende_mijlpaal && bewijs(d.mijlpaal_citaat) ? d.volgende_mijlpaal : '', mijlpaal_citaat: d.volgende_mijlpaal && bewijs(d.mijlpaal_citaat) ? d.mijlpaal_citaat : '',
  };
}

export const PROJECT_VARIANT: VariantConfig = {
  id: 'project',
  naam: 'project',
  promptVersie: 'consultant-project-v1',
  trefwoorden: ['project', 'projectdebrief'],
  standaardVragen: STANDAARD_PROJECT_VRAGEN,
  onderwerpType: 'project',
  promptAanvulling: 'geef {"onderwerp":{"genoemd":"naam van het project zoals de consultant het noemde","bestaand":"dezelfde naam precies zoals in <onderwerpen>, anders leeg"},"fase":"voorbereiding|uitvoering|oplevering|nazorg|afgerond of null","fase_citaat":"","scope_wijziging":"","scope_citaat":"","volgende_mijlpaal":"","mijlpaal_citaat":""}. Alleen wat de consultant zelf zei, elk met de letterlijke woorden als citaat; laat leeg of null als het niet is genoemd. Raad nooit welk project het is: staat het niet duidelijk in de lijst, laat "bestaand" dan leeg.',
  schema: projectSchema,
  controleer: controleerProjectData,
};
