import { describe, expect, it } from 'vitest';
import { kiesKlant, klantSleutel } from '../debrief-gedeeld.js';

describe('klantnaam vergelijken', () => {
  it('ziet "Gemeente X" en "X" als dezelfde klant', () => {
    expect(klantSleutel('Gemeente Bronckhorst')).toBe(klantSleutel('bronckhorst'));
    expect(klantSleutel('Gemeente')).toBe('gemeente');
    expect(klantSleutel('Gemeentewerf Zeist')).not.toBe(klantSleutel('Zeist'));
  });
  it('kiest de bestaande klant bij een andere schrijfwijze, en maakt geen nieuwe aan', () => {
    const bekende = [{ id: 'k1', naam: 'Gemeente Bronckhorst' }];
    const t = [{ role: 'user', content: 'Ik was bij Bronckhorst.' }];
    expect(kiesKlant('Bronckhorst', '', bekende, t)).toEqual({ klantId: 'k1', nieuweNaam: null });
    expect(kiesKlant('Gemeente Bronckhorst', '', [{ id: 'k2', naam: 'Bronckhorst' }], t)).toEqual({ klantId: 'k2', nieuweNaam: null });
  });
});
