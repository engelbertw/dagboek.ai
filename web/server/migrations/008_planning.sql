-- Een planning (terugkerende taak) kan meerdere medewerkers en tijden hebben. Bestaande schema's worden planningen met één medewerker.
ALTER TABLE schedules ADD COLUMN naam text NOT NULL DEFAULT '';
CREATE TABLE schedule_employees (
  schedule_id uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  PRIMARY KEY (schedule_id, employee_id)
);
INSERT INTO schedule_employees (schedule_id, employee_id) SELECT id, employee_id FROM schedules;
ALTER TABLE schedules DROP COLUMN employee_id;

-- Elk automatisch gesprek hoort bij een planning, een tijdstip en een pogingnummer; de unieke index voorkomt dubbel bellen.
ALTER TABLE calls ADD COLUMN schedule_id uuid REFERENCES schedules(id) ON DELETE SET NULL;
ALTER TABLE calls ADD COLUMN slot_start timestamptz;
ALTER TABLE calls ADD COLUMN poging integer NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX calls_slot_poging ON calls(schedule_id, employee_id, slot_start, poging) WHERE schedule_id IS NOT NULL;
