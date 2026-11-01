/** De varianten die in productie beschikbaar zijn. Eén regel per fase; de schakelaar `consultant_debrief` blijft bepalen of ze gebruikt worden. */
import { registreerVariant } from './consultant-varianten.js';
import { PROJECT_VARIANT } from './consultant-project.js';
import { IMPLEMENTATIE_VARIANT } from './consultant-implementatie.js';
import { SAMENVERDER_VARIANT } from './consultant-samenverder.js';

export function registreerStandaardVarianten(): void {
  registreerVariant(PROJECT_VARIANT);
  registreerVariant(IMPLEMENTATIE_VARIANT);
  registreerVariant(SAMENVERDER_VARIANT);
}
