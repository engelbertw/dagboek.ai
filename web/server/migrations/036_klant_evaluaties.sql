-- Evaluaties uit iThermometer (handmatig geimporteerd uit een Feedback rapport). `sleutel` voorkomt dubbelen: dezelfde evaluatie (gemeente, datum, contact,
-- business unit) kan nooit twee keer voorkomen, ook niet bij gelijktijdig importeren. `inhoud_hash` laat zien of een bestaande evaluatie is gewijzigd.
CREATE TABLE IF NOT EXISTS klant_evaluaties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  klant_id uuid NOT NULL REFERENCES klanten(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES klant_contacten(id) ON DELETE SET NULL,
  bron text NOT NULL DEFAULT 'ithermometer',
  sleutel text NOT NULL,
  inhoud_hash text NOT NULL,
  gemeente_naam text NOT NULL,
  datum date NOT NULL,
  aangemaakt_in_bron date,
  contact_naam text NOT NULL DEFAULT '',
  contact_functie text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  contact_telefoon text NOT NULL DEFAULT '',
  business_unit text NOT NULL DEFAULT '',
  scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  toelichting jsonb NOT NULL DEFAULT '[]'::jsonb,
  themas text NOT NULL DEFAULT '',
  domeinfeedback text NOT NULL DEFAULT '',
  geimporteerd_door text NOT NULL DEFAULT '',
  geimporteerd_op timestamptz NOT NULL DEFAULT now(),
  bijgewerkt_op timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS klant_evaluaties_sleutel ON klant_evaluaties (sleutel);
CREATE INDEX IF NOT EXISTS klant_evaluaties_klant ON klant_evaluaties (klant_id, datum DESC);
