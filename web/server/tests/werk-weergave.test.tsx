import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Acties } from '../../client/src/pages/ActiviteitenLijst';
import { ControleBanner, PuntToevoegen, Punten, Secties, sorteerPunten } from '../../client/src/pages/ActiviteitenLijst';
import { Werk } from '../../client/src/pages/Werk';
import type { Activiteit, Medewerker } from '../../client/src/api';

const punt = (o: Partial<Activiteit>): Activiteit => ({
  id: Math.random().toString(36).slice(2), soort: 'actie', omschrijving: 'Offerte versturen', status: 'open', klantId: 'k1', klantNaam: 'Gemeente Goes', klantStatus: 'klant',
  eigenaarId: 'm1', eigenaarNaam: 'Daan van Hooft', eigenaarExtern: '', deadline: null, details: {}, citaat: '', controleNodig: false, controleReden: null,
  createdAt: '2026-10-01T10:00:00Z', afgerondOp: null, topicId: null, topicTitel: null, bron: 'gesprek', deadlineGewijzigdAantal: 0, jiraSleutel: null, jiraUrl: null, ...o,
});
const acties: Acties = {
  fout: null, jiraKlaar: true, jiraPaneel: null, zet: async () => {}, wijzig: async () => true, besluit: async () => {}, verwijder: async () => {}, voegToe: async () => true, jiraVoorbeeld: async () => {},
};
const medewerkers = [{ id: 'm1', naam: 'Daan van Hooft' }] as Medewerker[];
const html = (el: JSX.Element) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

describe('weergave van het werkregister', () => {
  it('toont per klant eerst wat gedaan moet worden, dan kansen en risico’s, en de context ingeklapt', () => {
    const uit = html(<Secties acties={acties} medewerkers={medewerkers} punten={[
      punt({ omschrijving: 'Hierarchie afnemen', soort: 'kans', details: { fase: 'offerte', indicatie_bedrag: '€ 12.000' } }),
      punt({ omschrijving: 'Contract opzeggen', soort: 'risico' }),
      punt({ omschrijving: 'Ruim 8 punten tevredenheid', soort: 'resultaat' }),
      punt({ omschrijving: 'Offerte laten maken', soort: 'intern', deadline: '2020-01-01' }),
    ]} />);
    expect(uit.indexOf('Te doen')).toBeLessThan(uit.indexOf('Kansen'));
    expect(uit.indexOf('Kansen')).toBeLessThan(uit.indexOf('Risico’s'));
    expect(uit.indexOf('Risico’s')).toBeLessThan(uit.indexOf('Context'));
    expect(uit).toContain('fase: offerte');
    expect(uit).toContain('Te laat');
    expect(uit).toContain('<details class="werk-sectie"><summary>Context');
    expect(uit).not.toContain('Gemeente Goes'); // de klantnaam staat niet bij elke regel
  });

  it('sorteert te laat bovenaan en afgerond onderaan, en toont de klantnaam alleen waar gevraagd', () => {
    const lijst = [punt({ omschrijving: 'a', status: 'afgerond' }), punt({ omschrijving: 'b' }), punt({ omschrijving: 'c', deadline: '2020-01-01' })];
    expect(sorteerPunten(lijst, '2026-10-30').map((p) => p.omschrijving)).toEqual(['c', 'b', 'a']);
    expect(html(<Punten punten={lijst} acties={acties} medewerkers={medewerkers} toonKlant />)).toContain('Gemeente Goes');
    expect(html(<Punten punten={[]} acties={acties} medewerkers={medewerkers} leeg="Niets." />)).toContain('Niets.');
  });

  it('toont de controle-banner met de reden en de juiste knoppen', () => {
    const uit = html(<ControleBanner acties={acties} punten={[punt({ controleNodig: true, controleReden: 'mogelijk_afgerond' }), punt({ controleNodig: true, controleReden: 'bron_niet_te_verifieren' })]} />);
    expect(uit).toContain('Controle nodig (2)');
    expect(uit).toContain('Afgerond'); expect(uit).toContain('Nog open'); expect(uit).toContain('Klopt'); expect(uit).toContain('Verwijderen');
    expect(html(<ControleBanner acties={acties} punten={[]} />)).toBe('');
  });

  it('rendert het toevoegknopje en de pagina zonder data zonder fout', () => {
    expect(html(<PuntToevoegen acties={acties} medewerkers={medewerkers} />)).toContain('Punt toevoegen');
    const uit = html(<Werk />);
    expect(uit).toContain('Per klant'); expect(uit).toContain('Alle punten'); expect(uit).toContain('Te laat');
  });
});
