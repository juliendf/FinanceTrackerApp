-- The last known price per unit, in the asset's currency.
--
-- Not a purchase price and not history: the snapshot remains the valuation of
-- the asset, and this is what lets the composition be read ("A is 54% of it").
-- The two are compared on screen, so a stale price shows up as a gap rather than
-- as a silent disagreement.
--
-- TEXT like every other decimal: 45.2 and 45.20 must stay distinguishable in
-- storage and exact in arithmetic.
ALTER TABLE asset_holdings ADD COLUMN price TEXT;
