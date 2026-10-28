-- Acties uit het taalmodel die niet te verifiëren zijn krijgen 'controle nodig' in plaats van als feit te gelden.
-- Deadlinewijzigingen worden bijgehouden zodat het dashboard feiten kan tonen in plaats van een oordeel.
ALTER TABLE open_items ADD COLUMN IF NOT EXISTS bron text NOT NULL DEFAULT 'handmatig' CHECK (bron IN ('handmatig', 'gesprek'));
ALTER TABLE open_items ADD COLUMN IF NOT EXISTS controle_nodig boolean NOT NULL DEFAULT false;
ALTER TABLE open_items ADD COLUMN IF NOT EXISTS controle_reden text;
ALTER TABLE open_items ADD COLUMN IF NOT EXISTS deadline_oorspronkelijk date;
ALTER TABLE open_items ADD COLUMN IF NOT EXISTS deadline_gewijzigd_aantal integer NOT NULL DEFAULT 0;
UPDATE open_items SET bron = 'gesprek' WHERE call_id IS NOT NULL AND bron = 'handmatig';
UPDATE open_items SET deadline_oorspronkelijk = deadline WHERE deadline IS NOT NULL AND deadline_oorspronkelijk IS NULL;
