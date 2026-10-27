CREATE TABLE employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  naam text NOT NULL,
  telefoon text NOT NULL,
  taal text NOT NULL DEFAULT 'nl',
  actief boolean NOT NULL DEFAULT true,
  toestemming_op timestamptz,
  notitie text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  naam text NOT NULL,
  omschrijving text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'actief' CHECK (status IN ('actief', 'afgerond')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  eigenaar_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  titel text NOT NULL,
  type text NOT NULL DEFAULT 'thema' CHECK (type IN ('project', 'thema', 'taak')),
  status text NOT NULL DEFAULT 'actief' CHECK (status IN ('actief', 'wacht', 'afgerond')),
  aanwijzingen text NOT NULL DEFAULT '',
  afgerond_op timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX topics_eigenaar ON topics(eigenaar_id);
CREATE INDEX topics_project ON topics(project_id);

CREATE TABLE calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'gepland'
    CHECK (status IN ('gepland', 'belt', 'gesprek', 'gesproken', 'niet_bereikt', 'voicemail', 'mislukt')),
  bron text NOT NULL DEFAULT 'handmatig' CHECK (bron IN ('handmatig', 'schema')),
  voice_call_id text,
  twilio_sid text,
  transcript jsonb,
  fout text,
  gestart_op timestamptz,
  afgerond_op timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calls_employee ON calls(employee_id, created_at DESC);

CREATE TABLE updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  call_id uuid REFERENCES calls(id) ON DELETE SET NULL,
  bron text NOT NULL DEFAULT 'handmatig' CHECK (bron IN ('voice', 'handmatig')),
  samenvatting text NOT NULL,
  besluiten text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  bewerkt_op timestamptz
);
CREATE INDEX updates_topic ON updates(topic_id, created_at DESC);

CREATE TABLE update_historie (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  update_id uuid NOT NULL REFERENCES updates(id) ON DELETE CASCADE,
  vorige_samenvatting text NOT NULL,
  vorige_besluiten text NOT NULL,
  gewijzigd_op timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE open_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  tekst text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'afgerond')),
  created_at timestamptz NOT NULL DEFAULT now(),
  afgerond_op timestamptz
);
CREATE INDEX open_items_topic ON open_items(topic_id, status);

CREATE TABLE schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  dagen integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  tijden text[] NOT NULL DEFAULT '{}',
  actief boolean NOT NULL DEFAULT true,
  max_pogingen integer NOT NULL DEFAULT 2 CHECK (max_pogingen BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX schedules_employee ON schedules(employee_id);
