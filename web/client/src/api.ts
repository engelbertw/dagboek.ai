export type Rol = 'medewerker' | 'accountmanager';
export interface ImportRegel { naam: string; telefoon: string; email: string; status: 'nieuw' | 'bestaat_al' | 'dubbel_in_lijst' | 'ongeldig'; reden?: string }
export interface KlantenImportUitkomst {
  gemeenten: { naam: string; status: 'nieuw' | 'bestaat_al'; velden: { samenwerkingsverband: string; inwoners: number | null; salesAm: string; contractEinde: string | null }; contacten: { naam: string; functie: string; rol: string; email: string; telefoon: string; status: 'nieuw' | 'bestaat_al' }[] }[];
  fouten: string[]; toegevoegd: { gemeenten: number; contacten: number; bijgewerkt: number };
}
export interface ImportUitkomst { regels: ImportRegel[]; toegevoegd: number }
export interface Medewerker { id: string; naam: string; telefoon: string; email: string; locgovGebruikersnaam: string; taal: 'nl' | 'en'; actief: boolean; toestemmingOp: string | null; notitie: string; rol: Rol; consultant?: boolean }
export interface Project { id: string; naam: string; omschrijving: string; status: 'actief' | 'afgerond' }
export type TopicStatus = 'actief' | 'wacht' | 'afgerond';
export type TopicType = 'project' | 'thema' | 'taak';
export interface TopicRegel {
  id: string; titel: string; type: TopicType; status: TopicStatus; aanwijzingen: string; projectId: string | null; projectNaam: string | null;
  eigenaarId: string | null; eigenaarNaam: string | null; klantId: string | null; klantNaam: string | null; updatedAt: string; afgerondOp: string | null; openPunten: number;
  laatsteUpdate: { samenvatting: string; createdAt: string } | null;
}
export interface Update { id: string; topicId: string; bron: 'voice' | 'handmatig'; samenvatting: string; besluiten: string; createdAt: string; bewerktOp: string | null }
export interface OpenPunt { id: string; tekst: string; status: 'open' | 'afgerond'; createdAt: string; afgerondOp: string | null; eigenaarId: string | null; eigenaarExtern: string; deadline: string | null }
export interface Actie { id: string; tekst: string; soort?: string; topicId: string | null; topicTitel: string | null; klantId?: string | null; klantNaam?: string | null; eigenaarId: string | null; eigenaarNaam: string | null; eigenaarExtern: string; deadline: string | null; status: 'open' | 'afgerond'; createdAt: string; afgerondOp: string | null; controleNodig?: boolean; controleReden?: string | null; jiraSleutel?: string | null; jiraUrl?: string | null }
export interface Stand { open: number; teLaat: number; binnenkort: number; zonderDeadline: number; opTijd: number; laatAfgerond: number; deadlineVerschoven: number }
export interface Team { nakoming: number | null; basis: number; onvoldoendeGegevens: boolean; minimum: number }
export interface DashboardData { vandaag: string; totaal: Stand; team: Team; perEigenaar: (Stand & { id: string | null; naam: string })[]; teLaat: Actie[]; binnenkort: Actie[] }
export interface Suggestie { id: string; soort: 'onderwerp' | 'verbetering'; tekst: string; status: 'nieuw' | 'overgenomen' | 'afgewezen' | 'klaar'; createdAt: string; employeeId: string | null; employeeNaam: string | null; topicId: string | null }
export interface Houding { waarde: string; standaard: boolean }
export const vandaagIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
export const deadlineTekst = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'geen deadline');
export interface TopicDetail {
  id: string; titel: string; type: TopicType; status: TopicStatus; aanwijzingen: string; projectId: string | null; eigenaarId: string | null; klantId: string | null;
  updates: Update[]; openItems: OpenPunt[];
}
export interface Historie { id: string; vorigeSamenvatting: string; vorigeBesluiten: string; gewijzigdOp: string }
export interface Planning { id: string; naam: string; dagen: number[]; tijden: string[]; actief: boolean; maxPogingen: number; employeeIds: string[]; gespreksinstructie: string | null }
export type CallStatus = 'gepland' | 'verzenden' | 'onderbroken' | 'belt' | 'gesprek' | 'gesproken' | 'niet_bereikt' | 'voicemail' | 'mislukt';
export type SamenvattingStatus = 'geen' | 'bezig' | 'klaar' | 'geen_inhoud' | 'geweigerd' | 'onduidelijk' | 'mislukt';
export type Motor = 'pipecat' | 'elevenlabs_agent';
export const MOTOR_LABEL: Record<Motor, string> = { pipecat: 'Pipecat (huidig)', elevenlabs_agent: 'ElevenLabs-agent' };
export type GesprekType = 'dagboek' | 'verkoop_debrief' | 'consultant_debrief' | 'debrief_keuze';
export type DebriefVariant = 'project' | 'implementatie' | 'samenverder';
export interface GesprekRegel { type?: GesprekType; routeBron?: string | null; variant?: DebriefVariant | null; variantBron?: string | null; heeftTranscript: boolean; transcriptGewist: boolean; engine: Motor | null; beoordeling: number | null; beoordelingOpmerking: string | null; id: string; status: CallStatus; bron: string; fout: string | null; samenvattingStatus: SamenvattingStatus; samenvattingFout: string | null; gestartOp: string | null; afgerondOp: string | null; createdAt: string; employeeId: string; employeeNaam: string }
export interface Gesprek extends GesprekRegel { transcript: { role: string; content: string }[] | null }

