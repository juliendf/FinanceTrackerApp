-- Phase 0 spike schema.
--
-- Only the four tables the spike exercises: institutions, categories, assets,
-- snapshots. The full v1 schema (tags, settings, exchange rates, LLM
-- providers, profile, goals, memories, chat) lands in Phase 1.
--
-- Departures from the Flask/Postgres source, per the brief:
--   * no user_id anywhere (single user, no login)
--   * per-user uniques become global
--   * snapshots.amount is INTEGER minor units, not Float
--   * assets.cost_charges / interest_rate are TEXT decimal strings, not Float
--   * dates are ISO TEXT, timestamps are ISO-8601 UTC TEXT

CREATE TABLE institutions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CONSTRAINT uq_institution_name UNIQUE (name)
);

CREATE TABLE categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT,
    color       TEXT DEFAULT '#6c757d'
                CHECK (color IS NULL OR color GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]'),
    -- cash | emergency_fund | stocks | other | ... (see app/utils/constants.py)
    system_role TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CONSTRAINT uq_category_name UNIQUE (name)
);

CREATE TABLE assets (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
    category_id    INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    currency       TEXT NOT NULL CHECK (currency IN ('EUR', 'USD', 'CHF')),
    product_name   TEXT NOT NULL,
    name           TEXT,
    description    TEXT,
    notes          TEXT,
    code_nin       TEXT,
    cost_charges   TEXT CHECK (cost_charges IS NULL OR cost_charges GLOB '[0-9]*'),
    interest_rate  TEXT CHECK (interest_rate IS NULL OR interest_rate GLOB '[0-9]*'),
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_assets_institution ON assets(institution_id);
CREATE INDEX idx_assets_category ON assets(category_id);
CREATE INDEX idx_assets_currency ON assets(currency);

CREATE TABLE snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id     INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    date         TEXT NOT NULL
                 CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    amount_minor INTEGER NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CONSTRAINT uq_snapshot_asset_date UNIQUE (asset_id, date)
);

CREATE INDEX idx_snapshot_asset_date ON snapshots(asset_id, date);
CREATE INDEX idx_snapshot_date ON snapshots(date);
