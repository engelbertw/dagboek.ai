-- Het veld Sales AM is vervallen: de accountmanager bij de klant is de enige verantwoordelijke. De code gebruikt de kolom sinds de vorige uitrol niet meer.
ALTER TABLE klanten DROP COLUMN IF EXISTS sales_am;
