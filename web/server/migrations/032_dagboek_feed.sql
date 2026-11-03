-- Dagboek-feed: persoonlijke RSS-links (alleen de hash van het geheim wordt bewaard) en een bewaard dagdigest.
CREATE TABLE IF NOT EXISTS feed_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  rol text NOT NULL,
  label text NOT NULL DEFAULT '',
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  laatst_gebruikt timestamptz,
  ingetrokken_op timestamptz
);
CREATE INDEX IF NOT EXISTS feed_tokens_email ON feed_tokens (lower(email));

-- Eén samenvatting per periode (dagen); hij is actueel zolang er geen nieuwer verslag is dan `laatste_item`.
CREATE TABLE IF NOT EXISTS dagboek_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dagen integer NOT NULL,
  tekst text NOT NULL,
  aantal_items integer NOT NULL DEFAULT 0,
  laatste_item timestamptz,
  gemaakt_op timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dagboek_digests_dagen ON dagboek_digests (dagen, gemaakt_op DESC);
