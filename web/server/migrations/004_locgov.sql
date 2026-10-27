-- LOCGOV-gebruikersnaam van een medewerker (het account is gebruikersnaam@LOCGOV.NL).
ALTER TABLE employees ADD COLUMN locgov_gebruikersnaam text NOT NULL DEFAULT '';
