-- Consultantdebriefs, fase 4: SamenVerder-programma's en sessies per gemeente (zonder dagenbudget; dat volgt in een latere migratie).
-- Alles is additief: nieuwe tabellen en nullable koppelkolommen. Bestaande gegevens veranderen niet.

CREATE TABLE IF NOT EXISTS samenverder_programmas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  klant_id uuid NOT NULL REFERENCES klanten(id) ON DELETE RESTRICT,
  pakket text NOT NULL DEFAULT '',
  periode_van date NOT NULL,
  periode_tot date,
  status text NOT NULL DEFAULT 'actief' CHECK (status IN ('actief', 'afgerond')),
  accountmanager_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  bron text NOT NULL DEFAULT 'handmatig' CHECK (bron IN ('handmatig', 'import')),
  opmerking text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  bijgewerkt_op timestamptz NOT NULL DEFAULT now(),
  CHECK (periode_tot IS NULL OR periode_tot >= periode_van)
);
CREATE INDEX IF NOT EXISTS samenverder_programmas_klant ON samenverder_programmas (klant_id, periode_van DESC);

CREATE TABLE IF NOT EXISTS samenverder_sessies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programma_id uuid NOT NULL REFERENCES samenverder_programmas(id) ON DELETE CASCADE,
  soort text NOT NULL DEFAULT 'uitvoering' CHECK (soort IN ('kickstart', 'uitvoering', 'online', 'tussenevaluatie', 'eindevaluatie')),
  dagnummer integer CHECK (dagnummer IS NULL OR dagnummer > 0),
  onderwerp text NOT NULL DEFAULT '',
  doel text,
  datum date,
  omvang_dagen numeric(4, 2) NOT NULL DEFAULT 1 CHECK (omvang_dagen > 0 AND omvang_dagen <= 20),
  status text NOT NULL DEFAULT 'gepland' CHECK (status IN ('gepland', 'uitgevoerd', 'geannuleerd', 'verplaatst')),
  verplaatst_naar_id uuid REFERENCES samenverder_sessies(id) ON DELETE SET NULL,
  extra boolean NOT NULL DEFAULT false,
  contactpersoon_id uuid REFERENCES klant_contacten(id) ON DELETE SET NULL,
  bevestigd_door text,
  bevestigd_op timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  bijgewerkt_op timestamptz NOT NULL DEFAULT now(),
  -- Een geplande en een uitgevoerde sessie hebben een datum; uitgevoerd telt pas als een beheerder het heeft bevestigd.
  CHECK (status NOT IN ('gepland', 'uitgevoerd') OR datum IS NOT NULL),
  CHECK (status <> 'uitgevoerd' OR bevestigd_op IS NOT NULL),
  CHECK (verplaatst_naar_id IS NULL OR verplaatst_naar_id <> id)
);
CREATE INDEX IF NOT EXISTS samenverder_sessies_programma ON samenverder_sessies (programma_id, datum);
CREATE INDEX IF NOT EXISTS samenverder_sessies_datum ON samenverder_sessies (datum);

CREATE TABLE IF NOT EXISTS samenverder_sessie_consultants (
  sessie_id uuid NOT NULL REFERENCES samenverder_sessies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  PRIMARY KEY (sessie_id, employee_id)
);

CREATE TABLE IF NOT EXISTS samenverder_sessie_onderwerpen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sessie_id uuid NOT NULL REFERENCES samenverder_sessies(id) ON DELETE CASCADE,
  titel text NOT NULL CHECK (length(btrim(titel)) > 0),
  topic_id uuid REFERENCES topics(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'gepland' CHECK (status IN ('voorgesteld', 'gepland', 'afgehandeld', 'afgewezen')),
  voorgesteld_in_sessie_id uuid REFERENCES samenverder_sessies(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS samenverder_sessie_onderwerpen_sessie ON samenverder_sessie_onderwerpen (sessie_id);

-- Koppelingen vanuit het werkregister en de consultantdebriefs; de debrief zelf legt ze pas in een volgende fase.
ALTER TABLE activiteiten ADD COLUMN IF NOT EXISTS samenverder_programma_id uuid REFERENCES samenverder_programmas(id) ON DELETE SET NULL;
ALTER TABLE activiteiten ADD COLUMN IF NOT EXISTS samenverder_sessie_id uuid REFERENCES samenverder_sessies(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS activiteiten_samenverder_sessie ON activiteiten (samenverder_sessie_id) WHERE samenverder_sessie_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS activiteiten_samenverder_programma ON activiteiten (samenverder_programma_id) WHERE samenverder_programma_id IS NOT NULL;
ALTER TABLE consultant_debriefs ADD COLUMN IF NOT EXISTS programma_id uuid REFERENCES samenverder_programmas(id) ON DELETE SET NULL;
ALTER TABLE consultant_debriefs ADD COLUMN IF NOT EXISTS sessie_id uuid REFERENCES samenverder_sessies(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS consultant_debriefs_sessie ON consultant_debriefs (sessie_id) WHERE sessie_id IS NOT NULL;
