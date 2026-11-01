-- Two profile fields the v2 export carries and the first schema dropped, because
-- there was nowhere to put them: the job title and the free-text aspirations
-- ("Other Aspirations"). Both feed the assistant's profile section.

ALTER TABLE profile ADD COLUMN job_title TEXT;
ALTER TABLE profile ADD COLUMN financial_goals TEXT;
