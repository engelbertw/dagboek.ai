-- Consultantdebriefs, fase 3: de levenscyclus van een module-implementatie bij een gemeente.
-- Het onderwerp (topics) blijft de identiteit (titel, gemeente, eigenaar, dagboek, activiteiten); deze tabel bevat uitsluitend wat een implementatie extra heeft.
-- Een onderwerp is een implementatie zodra er een rij is. Er verandert niets aan bestaande onderwerpen en geen enkel onderwerp krijgt automatisch een rij.

CREATE TABLE IF NOT EXISTS implementaties (
  topic_id uuid PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,
  module text NOT NULL CHECK (length(btrim(module)) > 0),
  bovenliggend_topic_id uuid REFERENCES topics(id) ON DELETE SET NULL CHECK (bovenliggend_topic_id IS NULL OR bovenliggend_topic_id <> topic_id),
  contactpersoon_id uuid REFERENCES klant_contacten(id) ON DELETE SET NULL,
  fase text NOT NULL DEFAULT 'voorbereiding' CHECK (fase IN ('voorbereiding', 'inrichting', 'test', 'acceptatie', 'ingebruikname', 'nazorg', 'afgerond')),
  geplande_livegang date,
  werkelijke_livegang date,
  test_status text NOT NULL DEFAULT 'niet_gestart' CHECK (test_status IN ('niet_gestart', 'bezig', 'afgerond')),
  acceptatie_op date,
  acceptatie_citaat text NOT NULL DEFAULT '',
  nazorg_tot date,
  bijgewerkt_op timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS implementaties_module ON implementaties (module);
CREATE INDEX IF NOT EXISTS implementaties_fase ON implementaties (fase);
CREATE INDEX IF NOT EXISTS implementaties_bovenliggend ON implementaties (bovenliggend_topic_id) WHERE bovenliggend_topic_id IS NOT NULL;
