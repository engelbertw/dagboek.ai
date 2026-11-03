-- Voorstellen voor de woordenlijst, uit gesprekken: een verkeerd gehoord woord (bijvoorbeeld "eKlantgeleiding") met de term die het waarschijnlijk moet zijn ("iKlantgeleiding").
-- Een voorstel verandert niets totdat de beheerder het goedkeurt. Er staat geen transcripttekst in: alleen het woord zoals gehoord, het voorstel en hoe vaak het is gezien.
-- Additief: een nieuwe tabel.
CREATE TABLE IF NOT EXISTS woordvoorstellen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term text NOT NULL,
  gehoord_als text NOT NULL,
  soort text NOT NULL DEFAULT 'product' CHECK (soort IN ('product', 'afdeling', 'persoon', 'overig')),
  bron text NOT NULL CHECK (bron IN ('e_voorvoegsel', 'naam_lijkt_op', 'model')),
  -- Genormaliseerde combinatie van gehoord woord en term: hetzelfde voorstel telt op in plaats van dubbel te verschijnen, en een afgewezen voorstel komt niet terug.
  sleutel text NOT NULL UNIQUE,
  aantal integer NOT NULL DEFAULT 1,
  eerste_call_id uuid REFERENCES calls(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'voorgesteld' CHECK (status IN ('voorgesteld', 'goedgekeurd', 'afgewezen')),
  beslist_door text,
  beslist_op timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  bijgewerkt_op timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS woordvoorstellen_status ON woordvoorstellen (status, aantal DESC);
