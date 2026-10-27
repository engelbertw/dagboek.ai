-- Welke onderwerpen en open punten het gesprek bevatte (momentopname bij het bellen) en de stand van de samenvatting.
ALTER TABLE calls ADD COLUMN onderwerpen jsonb NOT NULL DEFAULT '[]';
ALTER TABLE calls ADD COLUMN samenvatting_status text NOT NULL DEFAULT 'geen'
  CHECK (samenvatting_status IN ('geen', 'bezig', 'klaar', 'geen_inhoud', 'geweigerd', 'onduidelijk', 'mislukt'));
ALTER TABLE calls ADD COLUMN samenvatting_fout text;
ALTER TABLE calls ADD COLUMN samenvatting_ruw jsonb;
ALTER TABLE calls ADD COLUMN samenvatting_gestart_op timestamptz;
ALTER TABLE open_items ADD COLUMN call_id uuid REFERENCES calls(id) ON DELETE SET NULL;
