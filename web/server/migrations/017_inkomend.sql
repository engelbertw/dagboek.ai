-- Inkomende gesprekken: een medewerker belt zelf. Alleen een extra waarde voor de bron van een gesprek.
ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_bron_check;
ALTER TABLE calls ADD CONSTRAINT calls_bron_check CHECK (bron IN ('handmatig', 'schema', 'inkomend'));
