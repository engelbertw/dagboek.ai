-- Gespreksmotor per gesprek (Pipecat of ElevenLabs-agent) en een beoordeling om de motoren te kunnen vergelijken. Alleen toevoegingen.
ALTER TABLE calls ADD COLUMN IF NOT EXISTS engine text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS beoordeling smallint CHECK (beoordeling BETWEEN 1 AND 5);
ALTER TABLE calls ADD COLUMN IF NOT EXISTS beoordeling_opmerking text;
