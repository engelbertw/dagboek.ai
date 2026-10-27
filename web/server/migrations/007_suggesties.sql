-- Voorstellen uit gesprekken: nieuwe onderwerpen om te volgen en verbeteringen voor dagboek.ai zelf.
CREATE TABLE suggesties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  soort text NOT NULL CHECK (soort IN ('onderwerp', 'verbetering')),
  tekst text NOT NULL,
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  call_id uuid REFERENCES calls(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'nieuw' CHECK (status IN ('nieuw', 'overgenomen', 'afgewezen', 'klaar')),
  topic_id uuid REFERENCES topics(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX suggesties_status ON suggesties(status, soort);
