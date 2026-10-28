-- Gespreksinstructie per planning (leeg = de algemene instructie uit Instellingen) en welke instructie een gesprek echt kreeg.
ALTER TABLE schedules ADD COLUMN gespreksinstructie text;
ALTER TABLE calls ADD COLUMN instructie text;
