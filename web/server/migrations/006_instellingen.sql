-- Instellingen voor de hele omgeving, bijvoorbeeld de houding van de voice-assistent.
CREATE TABLE instellingen (
  sleutel text PRIMARY KEY,
  waarde text NOT NULL,
  bijgewerkt_op timestamptz NOT NULL DEFAULT now()
);
