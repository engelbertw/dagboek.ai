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
  toestemmingOp: timestamp('toestemming_op', { withTimezone: true }),
  notitie: text('notitie').notNull().default(''),
  createdAt: createdAt(),
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
  bron: text('bron', { enum: ['handmatig', 'schema'] }).notNull().default('handmatig'),
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
  samenvattingFout: text('samenvatting_fout'),
  samenvattingRuw: jsonb('samenvatting_ruw'),
  samenvattingGestartOp: timestamp('samenvatting_gestart_op', { withTimezone: true }),
  statusGewijzigdOp: timestamp('status_gewijzigd_op', { withTimezone: true }).notNull().defaultNow(),
  samenvattingPogingen: integer('samenvatting_pogingen').notNull().default(0),
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
  status: text('status', { enum: ['open', 'afgerond'] }).notNull().default('open'),
  createdAt: createdAt(),
  afgerondOp: timestamp('afgerond_op', { withTimezone: true }),
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
