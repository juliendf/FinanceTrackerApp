-- What an asset is made of: one row per instrument, by ISIN.
--
-- `quantity` is TEXT, not INTEGER: shares are fractional (12.5 ETF units) and
-- crypto is not measured in minor units at all. The CHECK keeps it a plain
-- positive decimal, and the value is normalised by the form before it lands.
--
-- There is deliberately no price and no value column. The snapshot is the only
-- valuation; a second one would start competing with it the first time a
-- quantity was wrong. Prices arrive with live market data (FIN-25), if ever.
--
-- `ON DELETE CASCADE` is declared, but `deleteAsset` still deletes explicitly:
-- the plugin's pooled connections do not all have `foreign_keys` switched on.
CREATE TABLE asset_holdings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id   INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    -- ISO 6166: two letters, nine alphanumerics, one check digit.
    isin       TEXT NOT NULL
               CHECK (isin GLOB '[A-Z][A-Z][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][0-9]'),
    quantity   TEXT NOT NULL
               CHECK (quantity GLOB '[0-9]*'
                      AND quantity NOT GLOB '*[^0-9.]*'
                      AND CAST(quantity AS REAL) > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    -- One line per instrument per asset; two lines for the same ISIN is a
    -- mistake, not a position split across accounts (that is two assets).
    CONSTRAINT uq_holding_asset_isin UNIQUE (asset_id, isin)
);

CREATE INDEX idx_asset_holdings_asset ON asset_holdings(asset_id);
