-- AI-register: een logboek van aanroepen van het taalmodel. Alleen metadata; nooit prompt, transcript, antwoord, namen of nummers.
CREATE TABLE IF NOT EXISTS ai_activiteiten (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tijdstip timestamptz NOT NULL DEFAULT now(),
  functie text NOT NULL,
  model text NOT NULL DEFAULT '',
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_uit integer NOT NULL DEFAULT 0,
  duur_ms integer NOT NULL DEFAULT 0,
  uitkomst text NOT NULL CHECK (uitkomst IN ('ok', 'fout')),
  fout_code text,
  referentie text
);
CREATE INDEX IF NOT EXISTS ai_activiteiten_tijdstip ON ai_activiteiten (tijdstip DESC);
CREATE INDEX IF NOT EXISTS ai_activiteiten_functie ON ai_activiteiten (functie, tijdstip DESC);
