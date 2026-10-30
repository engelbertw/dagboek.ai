import { describe, expect, it } from 'vitest';
import { MAX_PER_GESPREK, selecteerBelangrijk, teVaag, type Kandidaat } from '../kwaliteit.js';

const k = (soort: Kandidaat['soort'], omschrijving: string, extra: Partial<Kandidaat> = {}): Kandidaat => ({ soort, omschrijving, citaat: 'ja', ...extra });

describe('teVaag', () => {
  it('laat vage resultaten uit de praktijk weg', () => {
    expect(teVaag('Het proces is verder gekomen en er zijn stappen gemaakt', 'resultaat')).toBe(true);
    expect(teVaag('Het gesprek ging prima', 'resultaat')).toBe(true);
    expect(teVaag('Voortgang geboekt', 'resultaat')).toBe(true);
    expect(teVaag('OK', 'actie')).toBe(true);
  });

  it('houdt concrete punten', () => {
    expect(teVaag('Offerte sturen', 'actie')).toBe(false);
    expect(teVaag('Joël mailen met de vraag of hij een beter voorstel kan doen dan de huidige offerte voor hierarchie', 'actie')).toBe(false);
    expect(teVaag('Klant geeft een 8 voor de dienstverlening', 'resultaat')).toBe(false);
    expect(teVaag('Klant betaalt volgens eigen zeggen relatief veel en had veel vragen over de facturen', 'resultaat')).toBe(false);
  });

  it('vraagt van een kort doel of resultaat iets concreets', () => {
    expect(teVaag('Betere samenwerking', 'doel')).toBe(true);
    expect(teVaag('Besparen op Edwin', 'doel')).toBe(false);
    expect(teVaag('10 procent korting', 'doel')).toBe(false);
  });
});

describe('selecteerBelangrijk', () => {
  it('laat een doel dat bijna gelijk is aan een actie of kans vallen', () => {
    const r = selecteerBelangrijk([
      k('doel', 'Hierarchie afnemen met korting in 2026'),
      k('actie', 'Hierarchie afnemen met korting in 2026 voorbereiden'),
      k('kans', 'Nieuw AI-platform zonder structurele kosten aanbieden'),
    ]);
    expect(r.behouden.map((x) => x.soort)).toEqual(['actie', 'kans']);
    expect(r.weggelaten.dubbel).toBe(1);
  });

  it('kiest bij gelijke inhoud de soort waar het meest mee te doen valt', () => {
    const r = selecteerBelangrijk([k('resultaat', 'Archiefoplossing oppakken met PNS en Edwin'), k('actie', 'Archiefoplossing oppakken met PNS en Edwin')]);
    expect(r.behouden.map((x) => x.soort)).toEqual(['actie']);
  });

  it('laat een punt vallen dat al open staat bij de klant, ook onder een andere soort', () => {
    const r = selecteerBelangrijk([k('actie', 'Archiefoplossing oppakken met PNS en Edwin')], ['Archiefoplossing oppakken met PNS en Edwin in een driehoeksoverleg']);
    expect(r.behouden).toHaveLength(0);
  });

  it('houdt een maximum per soort aan en bewaart het best onderbouwde punt', () => {
    const acties = Array.from({ length: 8 }, (_, i) => k('actie', `Unieke taak nummer${i}x uitvoeren voor onderdeel${i}y`, { citaat: i === 7 ? 'wel een citaat' : '', eigenaar: i === 7 ? 'Ruben' : '' }));
    const r = selecteerBelangrijk(acties);
    expect(r.behouden).toHaveLength(MAX_PER_GESPREK.acties);
    expect(r.behouden.some((x) => x.omschrijving.includes('nummer7x'))).toBe(true);
    expect(r.weggelaten.teveel).toBe(3);
  });

  it('behoudt de volgorde van binnenkomst', () => {
    const r = selecteerBelangrijk([k('kans', 'Nieuw portaal aanbieden aan Voorbeeld'), k('actie', 'Offerte sturen naar mevrouw De Boer')]);
    expect(r.behouden.map((x) => x.soort)).toEqual(['kans', 'actie']);
  });

  it('geeft van het screenshot alleen de concrete punten terug', () => {
    const r = selecteerBelangrijk([
      k('actie', 'Een follow-up met nieuwe informatie naar de klant sturen', { eigenaar: 'Ruben Stuiver', deadline: '2026-11-06' }),
      k('resultaat', 'Het proces is verder gekomen en er zijn stappen gemaakt'),
      k('resultaat', 'Toelichting gegeven op de mogelijkheden en de tegemoetkoming aan de klant'),
      k('actie', 'De archiefoplossing oppakken met PNS en Edwin in een driehoeksoverleg', { eigenaar: 'Ruben Stuiver' }),
    ]);
    expect(r.behouden.map((x) => x.omschrijving)).toEqual([
      'Een follow-up met nieuwe informatie naar de klant sturen',
      'Toelichting gegeven op de mogelijkheden en de tegemoetkoming aan de klant',
      'De archiefoplossing oppakken met PNS en Edwin in een driehoeksoverleg',
    ]);
    expect(r.weggelaten.vaag).toBe(1);
  });
});
