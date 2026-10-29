-- Een agent-gesprek zonder transcript wordt een paar keer bij de voice-service nagevraagd; hoe vaak en wanneer voor het laatst staat hier.
ALTER TABLE calls ADD COLUMN IF NOT EXISTS herstel_pogingen integer NOT NULL DEFAULT 0;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS herstel_laatst timestamptz;
