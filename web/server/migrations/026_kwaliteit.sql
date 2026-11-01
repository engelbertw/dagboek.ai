-- Datakwaliteit: wat een accountmanager heeft beoordeeld als "dit is geen probleem" (bijvoorbeeld twee verschillende personen met een bijna gelijke naam),
-- zodat dezelfde melding niet steeds terugkomt. De sleutel hangt af van de betrokken records: komt er een record bij, dan verschijnt de melding opnieuw.
CREATE TABLE IF NOT EXISTS kwaliteit_besluiten (
  sleutel text PRIMARY KEY,
  soort text NOT NULL,
  besluit text NOT NULL DEFAULT 'geen_probleem' CHECK (besluit IN ('geen_probleem')),
  door text,
  op timestamptz NOT NULL DEFAULT now()
);
