-- Toestemmingsregister: wie, wanneer, waarvoor en op grond waarvan. Alleen toevoegend (geen UPDATE); employees.toestemming_op blijft als afgeleide stand.
CREATE TABLE IF NOT EXISTS toestemmingen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  besluit text NOT NULL CHECK (besluit IN ('gegeven', 'geweigerd', 'ingetrokken')),
  bron text NOT NULL CHECK (bron IN ('gesprek', 'beheerder', 'migratie')),
  call_id uuid REFERENCES calls(id) ON DELETE SET NULL,
  versie text NOT NULL,
  doel text NOT NULL DEFAULT 'samenvatting_dagboek',
  citaat text,
  vastgelegd_op timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS toestemmingen_medewerker ON toestemmingen(employee_id, vastgelegd_op DESC);
-- Eén besluit per gesprek: dubbel verwerken van dezelfde melding legt niets dubbel vast.
CREATE UNIQUE INDEX IF NOT EXISTS toestemmingen_per_gesprek ON toestemmingen(call_id) WHERE call_id IS NOT NULL;

CREATE OR REPLACE FUNCTION toestemmingen_niet_wijzigen() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'toestemmingen is een register: voeg een nieuw besluit toe in plaats van te wijzigen' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS toestemmingen_geen_update ON toestemmingen;
CREATE TRIGGER toestemmingen_geen_update BEFORE UPDATE ON toestemmingen FOR EACH ROW EXECUTE FUNCTION toestemmingen_niet_wijzigen();

-- Bestaande toestemmingen komen in het register met bron 'migratie' (de oorspronkelijke bron is niet vastgelegd).
INSERT INTO toestemmingen (employee_id, besluit, bron, versie, vastgelegd_op)
  SELECT id, 'gegeven', 'migratie', 'onbekend', toestemming_op FROM employees WHERE toestemming_op IS NOT NULL;

-- Per gesprek: was toestemming al bekend, en tot wanneer mag het transcript worden bewaard (null = de standaard bewaartermijn).
ALTER TABLE calls ADD COLUMN IF NOT EXISTS toestemming_status text NOT NULL DEFAULT 'onbekend'
  CHECK (toestemming_status IN ('niet_nodig', 'onbekend', 'gegeven', 'geweigerd', 'onduidelijk', 'ingetrokken'));
ALTER TABLE calls ADD COLUMN IF NOT EXISTS transcript_bewaren_tot timestamptz;
