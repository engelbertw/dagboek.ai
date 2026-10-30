-- Extra gegevens per klant (gemeente) en per contactpersoon, uit de klantenlijst van sales. Alleen toevoegen.
ALTER TABLE klanten ADD COLUMN IF NOT EXISTS samenwerkingsverband text NOT NULL DEFAULT '';
ALTER TABLE klanten ADD COLUMN IF NOT EXISTS inwoners integer CHECK (inwoners IS NULL OR inwoners >= 0);
ALTER TABLE klanten ADD COLUMN IF NOT EXISTS sales_am text NOT NULL DEFAULT '';
ALTER TABLE klant_contacten ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '';
ALTER TABLE klant_contacten ADD COLUMN IF NOT EXISTS telefoon text NOT NULL DEFAULT '';
