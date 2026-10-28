-- Gesprekstatus als state machine: extra statussen, tijdstip van de laatste statuswijziging, en een trigger die ongeldige overgangen weigert.
-- Alleen toevoegend: bestaande rijen blijven ongewijzigd geldig.
ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_status_check;
ALTER TABLE calls ADD CONSTRAINT calls_status_check
  CHECK (status IN ('gepland', 'verzenden', 'belt', 'gesprek', 'gesproken', 'niet_bereikt', 'voicemail', 'mislukt', 'onderbroken'));

ALTER TABLE calls ADD COLUMN IF NOT EXISTS status_gewijzigd_op timestamptz NOT NULL DEFAULT now();
ALTER TABLE calls ADD COLUMN IF NOT EXISTS samenvatting_pogingen integer NOT NULL DEFAULT 0;
UPDATE calls SET status_gewijzigd_op = COALESCE(afgerond_op, gestart_op, created_at);

CREATE OR REPLACE FUNCTION calls_status_overgang() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
    OLD.status = 'gepland'
    OR (OLD.status = 'verzenden' AND NEW.status IN ('belt', 'gesprek', 'gesproken', 'niet_bereikt', 'voicemail', 'mislukt', 'onderbroken'))
    OR (OLD.status = 'belt' AND NEW.status IN ('gesprek', 'gesproken', 'niet_bereikt', 'voicemail', 'mislukt', 'onderbroken'))
    OR (OLD.status = 'gesprek' AND NEW.status IN ('gesproken', 'niet_bereikt', 'voicemail', 'mislukt', 'onderbroken'))
    OR (OLD.status IN ('niet_bereikt', 'voicemail', 'mislukt', 'onderbroken') AND NEW.status = 'gesproken')
  ) THEN
    RAISE EXCEPTION 'Ongeldige gespreksstatus-overgang % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  NEW.status_gewijzigd_op := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS calls_status_overgang ON calls;
CREATE TRIGGER calls_status_overgang BEFORE UPDATE OF status ON calls
  FOR EACH ROW EXECUTE FUNCTION calls_status_overgang();
