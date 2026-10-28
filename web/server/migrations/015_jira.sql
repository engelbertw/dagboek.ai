-- Een open punt kan als ticket in Jira staan. De sleutel is uniek, zodat een punt nooit twee tickets krijgt.
ALTER TABLE open_items ADD COLUMN IF NOT EXISTS jira_sleutel text;
ALTER TABLE open_items ADD COLUMN IF NOT EXISTS jira_url text;
ALTER TABLE open_items ADD COLUMN IF NOT EXISTS jira_aangemaakt_op timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS open_items_jira_sleutel ON open_items(jira_sleutel) WHERE jira_sleutel IS NOT NULL;
