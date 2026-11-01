-- Consultantdebriefs, fase 6: het dagenbudget van een SamenVerder-programma. Alleen de afgesproken dagen worden bewaard, als een register van mutaties dat nooit
-- wordt aangepast (een correctie is een nieuwe mutatie). Wat al uitgevoerd, gepland of nog niet gepland is, wordt altijd berekend uit de sessies en wordt niet opgeslagen.
-- Alles is additief: een nieuwe tabel, geen bestaande gegevens veranderen.

CREATE TABLE IF NOT EXISTS samenverder_budgetmutaties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programma_id uuid NOT NULL REFERENCES samenverder_programmas(id) ON DELETE RESTRICT,
  dagen numeric(5, 2) NOT NULL CHECK (dagen <> 0),
  soort text NOT NULL CHECK (soort IN ('start', 'uitbreiding', 'correctie')),
  reden text NOT NULL CHECK (length(btrim(reden)) > 0),
  door text NOT NULL,
  op timestamptz NOT NULL DEFAULT now(),
  -- Een start of uitbreiding voegt dagen toe; alleen een correctie mag ook dagen afhalen.
  CHECK (soort = 'correctie' OR dagen > 0)
);
CREATE INDEX IF NOT EXISTS samenverder_budgetmutaties_programma ON samenverder_budgetmutaties (programma_id, op);
-- Een programma heeft hooguit één startbudget; meer dagen komen er als uitbreiding bij.
CREATE UNIQUE INDEX IF NOT EXISTS samenverder_budgetmutaties_een_start ON samenverder_budgetmutaties (programma_id) WHERE soort = 'start';

CREATE OR REPLACE FUNCTION samenverder_budgetmutaties_niet_wijzigen() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'samenverder_budgetmutaties is een register: voeg een correctie toe in plaats van te wijzigen of te verwijderen' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS samenverder_budgetmutaties_geen_wijziging ON samenverder_budgetmutaties;
CREATE TRIGGER samenverder_budgetmutaties_geen_wijziging BEFORE UPDATE OR DELETE ON samenverder_budgetmutaties FOR EACH ROW EXECUTE FUNCTION samenverder_budgetmutaties_niet_wijzigen();
