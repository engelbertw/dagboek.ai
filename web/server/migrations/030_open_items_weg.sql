-- Opruimen: open_items is sinds 020 vervangen door activiteiten (soort 'intern', met dezelfde id) en wordt door geen enkele code meer gelezen of geschreven.
-- Eerst voor de zekerheid alles overnemen wat er nog niet staat (idempotent, zelfde afbeelding als 020), daarna de tabel laten vallen. Niet terug te draaien.
INSERT INTO activiteiten (id, topic_id, soort, omschrijving, call_id, eigenaar_id, eigenaar_extern, deadline, bron, controle_nodig, controle_reden,
                          deadline_oorspronkelijk, deadline_gewijzigd_aantal, jira_sleutel, jira_url, jira_aangemaakt_op, status, created_at, afgerond_op)
SELECT oi.id, oi.topic_id, 'intern', oi.tekst, oi.call_id, oi.eigenaar_id, oi.eigenaar_extern, oi.deadline, oi.bron, oi.controle_nodig, oi.controle_reden,
       oi.deadline_oorspronkelijk, oi.deadline_gewijzigd_aantal, oi.jira_sleutel, oi.jira_url, oi.jira_aangemaakt_op, oi.status, oi.created_at, oi.afgerond_op
FROM open_items oi
WHERE NOT EXISTS (SELECT 1 FROM activiteiten a WHERE a.id = oi.id);

DROP TABLE IF EXISTS open_items;
