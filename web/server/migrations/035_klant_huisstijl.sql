-- Huisstijl per gemeente voor het PDF-rapport: website, accentkleur en logo (base64). Alleen gevuld na bevestiging door de beheerder.
ALTER TABLE klanten ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE klanten ADD COLUMN IF NOT EXISTS huisstijl_kleur text;
ALTER TABLE klanten ADD COLUMN IF NOT EXISTS huisstijl_logo text;
ALTER TABLE klanten ADD COLUMN IF NOT EXISTS huisstijl_logo_type text;
ALTER TABLE klanten ADD COLUMN IF NOT EXISTS huisstijl_bevestigd_op timestamptz;
