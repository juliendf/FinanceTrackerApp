-- Three facts succession advice needs and the portfolio cannot imply.
--
-- * marital_status: who inherits by default, and how the income is taxed;
-- * marital_regime: in Switzerland the regime decides what actually transfers,
--   so "married" on its own is not an answer;
-- * has_will: "no will" is an action item, "not stated" is a question to ask,
--   which is why it is NULL rather than 0.
--
-- All optional. An unset field is absent from the assistant's context, not a
-- default.
ALTER TABLE profile ADD COLUMN marital_status TEXT;
ALTER TABLE profile ADD COLUMN marital_regime TEXT;
ALTER TABLE profile ADD COLUMN has_will INTEGER;
