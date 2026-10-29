-- Overzicht tijdens een telefoongesprek: beheerders met een codewoord mogen de punten van collega's opvragen. Het codewoord staat alleen als hash,
-- in een eigen tabel zodat het nooit met de medewerkerslijst meekomt.
CREATE TABLE IF NOT EXISTS overzicht_toegang (
  employee_id uuid PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  codewoord_hash text NOT NULL,
  ingesteld_op timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE calls ADD COLUMN IF NOT EXISTS overzicht_geverifieerd_op timestamptz;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS overzicht_pogingen integer NOT NULL DEFAULT 0;
