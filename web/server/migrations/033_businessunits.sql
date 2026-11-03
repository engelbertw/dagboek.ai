-- Businessunits, en functie + businessunit bij medewerkers en gebruikers. Additief: bestaande gegevens veranderen niet.
-- Afdelingen/teams per unit komen later (nog niet bevestigd); een tabel `afdelingen (business_unit_id)` kan daarna zonder verandering hieraan.
CREATE TABLE IF NOT EXISTS business_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  naam text NOT NULL UNIQUE,
  afkorting text NOT NULL UNIQUE,
  volgorde integer NOT NULL DEFAULT 100,
  actief boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO business_units (naam, afkorting, volgorde) VALUES
  ('Publiekszaken', 'PZ', 10),
  ('Informatievoorziening', 'IV', 20),
  ('Proces & Services', 'P&S', 30),
  ('Financiën & Services', 'F&S', 40),
  ('Samenlevingszaken', 'SAM', 50),
  ('Ruimte & Omgeving', 'R&O', 60),
  ('Inzicht', 'iNzicht', 70)
ON CONFLICT DO NOTHING;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS functie text NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS business_unit_id uuid REFERENCES business_units(id) ON DELETE SET NULL;

-- Gebruikers staan in Keycloak; hun functie en unit staan hier, op (kleine letters) e-mailadres.
CREATE TABLE IF NOT EXISTS gebruikersprofielen (
  email text PRIMARY KEY,
  functie text NOT NULL DEFAULT '',
  business_unit_id uuid REFERENCES business_units(id) ON DELETE SET NULL,
  bijgewerkt_op timestamptz NOT NULL DEFAULT now()
);