export class ApiFout extends Error {
  constructor(public status: number, message: string, public details: string[] = []) { super(message); }
}

export async function api<T>(method: string, pad: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api${pad}`, {
    method, credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiFout(r.status, data.fout ?? `Fout ${r.status}`, data.details ?? []);
  return data as T;
}

export const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const datumTijd = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
export const DAGEN = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
export interface JiraInstelling { site: string; project: string; issuetype: string; teamId: string; inloggegevens: boolean; geconfigureerd: boolean }
export interface JiraUitkomst { id: string; status: 'voorbeeld' | 'aangemaakt' | 'gekoppeld' | 'overgeslagen' | 'fout'; reden?: string; sleutel?: string; url?: string; samenvatting?: string; eigenaar?: string | null; deadline?: string | null; project?: string }

export type KlantStatus = 'prospect' | 'klant' | 'voorgesteld' | 'inactief';
export const KLANT_STATUS_LABEL: Record<KlantStatus, string> = { prospect: 'Prospect', klant: 'Klant', voorgesteld: 'Voorgesteld (controle)', inactief: 'Inactief' };
export type ActiviteitSoort = 'doel' | 'resultaat' | 'afspraak' | 'actie' | 'intern' | 'kans' | 'risico' | 'besluit' | 'blokkade' | 'afhankelijkheid' | 'vervolgsignaal';
export const SOORT_LABEL: Record<ActiviteitSoort, string> = { doel: 'Doel', resultaat: 'Resultaat', afspraak: 'Afspraak', actie: 'Actie', intern: 'Intern', kans: 'Kans', risico: 'Risico', besluit: 'Besluit', blokkade: 'Blokkade', afhankelijkheid: 'Afhankelijkheid', vervolgsignaal: 'Vervolgsignaal' };
export interface KlantRegel { id: string; naam: string; status: KlantStatus; bron: string; accountmanagerId: string | null; accountmanagerNaam: string | null; contractEinde: string | null; bijgewerktOp: string; openActiviteiten: number; laatsteBezoek: string | null; samenwerkingsverband: string; inwoners: number | null; salesAm: string }
export interface Klant { id: string; naam: string; status: KlantStatus; bron: string; accountmanagerId: string | null; omschrijving: string; contractEinde: string | null; afasId: string | null; samenwerkingsverband: string; inwoners: number | null; salesAm: string }
export interface KlantContact { id: string; naam: string; functie: string; rol: string; email: string; telefoon: string }
export interface Bezoek { id: string; datum: string | null; soort: string; tevredenheid: number | null; samenvatting: string; callId: string | null; accountmanagerNaam: string | null; createdAt: string }
export interface Activiteit {
  id: string; soort: ActiviteitSoort; omschrijving: string; status: 'open' | 'afgerond'; klantId: string | null; klantNaam: string | null; klantStatus: KlantStatus | null;
  eigenaarId: string | null; eigenaarNaam: string | null; eigenaarExtern: string; deadline: string | null; details: Record<string, unknown>; citaat: string;
  controleNodig: boolean; controleReden: string | null; createdAt: string; afgerondOp: string | null;
  topicId: string | null; topicTitel: string | null; bron: 'handmatig' | 'gesprek'; deadlineGewijzigdAantal: number; jiraSleutel: string | null; jiraUrl: string | null;
}
export interface KlantDetail { klant: Klant; contacten: KlantContact[]; bezoeken: Bezoek[]; activiteiten: (Omit<Activiteit, 'klantNaam' | 'klantStatus' | 'eigenaarNaam' | 'topicTitel'> & { bezoekId: string | null })[] }
export interface DebriefVragen extends Houding { vorige: string }
export interface ContactRegel extends KlantContact { klantId: string; klantNaam: string }

/** Bezoekvoorbereiding per gemeente (alleen lezen); zie server/voorbereiding.ts. */
export interface Voorbereiding {
  klant: { id: string; naam: string; status: string; samenwerkingsverband: string; inwoners: number | null; contractEinde: string | null; accountmanagerNaam: string | null; omschrijving: string };
  contacten: { id: string; naam: string; functie: string; rol: string; laatstGesproken: string | null }[];
  onderwerpen: { id: string; titel: string; type: string; status: string; eigenaarNaam: string | null; laatsteUpdate: { datum: string; samenvatting: string; besluiten: string } | null; bron: string }[];
  samenverder: { id: string; pakket: string; periodeVan: string; periodeTot: string | null; status: string; aantalGepland: number; aantalUitgevoerd: number; volgendeSessie: string | null; laatsteSessie: string | null; laatsteSamenvatting: { datum: string; tekst: string } | null; bron: string }[];
  implementaties: { topicId: string; titel: string; module: string; fase: string; testStatus: string; status: string; geplandeLivegang: string | null; werkelijkeLivegang: string | null; bron: string }[];
  gesprekken: { soort: 'bezoek' | 'project' | 'implementatie' | 'samenverder' | 'consultant'; datum: string | null; samenvatting: string; door: string | null; bron: string }[];
  openPunten: { id: string; soort: string; omschrijving: string; eigenaar: string; deadline: string | null; teLaat: boolean; onderwerp: string | null; datum: string; bron: string }[];
  nietBevestigd: { soort: 'punt' | 'debrief'; omschrijving: string; reden: string | null; datum: string; bron: string }[];
}

export const IMPLEMENTATIE_FASEN = ['voorbereiding', 'inrichting', 'test', 'acceptatie', 'ingebruikname', 'nazorg', 'afgerond'] as const;
export const IMPLEMENTATIE_FASE_LABEL: Record<(typeof IMPLEMENTATIE_FASEN)[number], string> = { voorbereiding: 'Voorbereiding', inrichting: 'Inrichting', test: 'Test', acceptatie: 'Acceptatie', ingebruikname: 'Ingebruikname', nazorg: 'Nazorg', afgerond: 'Afgerond' };
export const TEST_STATUS_LABEL: Record<string, string> = { niet_gestart: 'Niet gestart', bezig: 'Bezig', afgerond: 'Afgerond' };
export interface Implementatie {
  topicId: string; module: string; bovenliggendTopicId: string | null; contactpersoonId: string | null; fase: (typeof IMPLEMENTATIE_FASEN)[number]; testStatus: string;
  geplandeLivegang: string | null; werkelijkeLivegang: string | null; acceptatieOp: string | null; acceptatieCitaat: string; nazorgTot: string | null;
}
export interface ImplementatieVoorstel { veld: 'werkelijkeLivegang' | 'acceptatieOp' | 'nazorgTot'; waarde: string; citaat: string; debriefId: string; datum: string }
export interface ImplementatieAntwoord { implementatie: Implementatie | null; voorstellen: ImplementatieVoorstel[] }

export const SESSIE_SOORT_LABEL = { kickstart: 'Kickstart', uitvoering: 'Uitvoering', online: 'Online', tussenevaluatie: 'Tussenevaluatie', eindevaluatie: 'Eindevaluatie' } as const;
export type SessieSoort = keyof typeof SESSIE_SOORT_LABEL;
export const SESSIE_STATUS_LABEL = { gepland: 'Gepland', uitgevoerd: 'Uitgevoerd', geannuleerd: 'Geannuleerd', verplaatst: 'Verplaatst' } as const;
export type SessieStatus = keyof typeof SESSIE_STATUS_LABEL;
export const ONDERWERP_STATUS_LABEL = { voorgesteld: 'Voorgesteld', gepland: 'Gepland', afgehandeld: 'Afgehandeld', afgewezen: 'Afgewezen' } as const;
export interface SamenverderProgrammaRegel {
  id: string; klantId: string; klantNaam: string; pakket: string; periodeVan: string; periodeTot: string | null; status: 'actief' | 'afgerond'; accountmanagerId: string | null; accountmanagerNaam: string | null;
  opmerking: string; aantalSessies: number; aantalGepland: number; aantalUitgevoerd: number; volgendeSessie: string | null; laatsteSessie: string | null;
}
export interface SamenverderSessie {
  id: string; programmaId: string; soort: SessieSoort; dagnummer: number | null; onderwerp: string; doel: string | null; datum: string | null; omvangDagen: number; status: SessieStatus;
  verplaatstNaarId: string | null; extra: boolean; contactpersoonId: string | null; contactpersoonNaam: string | null; bevestigdDoor: string | null; bevestigdOp: string | null;
  consultants: { id: string; naam: string }[];
  onderwerpen: { id: string; titel: string; topicId: string | null; status: keyof typeof ONDERWERP_STATUS_LABEL; voorgesteldInSessieId: string | null }[];
  debriefs: { id: string; samenvatting: string; createdAt: string; door: string | null }[];
  activiteiten: { id: string; soort: string; omschrijving: string; status: string; deadline: string | null; eigenaar: string }[];
}
export interface SamenverderProgramma {
  programma: Omit<SamenverderProgrammaRegel, 'klantNaam' | 'accountmanagerNaam' | 'aantalSessies' | 'aantalGepland' | 'aantalUitgevoerd' | 'volgendeSessie' | 'laatsteSessie'>;
  klant: { id: string; naam: string }; sessies: SamenverderSessie[];
}

/**
 * Voegt iets toe waarbij de server kan waarschuwen dat het op een bestaand record lijkt (409 "Mogelijk dubbel"). De gebruiker beslist dan of het toch moet;
 * bij nee is het resultaat null en is er niets toegevoegd.
 */
export async function apiToevoegenZonderDubbel<T>(pad: string, body: Record<string, unknown>): Promise<T | null> {
  try { return await api<T>('POST', pad, body); } catch (e) {
    if (e instanceof ApiFout && e.status === 409 && e.message.startsWith('Mogelijk dubbel')) {
      if (!window.confirm(`${e.message}.\n\n${e.details.map((d) => `• ${d}`).join('\n')}\n\nToch toevoegen?`)) return null;
      return api<T>('POST', pad, { ...body, bevestig: true });
    }
    throw e;
  }
}

export const linkedInZoekUrl = (naam: string, gemeente: string) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${naam} ${gemeente}`.trim())}`;

export type KwaliteitSoort = 'dubbel_contact' | 'dubbele_klant' | 'dubbele_activiteit' | 'gegevens_in_naam' | 'naam_onvolledig' | 'contact_formaat' | 'contact_onvolledig';
export const KWALITEIT_LABEL: Record<KwaliteitSoort, string> = {
  dubbel_contact: 'Dubbele contactpersonen', dubbele_klant: 'Dubbele gemeenten', dubbele_activiteit: 'Dubbele punten', gegevens_in_naam: 'Gegevens in het naamveld',
  naam_onvolledig: 'Onvolledige naam', contact_formaat: 'E-mail of telefoon controleren', contact_onvolledig: 'Functie en rol ontbreken',
};
export interface KwaliteitContact { id: string; naam: string; functie: string; rol: string; email: string; telefoon: string; aangemaakt: string; bron: 'gesprek' | 'handmatig'; gebruik: number }
export interface KwaliteitBevinding {
  sleutel: string; soort: KwaliteitSoort; ernst: 'hoog' | 'laag'; klantId: string; klantNaam: string; accountmanagerNaam: string | null; uitleg: string; besloten: boolean;
  contacten?: KwaliteitContact[];
  klanten?: { id: string; naam: string; status: string; afasId: string | null; aantalContacten: number; aantalPunten: number }[];
  activiteiten?: { id: string; soort: string; omschrijving: string; eigenaar: string; deadline: string | null; aangemaakt: string; bron: string; metCitaat: boolean }[];
  voorstel?: { contactId: string; naam?: string; email?: string; telefoon?: string };
}
export interface KwaliteitAntwoord { bevindingen: KwaliteitBevinding[]; perSoort: Partial<Record<KwaliteitSoort, number>>; totaal: number }
export interface SamenvoegUitkomst { behouden: string; samengevoegd: number; aangevuld: string[]; conflicten: string[] }
