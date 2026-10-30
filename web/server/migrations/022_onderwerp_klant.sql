-- Een dagboekonderwerp kan bij een gemeente (klant) horen; sommige onderwerpen zijn projecten voor een gemeente.
ALTER TABLE topics ADD COLUMN IF NOT EXISTS klant_id uuid REFERENCES klanten(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS topics_klant ON topics (klant_id);
