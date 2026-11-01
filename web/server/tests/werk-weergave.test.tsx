import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Acties } from '../../client/src/pages/ActiviteitenLijst';
import { ControleBanner, PuntToevoegen, Punten, Secties, sorteerPunten } from '../../client/src/pages/ActiviteitenLijst';
import { Werk } from '../../client/src/pages/Werk';
import { VoorbereidingWeergave } from '../../client/src/pages/Voorbereiding';
import { Kaart } from '../../client/src/pages/Kwaliteit';
import { BudgetRegel } from '../../client/src/pages/Budget';
import type { Activiteit, Medewerker, Voorbereiding as VoorbereidingData } from '../../client/src/api';

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

describe('weergave van de bezoekvoorbereiding', () => {
  const data: VoorbereidingData = {
    klant: { id: 'k1', naam: 'Gemeente Goes', status: 'klant', samenwerkingsverband: 'BEL Combinatie', inwoners: 38000, contractEinde: '2027-01-01', accountmanagerNaam: 'Ruben', omschrijving: '' },
    contacten: [{ id: 'c1', naam: 'Mevrouw De Boer', functie: 'projectleider', rol: '', laatstGesproken: '2026-10-20T10:00:00Z' }],
    onderwerpen: [{ id: 't1', titel: 'Zaakgericht werken', type: 'project', status: 'actief', eigenaarNaam: 'Daan', laatsteUpdate: { datum: '2026-10-25T10:00:00Z', samenvatting: 'Zaaktypen ingericht', besluiten: 'Start test in november' }, bron: 'dagboek' }],
    samenverder: [{ id: 'p1', pakket: 'SamenVerder 2026', periodeVan: '2026-01-01', periodeTot: null, status: 'actief', aantalGepland: 2, aantalUitgevoerd: 3, volgendeSessie: '2026-12-01', laatsteSessie: '2026-10-20', budget: { beschikbaar: 12, uitgevoerd: 3, gepland: 2, nogNietGepland: 7, overschrijding: false }, laatsteSamenvatting: { datum: '2026-10-21T10:00:00Z', tekst: 'Zaaktypen besproken.' }, bron: 'werkregister' }],
    implementaties: [{ topicId: 't2', titel: 'Zaaksysteem uitrol', module: 'Zaken', fase: 'test', testStatus: 'bezig', status: 'actief', geplandeLivegang: '2026-12-01', werkelijkeLivegang: null, bron: 'werkregister' }],
    gesprekken: [{ soort: 'project', datum: '2026-10-20T10:00:00Z', samenvatting: 'Koppeling blokkeert de livegang.', door: 'Karin', bron: 'consultant-debrief' }],
    openPunten: [{ id: 'p1', soort: 'blokkade', omschrijving: 'Koppeling zaaksysteem', eigenaar: 'Karin', deadline: '2020-01-01', teLaat: true, onderwerp: 'Zaakgericht werken', datum: '2026-10-20T10:00:00Z', bron: 'werkregister' }],
    nietBevestigd: [{ soort: 'debrief', omschrijving: 'Onduidelijk project', reden: 'onderwerp_onbekend', datum: '2026-10-21T10:00:00Z', bron: 'consultant-debrief' }],
  };
  it('toont elk onderdeel met bron en zet het niet-bevestigde apart', () => {
    const uit = html(<VoorbereidingWeergave data={data} />);
    for (const t of ['SamenVerder (1)', 'SamenVerder 2026', '3 uitgevoerd, 2 gepland', 'Zaaktypen besproken.', 'Implementaties (1)', 'Zaaksysteem uitrol', 'Test', 'livegang gepland', 'Kerngegevens', 'BEL Combinatie', 'Mevrouw De Boer', 'laatst gesproken', 'Zaakgericht werken', 'Start test in november', 'Projectdebrief', 'consultantdebrief', 'Blokkade (1)', 'te laat', 'Niet bevestigd (1)', 'Het project is niet herkend']) expect(uit).toContain(t);
    expect(uit.indexOf('Openstaande punten')).toBeLessThan(uit.indexOf('Niet bevestigd'));
  });
  it('toont lege staten en laat het blok Niet bevestigd weg als er niets is', () => {
    const uit = html(<VoorbereidingWeergave data={{ ...data, contacten: [], onderwerpen: [], samenverder: [], implementaties: [], gesprekken: [], openPunten: [], nietBevestigd: [] }} />);
    for (const t of ['Nog geen contactpersonen', 'Geen onderwerpen', 'Nog geen bezoeken', 'Geen openstaande punten']) expect(uit).toContain(t);
    expect(uit).not.toContain('Niet bevestigd');
    expect(uit).not.toContain('Implementaties');
    expect(uit).not.toContain('SamenVerder');
  });
});

