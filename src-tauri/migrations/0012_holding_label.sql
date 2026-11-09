-- A name for a holding.
--
-- The ISIN identifies an instrument, but `IE00B4L5Y983` does not read like
-- "iShares MSCI World". Optional: the ISIN alone is enough to know what the row
-- is, and forcing a name would make people invent one.
ALTER TABLE asset_holdings ADD COLUMN label TEXT;
