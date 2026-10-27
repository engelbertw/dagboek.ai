-- E-mailadres van een medewerker. Adressen die eerder als "E-mail: …" in de notitie stonden gaan naar het nieuwe veld.
ALTER TABLE employees ADD COLUMN email text NOT NULL DEFAULT '';
UPDATE employees SET email = substring(notitie from '^E-mail: (\S+)$'), notitie = '' WHERE notitie ~ '^E-mail: \S+$';
