-- Verkoop-debrief: een accountmanager belt in na een klantbezoek. Alles is additief: bestaande medewerkers en gesprekken blijven gewoon 'medewerker' en 'dagboek'.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS rol text NOT NULL DEFAULT 'medewerker';
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_rol_check;
ALTER TABLE employees ADD CONSTRAINT employees_rol_check CHECK (rol IN ('medewerker', 'accountmanager'));

ALTER TABLE calls ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'dagboek';
ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_type_check;
ALTER TABLE calls ADD CONSTRAINT calls_type_check CHECK (type IN ('dagboek', 'verkoop_debrief'));

-- Lichte klantenadministratie: alleen de stamgegevens die we echt nodig hebben. AFAS (later) is de bron voor stamgegevens, de gesprekken voor activiteiten.
CREATE TABLE IF NOT EXISTS klanten (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  naam text NOT NULL,
  afas_id text,
  status text NOT NULL DEFAULT 'voorgesteld' CHECK (status IN ('prospect', 'klant', 'voorgesteld', 'inactief')),
  accountmanager_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  omschrijving text NOT NULL DEFAULT '',
  contract_einde date,
  bron text NOT NULL DEFAULT 'handmatig' CHECK (bron IN ('handmatig', 'gesprek', 'afas')),
  bijgewerkt_op timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS klanten_afas_id ON klanten (afas_id) WHERE afas_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS klanten_accountmanager ON klanten (accountmanager_id);

CREATE TABLE IF NOT EXISTS klant_contacten (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  klant_id uuid NOT NULL REFERENCES klanten(id) ON DELETE CASCADE,
  naam text NOT NULL,
  functie text NOT NULL DEFAULT '',
  rol text NOT NULL DEFAULT '',
  call_id uuid REFERENCES calls(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS klant_contacten_klant ON klant_contacten (klant_id);

-- Eén bezoek is één debrief-gesprek; een gesprek zonder herkenbare klant heeft geen klant_id tot de beheerder het koppelt.
CREATE TABLE IF NOT EXISTS bezoeken (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  klant_id uuid REFERENCES klanten(id) ON DELETE SET NULL,
  call_id uuid REFERENCES calls(id) ON DELETE SET NULL,
  accountmanager_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  klant_naam_genoemd text NOT NULL DEFAULT '',
  datum date,
  soort text NOT NULL DEFAULT '',
  tevredenheid integer CHECK (tevredenheid BETWEEN 1 AND 10),
  samenvatting text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bezoeken_call ON bezoeken (call_id) WHERE call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bezoeken_klant ON bezoeken (klant_id);

-- Alles wat de accountmanager meldt, als één tijdlijn per klant. Per soort staan de extra velden in details (bijvoorbeeld bij een kans: fase, bedrag, beslisser).
CREATE TABLE IF NOT EXISTS klant_activiteiten (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  klant_id uuid REFERENCES klanten(id) ON DELETE CASCADE,
  bezoek_id uuid REFERENCES bezoeken(id) ON DELETE CASCADE,
  soort text NOT NULL CHECK (soort IN ('doel', 'resultaat', 'afspraak', 'actie', 'kans', 'risico')),
  omschrijving text NOT NULL,
  eigenaar_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  eigenaar_extern text NOT NULL DEFAULT '',
  deadline date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'afgerond')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  citaat text NOT NULL DEFAULT '',
  controle_nodig boolean NOT NULL DEFAULT false,
  controle_reden text,
  call_id uuid REFERENCES calls(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  afgerond_op timestamptz
);
CREATE INDEX IF NOT EXISTS klant_activiteiten_klant ON klant_activiteiten (klant_id);
CREATE INDEX IF NOT EXISTS klant_activiteiten_status ON klant_activiteiten (status, soort);
