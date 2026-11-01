-- Consultantdebriefs, fase 1: gemeenschappelijke basis. Alles is additief; bestaande medewerkers, gesprekken en activiteiten veranderen niet.
-- De functie staat standaard uit (instelling 'consultant_debrief'); zonder die schakelaar gedraagt de app zich als voorheen.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS consultant boolean NOT NULL DEFAULT false;

-- 'debrief_keuze' is een tijdelijk type voor iemand die zowel accountmanager als consultant is: de route volgt uit het gesprek en wordt achteraf geverifieerd.
ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_type_check;
ALTER TABLE calls ADD CONSTRAINT calls_type_check CHECK (type IN ('dagboek', 'verkoop_debrief', 'consultant_debrief', 'debrief_keuze'));
ALTER TABLE calls ADD COLUMN IF NOT EXISTS context jsonb;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS route_bron text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS route_citaat text;
ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_route_bron_check;
ALTER TABLE calls ADD CONSTRAINT calls_route_bron_check CHECK (route_bron IS NULL OR route_bron IN ('context_bevestigd', 'mondeling_gekozen', 'mondeling_gecorrigeerd', 'onbekend', 'beheerder'));

-- Nieuwe soorten in het ene werkregister.
ALTER TABLE activiteiten DROP CONSTRAINT IF EXISTS activiteiten_soort_check;
ALTER TABLE activiteiten ADD CONSTRAINT activiteiten_soort_check
  CHECK (soort IN ('doel', 'resultaat', 'afspraak', 'actie', 'kans', 'risico', 'intern', 'besluit', 'blokkade', 'afhankelijkheid', 'vervolgsignaal'));
ALTER TABLE activiteiten ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES klant_contacten(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS activiteiten_contact ON activiteiten (contact_id) WHERE contact_id IS NOT NULL;

-- Eén record per consultantgesprek: de gekozen variant met de herkomst van die keuze, en wat variant-specifiek is.
CREATE TABLE IF NOT EXISTS consultant_debriefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  variant text CHECK (variant IS NULL OR variant IN ('project', 'implementatie', 'samenverder')),
  variant_bron text NOT NULL DEFAULT 'onbekend' CHECK (variant_bron IN ('context_bevestigd', 'mondeling_gekozen', 'mondeling_gecorrigeerd', 'onbekend')),
  variant_citaat text NOT NULL DEFAULT '',
  klant_id uuid REFERENCES klanten(id) ON DELETE SET NULL,
  topic_id uuid REFERENCES topics(id) ON DELETE SET NULL,
  samenvatting text NOT NULL DEFAULT '',
  werkzaamheden jsonb NOT NULL DEFAULT '[]',
  variantdata jsonb NOT NULL DEFAULT '{}',
  prompt_versie text NOT NULL DEFAULT '',
  controle_nodig boolean NOT NULL DEFAULT false,
  controle_reden text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consultant_debriefs_klant ON consultant_debriefs (klant_id, created_at DESC);

-- Wie er bij het gesprek genoemd werd (alleen herkende contactpersonen van dezelfde klant).
CREATE TABLE IF NOT EXISTS consultant_debrief_contacten (
  debrief_id uuid NOT NULL REFERENCES consultant_debriefs(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES klant_contacten(id) ON DELETE CASCADE,
  PRIMARY KEY (debrief_id, contact_id)
);
