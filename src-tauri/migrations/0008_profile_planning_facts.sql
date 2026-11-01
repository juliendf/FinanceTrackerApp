-- Three facts the advice needs and the portfolio cannot imply.
--
-- * monthly living expenses: without it there is no savings rate, no runway and
--   no way to tell whether a goal is affordable;
-- * dependants: they size the emergency buffer and decide whether insurance is
--   part of the conversation at all;
-- * employment status: a self-employed income needs a longer buffer than a
--   permanent one, and the assistant otherwise assumes "salary" is permanent.
--
-- All optional: an unset field is simply absent from the assistant's context.
ALTER TABLE profile ADD COLUMN monthly_expenses_minor INTEGER;
ALTER TABLE profile ADD COLUMN dependants_count INTEGER;
ALTER TABLE profile ADD COLUMN dependant_ages TEXT;
ALTER TABLE profile ADD COLUMN employment_status TEXT;
