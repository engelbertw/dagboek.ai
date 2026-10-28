-- Bewijs en zichtbaarheid: wanneer is een transcript gewist, wat deed elke opschoonronde, en wat is er met een gesprek gebeurd.
ALTER TABLE calls ADD COLUMN IF NOT EXISTS transcript_gewist_op timestamptz;

CREATE TABLE IF NOT EXISTS opschoning_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bron text NOT NULL CHECK (bron IN ('web', 'voice')),
  gestart_op timestamptz NOT NULL DEFAULT now(),
  klaar_op timestamptz,
  status text NOT NULL CHECK (status IN ('ok', 'deels', 'mislukt')),
  gewist integer NOT NULL DEFAULT 0,
  mislukt integer NOT NULL DEFAULT 0,
  foutcode text
);
CREATE INDEX IF NOT EXISTS opschoning_runs_bron ON opschoning_runs(bron, gestart_op DESC);

-- Gespreksverloop: alleen codes en tijden, nooit gespreksinhoud, telefoonnummers of foutmeldingen.
CREATE TABLE IF NOT EXISTS call_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  tijd timestamptz NOT NULL DEFAULT now(),
  bron text NOT NULL,
  gebeurtenis text NOT NULL
);
CREATE INDEX IF NOT EXISTS call_log_call ON call_log(call_id, tijd);
