-- Eén register voor alles wat gedaan of bijgehouden moet worden: de punten per klant (klant_activiteiten) en de acties per onderwerp (open_items).
-- Additief: open_items blijft bestaan en wordt pas in een latere migratie opgeruimd.
ALTER TABLE klant_activiteiten RENAME TO activiteiten;
ALTER INDEX IF EXISTS klant_activiteiten_klant RENAME TO activiteiten_klant;
ALTER INDEX IF EXISTS klant_activiteiten_status RENAME TO activiteiten_status;

-- Een interne actie (wat wij zelf moeten doen) is een eigen soort.
ALTER TABLE activiteiten DROP CONSTRAINT IF EXISTS klant_activiteiten_soort_check;
ALTER TABLE activiteiten DROP CONSTRAINT IF EXISTS activiteiten_soort_check;
ALTER TABLE activiteiten ADD CONSTRAINT activiteiten_soort_check CHECK (soort IN ('doel', 'resultaat', 'afspraak', 'actie', 'kans', 'risico', 'intern'));

ALTER TABLE activiteiten ADD COLUMN IF NOT EXISTS topic_id uuid REFERENCES topics(id) ON DELETE CASCADE;
ALTER TABLE activiteiten ADD COLUMN IF NOT EXISTS bron text NOT NULL DEFAULT 'gesprek' CHECK (bron IN ('handmatig', 'gesprek'));
ALTER TABLE activiteiten ADD COLUMN IF NOT EXISTS deadline_oorspronkelijk date;
ALTER TABLE activiteiten ADD COLUMN IF NOT EXISTS deadline_gewijzigd_aantal integer NOT NULL DEFAULT 0;
ALTER TABLE activiteiten ADD COLUMN IF NOT EXISTS jira_sleutel text;
ALTER TABLE activiteiten ADD COLUMN IF NOT EXISTS jira_url text;
ALTER TABLE activiteiten ADD COLUMN IF NOT EXISTS jira_aangemaakt_op timestamptz;
CREATE INDEX IF NOT EXISTS activiteiten_topic ON activiteiten (topic_id);

-- De acties per onderwerp worden interne acties, met dezelfde id (Jira-koppelingen en verwijzingen blijven kloppen).
INSERT INTO activiteiten (id, topic_id, soort, omschrijving, call_id, eigenaar_id, eigenaar_extern, deadline, bron, controle_nodig, controle_reden,
                          deadline_oorspronkelijk, deadline_gewijzigd_aantal, jira_sleutel, jira_url, jira_aangemaakt_op, status, created_at, afgerond_op)
SELECT oi.id, oi.topic_id, 'intern', oi.tekst, oi.call_id, oi.eigenaar_id, oi.eigenaar_extern, oi.deadline, oi.bron, oi.controle_nodig, oi.controle_reden,
       oi.deadline_oorspronkelijk, oi.deadline_gewijzigd_aantal, oi.jira_sleutel, oi.jira_url, oi.jira_aangemaakt_op, oi.status, oi.created_at, oi.afgerond_op
FROM open_items oi
WHERE NOT EXISTS (SELECT 1 FROM activiteiten a WHERE a.id = oi.id);
