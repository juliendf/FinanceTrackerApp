-- Country of tax residence, as an ISO 3166-1 alpha-2 code (CH, FR, US…).
--
-- Not in the source app. It is context the assistant needs to reason about
-- tax-advantaged accounts, contribution limits and jurisdiction-specific products,
-- and it is the kind of thing a portfolio summary cannot infer from the assets.
ALTER TABLE profile ADD COLUMN tax_residence TEXT;