describe('weergave van de kwaliteitsmeldingen', () => {
  const contact = (o: Record<string, unknown>) => ({ id: Math.random().toString(36).slice(2), naam: 'Edwin Muntinga', functie: '', rol: '', email: '', telefoon: '', aangemaakt: '2026-10-01T10:00:00Z', bron: 'gesprek' as const, gebruik: 0, ...o });
  const geen = () => {};
  it('toont dubbele contactpersonen naast elkaar met samenvoegen en een LinkedIn-zoeklink', () => {
    const uit = html(<Kaart b={{ sleutel: 'dubbel_contact:abc', soort: 'dubbel_contact', ernst: 'hoog', klantId: 'k1', klantNaam: 'Aa en Hunze', accountmanagerNaam: 'Ruben', uitleg: 'Mogelijk dezelfde persoon: bijna dezelfde naam.', besloten: false,
      contacten: [contact({ naam: 'Edwin Muntinga', email: 'e@x.nl', gebruik: 2 }), contact({ naam: 'Edwin Mentenga' })] }} ververs={geen} fout={geen} />);
    for (const t of ['Dubbele contactpersonen', 'Aa en Hunze', 'accountmanager Ruben', 'Edwin Mentenga', 'Behoud deze, voeg de rest samen', 'Dit zijn verschillende', '2× gekoppeld', 'uit een gesprek']) expect(uit).toContain(t);
    expect(uit).toContain('https://www.linkedin.com/search/results/people/?keywords=Edwin%20Muntinga%20Aa%20en%20Hunze');
    expect(uit).toContain('rel="noopener noreferrer"');
  });
  it('toont een voorstel om gegevens uit het naamveld te halen, en laat een besloten melding terugzetten', () => {
    const uit = html(<Kaart b={{ sleutel: 'gegevens_in_naam:abc', soort: 'gegevens_in_naam', ernst: 'hoog', klantId: 'k1', klantNaam: 'Aa en Hunze', accountmanagerNaam: null, uitleg: 'x', besloten: true,
      contacten: [contact({ naam: 'Edwin Muntinga e@x.nl' })], voorstel: { contactId: 'c1', naam: 'Edwin Muntinga', email: 'e@x.nl' } }} ververs={geen} fout={geen} />);
    expect(uit).toContain('Toepassen');
    expect(uit).toContain('Weer tonen');
    expect(uit).not.toContain('Geen probleem');
  });
});

describe('weergave van het dagenbudget', () => {
  it('toont de vier begrippen en gebruikt nergens het woord resterend', () => {
    const uit = html(<BudgetRegel budget={{ beschikbaar: 10, uitgevoerd: 3, gepland: 2.5, nogNietGepland: 4.5, overschrijding: false }} />);
    expect(uit).toContain('Afgesproken'); expect(uit).toContain('uitgevoerd'); expect(uit).toContain('gepland'); expect(uit).toContain('nog niet gepland');
    expect(uit).toContain('2,5 dagen');
    expect(uit.toLowerCase()).not.toContain('resterend');
  });

  it('toont een overschrijding en een lege staat', () => {
    expect(html(<BudgetRegel budget={{ beschikbaar: 2, uitgevoerd: 2, gepland: 1.5, nogNietGepland: -1.5, overschrijding: true }} />)).toContain('overschrijding van 1,5 dagen');
    expect(html(<BudgetRegel budget={{ beschikbaar: 0, uitgevoerd: 0, gepland: 0, nogNietGepland: 0, overschrijding: false }} />)).toContain('Nog geen dagenbudget vastgelegd');
  });
});
