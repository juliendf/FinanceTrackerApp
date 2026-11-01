-- Age matters for financial advice and the profile had nowhere to put it.
-- A date rather than a number: the age is computed when it is needed, so it
-- never goes stale in the database or in an exported backup.

ALTER TABLE profile ADD COLUMN birth_date TEXT;
