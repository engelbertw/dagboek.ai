-- Open punten worden acties in het activiteitenregister: met eigenaar (collega of iemand buiten het team) en deadline.
ALTER TABLE open_items ADD COLUMN eigenaar_id uuid REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE open_items ADD COLUMN eigenaar_extern text NOT NULL DEFAULT '';
ALTER TABLE open_items ADD COLUMN deadline date;
UPDATE open_items SET eigenaar_id = (SELECT eigenaar_id FROM topics WHERE topics.id = open_items.topic_id);
CREATE INDEX open_items_status_deadline ON open_items(status, deadline);
