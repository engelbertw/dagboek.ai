-- Consultantdebriefs, fase 7: een vervolgsignaal van een consultant wordt door beheer of de accountmanager van de gemeente beoordeeld. Het besluit wordt vastgelegd
-- in een register dat niet wordt aangepast; bij "kans" ontstaat een nieuw, leeg werkpunt dat naar het signaal verwijst. Het signaal zelf wordt nooit verwijderd of herschreven.
-- Alles is additief: een nieuwe tabel en een nullable kolom.

ALTER TABLE activiteiten ADD COLUMN IF NOT EXISTS bron_activiteit_id uuid REFERENCES activiteiten(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS activiteiten_bron_activiteit ON activiteiten (bron_activiteit_id) WHERE bron_activiteit_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS opvolgingen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signaal_id uuid NOT NULL UNIQUE REFERENCES activiteiten(id) ON DELETE CASCADE,
  besluit text NOT NULL CHECK (besluit IN ('kans', 'geen_vervolg')),
  reden text NOT NULL DEFAULT '',
  door text NOT NULL,
  op timestamptz NOT NULL DEFAULT now(),
  nieuw_activiteit_id uuid REFERENCES activiteiten(id) ON DELETE SET NULL,
  -- Een besluit zonder vervolg heeft een reden; bij een kans wijst het besluit naar het nieuwe punt.
  CHECK (besluit <> 'geen_vervolg' OR length(btrim(reden)) > 0)
);

-- Een besluit wordt nooit herschreven. Alleen de verwijzing naar het nieuwe punt mag leeg raken als dat punt wordt verwijderd (de database doet dat zelf).
CREATE OR REPLACE FUNCTION opvolgingen_niet_wijzigen() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - 'nieuw_activiteit_id') IS DISTINCT FROM (to_jsonb(OLD) - 'nieuw_activiteit_id') OR NEW.nieuw_activiteit_id IS NOT NULL THEN
    RAISE EXCEPTION 'opvolgingen is een register: een besluit wordt niet gewijzigd' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS opvolgingen_geen_wijziging ON opvolgingen;
CREATE TRIGGER opvolgingen_geen_wijziging BEFORE UPDATE ON opvolgingen FOR EACH ROW EXECUTE FUNCTION opvolgingen_niet_wijzigen();
