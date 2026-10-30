import { boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Momentopname van wat er in een gesprek aan bod kon komen. */
export interface GespreksOnderwerp {
  id: string;
  titel: string;
  openPunten: { id: string; tekst: string }[];
}

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const employees = pgTable('employees', {
  id: id(),
  naam: text('naam').notNull(),
  telefoon: text('telefoon').notNull(),
  email: text('email').notNull().default(''),
  locgovGebruikersnaam: text('locgov_gebruikersnaam').notNull().default(''),
  taal: text('taal').notNull().default('nl'),
  actief: boolean('actief').notNull().default(true),
  /** Een accountmanager krijgt bij het inbellen de verkoop-debrief in plaats van het dagboekgesprek. */
  rol: text('rol', { enum: ['medewerker', 'accountmanager'] }).notNull().default('medewerker'),
  toestemmingOp: timestamp('toestemming_op', { withTimezone: true }),
  notitie: text('notitie').notNull().default(''),
  createdAt: createdAt(),
});

export const overzichtToegang = pgTable('overzicht_toegang', {
  employeeId: uuid('employee_id').primaryKey().references(() => employees.id, { onDelete: 'cascade' }),
  codewoordHash: text('codewoord_hash').notNull(),
  ingesteldOp: timestamp('ingesteld_op', { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable('projects', {
  id: id(),
  naam: text('naam').notNull(),
  omschrijving: text('omschrijving').notNull().default(''),
  status: text('status', { enum: ['actief', 'afgerond'] }).notNull().default('actief'),
  createdAt: createdAt(),
});

export const topics = pgTable('topics', {
  id: id(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  eigenaarId: uuid('eigenaar_id').references(() => employees.id, { onDelete: 'set null' }),
  klantId: uuid('klant_id').references(() => klanten.id, { onDelete: 'set null' }),
  titel: text('titel').notNull(),
  type: text('type', { enum: ['project', 'thema', 'taak'] }).notNull().default('thema'),
  status: text('status', { enum: ['actief', 'wacht', 'afgerond'] }).notNull().default('actief'),
  aanwijzingen: text('aanwijzingen').notNull().default(''),
  afgerondOp: timestamp('afgerond_op', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('topics_eigenaar').on(t.eigenaarId), index('topics_project').on(t.projectId)]);

export const calls = pgTable('calls', {
  id: id(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  status: text('status', {
    enum: ['gepland', 'verzenden', 'belt', 'gesprek', 'gesproken', 'niet_bereikt', 'voicemail', 'mislukt', 'onderbroken'],
  }).notNull().default('gepland'),
  bron: text('bron', { enum: ['handmatig', 'schema', 'inkomend'] }).notNull().default('handmatig'),
  type: text('type', { enum: ['dagboek', 'verkoop_debrief'] }).notNull().default('dagboek'),
  scheduleId: uuid('schedule_id'),
  slotStart: timestamp('slot_start', { withTimezone: true }),
  poging: integer('poging').notNull().default(1),
  instructie: text('instructie'),
  voiceCallId: text('voice_call_id'),
  twilioSid: text('twilio_sid'),
  transcript: jsonb('transcript'),
  fout: text('fout'),
  onderwerpen: jsonb('onderwerpen').$type<GespreksOnderwerp[]>().notNull().default([]),
  samenvattingStatus: text('samenvatting_status', {
    enum: ['geen', 'bezig', 'klaar', 'geen_inhoud', 'geweigerd', 'onduidelijk', 'mislukt'],
  }).notNull().default('geen'),
  toestemmingStatus: text('toestemming_status', {
    enum: ['niet_nodig', 'onbekend', 'gegeven', 'geweigerd', 'onduidelijk', 'ingetrokken'],
  }).notNull().default('onbekend'),
  transcriptBewarenTot: timestamp('transcript_bewaren_tot', { withTimezone: true }),
  transcriptGewistOp: timestamp('transcript_gewist_op', { withTimezone: true }),
  samenvattingFout: text('samenvatting_fout'),
  samenvattingRuw: jsonb('samenvatting_ruw'),
  samenvattingGestartOp: timestamp('samenvatting_gestart_op', { withTimezone: true }),
  statusGewijzigdOp: timestamp('status_gewijzigd_op', { withTimezone: true }).notNull().defaultNow(),
  samenvattingPogingen: integer('samenvatting_pogingen').notNull().default(0),
  herstelPogingen: integer('herstel_pogingen').notNull().default(0),
  herstelLaatst: timestamp('herstel_laatst', { withTimezone: true }),
  overzichtGeverifieerdOp: timestamp('overzicht_geverifieerd_op', { withTimezone: true }),
  overzichtPogingen: integer('overzicht_pogingen').notNull().default(0),
  engine: text('engine', { enum: ['pipecat', 'elevenlabs_agent'] }),
  beoordeling: integer('beoordeling'),
  beoordelingOpmerking: text('beoordeling_opmerking'),
  gestartOp: timestamp('gestart_op', { withTimezone: true }),
  afgerondOp: timestamp('afgerond_op', { withTimezone: true }),
  createdAt: createdAt(),
});

export const updates = pgTable('updates', {
  id: id(),
  topicId: uuid('topic_id').notNull().references(() => topics.id, { onDelete: 'cascade' }),
  callId: uuid('call_id').references(() => calls.id, { onDelete: 'set null' }),
  bron: text('bron', { enum: ['voice', 'handmatig'] }).notNull().default('handmatig'),
  samenvatting: text('samenvatting').notNull(),
  besluiten: text('besluiten').notNull().default(''),
  createdAt: createdAt(),
  bewerktOp: timestamp('bewerkt_op', { withTimezone: true }),
});

export const updateHistorie = pgTable('update_historie', {
  id: id(),
  updateId: uuid('update_id').notNull().references(() => updates.id, { onDelete: 'cascade' }),
  vorigeSamenvatting: text('vorige_samenvatting').notNull(),
  vorigeBesluiten: text('vorige_besluiten').notNull(),
  gewijzigdOp: timestamp('gewijzigd_op', { withTimezone: true }).notNull().defaultNow(),
});

export const openItems = pgTable('open_items', {
  id: id(),
  topicId: uuid('topic_id').notNull().references(() => topics.id, { onDelete: 'cascade' }),
  tekst: text('tekst').notNull(),
  callId: uuid('call_id').references(() => calls.id, { onDelete: 'set null' }),
  eigenaarId: uuid('eigenaar_id').references(() => employees.id, { onDelete: 'set null' }),
  eigenaarExtern: text('eigenaar_extern').notNull().default(''),
  deadline: date('deadline'),
  bron: text('bron', { enum: ['handmatig', 'gesprek'] }).notNull().default('handmatig'),
  controleNodig: boolean('controle_nodig').notNull().default(false),
  controleReden: text('controle_reden'),
  deadlineOorspronkelijk: date('deadline_oorspronkelijk'),
  deadlineGewijzigdAantal: integer('deadline_gewijzigd_aantal').notNull().default(0),
  jiraSleutel: text('jira_sleutel'),
  jiraUrl: text('jira_url'),
  jiraAangemaaktOp: timestamp('jira_aangemaakt_op', { withTimezone: true }),
  status: text('status', { enum: ['open', 'afgerond'] }).notNull().default('open'),
  createdAt: createdAt(),
  afgerondOp: timestamp('afgerond_op', { withTimezone: true }),
});

// ── Verkoop-debrief: klantenadministratie en verkoopregister ────────────────
export const klanten = pgTable('klanten', {
  id: id(),
  naam: text('naam').notNull(),
  afasId: text('afas_id'),
  status: text('status', { enum: ['prospect', 'klant', 'voorgesteld', 'inactief'] }).notNull().default('voorgesteld'),
  accountmanagerId: uuid('accountmanager_id').references(() => employees.id, { onDelete: 'set null' }),
  omschrijving: text('omschrijving').notNull().default(''),
  contractEinde: date('contract_einde'),
  samenwerkingsverband: text('samenwerkingsverband').notNull().default(''),
  inwoners: integer('inwoners'),
  salesAm: text('sales_am').notNull().default(''),
  bron: text('bron', { enum: ['handmatig', 'gesprek', 'afas'] }).notNull().default('handmatig'),
  bijgewerktOp: timestamp('bijgewerkt_op', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

export const klantContacten = pgTable('klant_contacten', {
  id: id(),
  klantId: uuid('klant_id').notNull().references(() => klanten.id, { onDelete: 'cascade' }),
  naam: text('naam').notNull(),
  functie: text('functie').notNull().default(''),
  rol: text('rol').notNull().default(''),
  email: text('email').notNull().default(''),
  telefoon: text('telefoon').notNull().default(''),
  callId: uuid('call_id').references(() => calls.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const bezoeken = pgTable('bezoeken', {
  id: id(),
  klantId: uuid('klant_id').references(() => klanten.id, { onDelete: 'set null' }),
  callId: uuid('call_id').references(() => calls.id, { onDelete: 'set null' }),
  accountmanagerId: uuid('accountmanager_id').references(() => employees.id, { onDelete: 'set null' }),
  klantNaamGenoemd: text('klant_naam_genoemd').notNull().default(''),
  datum: date('datum'),
  soort: text('soort').notNull().default(''),
  tevredenheid: integer('tevredenheid'),
  samenvatting: text('samenvatting').notNull().default(''),
  createdAt: createdAt(),
});

export const ACTIVITEIT_SOORTEN = ['doel', 'resultaat', 'afspraak', 'actie', 'kans', 'risico', 'intern'] as const;
export type ActiviteitSoort = (typeof ACTIVITEIT_SOORTEN)[number];

/** Alles wat gedaan of bijgehouden moet worden, per klant en/of per onderwerp. `intern` is wat wij zelf intern moeten doen. */
export const activiteiten = pgTable('activiteiten', {
  id: id(),
  klantId: uuid('klant_id').references(() => klanten.id, { onDelete: 'cascade' }),
  bezoekId: uuid('bezoek_id').references(() => bezoeken.id, { onDelete: 'cascade' }),
  topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
  soort: text('soort', { enum: ACTIVITEIT_SOORTEN }).notNull(),
  omschrijving: text('omschrijving').notNull(),
  eigenaarId: uuid('eigenaar_id').references(() => employees.id, { onDelete: 'set null' }),
  eigenaarExtern: text('eigenaar_extern').notNull().default(''),
  deadline: date('deadline'),
  status: text('status', { enum: ['open', 'afgerond'] }).notNull().default('open'),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  citaat: text('citaat').notNull().default(''),
  controleNodig: boolean('controle_nodig').notNull().default(false),
  controleReden: text('controle_reden'),
  callId: uuid('call_id').references(() => calls.id, { onDelete: 'set null' }),
  bron: text('bron', { enum: ['handmatig', 'gesprek'] }).notNull().default('gesprek'),
  deadlineOorspronkelijk: date('deadline_oorspronkelijk'),
  deadlineGewijzigdAantal: integer('deadline_gewijzigd_aantal').notNull().default(0),
  jiraSleutel: text('jira_sleutel'),
  jiraUrl: text('jira_url'),
  jiraAangemaaktOp: timestamp('jira_aangemaakt_op', { withTimezone: true }),
  createdAt: createdAt(),
  afgerondOp: timestamp('afgerond_op', { withTimezone: true }),
});

export const opschoningRuns = pgTable('opschoning_runs', {
  id: id(),
  bron: text('bron', { enum: ['web', 'voice'] }).notNull(),
  gestartOp: timestamp('gestart_op', { withTimezone: true }).notNull().defaultNow(),
  klaarOp: timestamp('klaar_op', { withTimezone: true }),
  status: text('status', { enum: ['ok', 'deels', 'mislukt'] }).notNull(),
  gewist: integer('gewist').notNull().default(0),
  mislukt: integer('mislukt').notNull().default(0),
  foutcode: text('foutcode'),
});

export const callLog = pgTable('call_log', {
  id: id(),
  callId: uuid('call_id').notNull().references(() => calls.id, { onDelete: 'cascade' }),
  tijd: timestamp('tijd', { withTimezone: true }).notNull().defaultNow(),
  bron: text('bron').notNull(),
  gebeurtenis: text('gebeurtenis').notNull(),
});

export const toestemmingen = pgTable('toestemmingen', {
  id: id(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  besluit: text('besluit', { enum: ['gegeven', 'geweigerd', 'ingetrokken'] }).notNull(),
  bron: text('bron', { enum: ['gesprek', 'beheerder', 'migratie'] }).notNull(),
  callId: uuid('call_id').references(() => calls.id, { onDelete: 'set null' }),
  versie: text('versie').notNull(),
  doel: text('doel').notNull().default('samenvatting_dagboek'),
  citaat: text('citaat'),
  vastgelegdOp: timestamp('vastgelegd_op', { withTimezone: true }).notNull().defaultNow(),
});

export const suggesties = pgTable('suggesties', {
  id: id(),
  soort: text('soort', { enum: ['onderwerp', 'verbetering'] }).notNull(),
  tekst: text('tekst').notNull(),
  employeeId: uuid('employee_id').references(() => employees.id, { onDelete: 'set null' }),
  callId: uuid('call_id').references(() => calls.id, { onDelete: 'set null' }),
  status: text('status', { enum: ['nieuw', 'overgenomen', 'afgewezen', 'klaar'] }).notNull().default('nieuw'),
  topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const scheduleEmployees = pgTable('schedule_employees', {
  scheduleId: uuid('schedule_id').notNull().references(() => schedules.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.scheduleId, t.employeeId] })]);

export const instellingen = pgTable('instellingen', {
  sleutel: text('sleutel').primaryKey(),
  waarde: text('waarde').notNull(),
  bijgewerktOp: timestamp('bijgewerkt_op', { withTimezone: true }).notNull().defaultNow(),
});

export const schedules = pgTable('schedules', {
  id: id(),
  naam: text('naam').notNull().default(''),
  gespreksinstructie: text('gespreksinstructie'),
  dagen: integer('dagen').array().notNull().default([1, 2, 3, 4, 5]),
  tijden: text('tijden').array().notNull().default([]),
  actief: boolean('actief').notNull().default(true),
  maxPogingen: integer('max_pogingen').notNull().default(2),
  createdAt: createdAt(),
});
