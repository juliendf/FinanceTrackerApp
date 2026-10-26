-- Phase 1: the rest of the v1 schema.
--
-- `0001_init.sql` covered the four spike tables. This adds everything the
-- remaining screens need, per the schema guidance in the brief:
--   * no user_id anywhere; per-*user* uniques become global
--   * money as INTEGER minor units, rates as TEXT decimals
--   * secrets as Keychain references, never as columns
--   * ChatJob is deliberately absent (replaced by a Tauri Channel)
--   * the former User profile fields become a single-row `profile` table

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------
CREATE TABLE tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    color      TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CONSTRAINT uq_tag_name UNIQUE (name)
);

CREATE TABLE asset_tags (
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (asset_id, tag_id)
);

CREATE INDEX idx_asset_tags_tag ON asset_tags(tag_id);

-- ---------------------------------------------------------------------------
-- Settings: key/value, values stored as text (booleans as 'true'/'false')
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CONSTRAINT uq_settings_key UNIQUE (key)
);

-- ---------------------------------------------------------------------------
-- Exchange rates: TEXT decimals, both directions seeded explicitly
-- ---------------------------------------------------------------------------
CREATE TABLE exchange_rates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    from_currency TEXT NOT NULL CHECK (from_currency IN ('EUR', 'USD', 'CHF')),
    to_currency   TEXT NOT NULL CHECK (to_currency IN ('EUR', 'USD', 'CHF')),
    rate          TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CONSTRAINT uq_exchange_rate_pair UNIQUE (from_currency, to_currency),
    CHECK (from_currency <> to_currency)
);

-- ---------------------------------------------------------------------------
-- LLM providers: the API key lives in the Keychain, this table keeps a ref
-- ---------------------------------------------------------------------------
CREATE TABLE llm_providers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    base_url      TEXT NOT NULL,
    keychain_ref  TEXT,
    model         TEXT NOT NULL,
    provider_type TEXT NOT NULL DEFAULT 'openai',
    is_default    INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CONSTRAINT uq_llm_provider_name UNIQUE (name)
);

-- Exactly one default provider.
CREATE UNIQUE INDEX uq_llm_provider_default ON llm_providers(is_default) WHERE is_default = 1;

-- ---------------------------------------------------------------------------
-- Profile: single row (id is pinned to 1), replacing the former User columns
-- ---------------------------------------------------------------------------
CREATE TABLE profile (
    id                           INTEGER PRIMARY KEY CHECK (id = 1),
    first_name                   TEXT,
    last_name                    TEXT,
    currency                     TEXT NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR', 'USD', 'CHF')),
    timezone                     TEXT NOT NULL DEFAULT 'UTC',
    date_format                  TEXT NOT NULL DEFAULT '%Y-%m-%d',
    salary_minor                 INTEGER,
    monthly_savings_target_minor INTEGER,
    risk_profile                 TEXT,
    ai_tone                      TEXT DEFAULT 'encouraging',
    ai_verbosity                 TEXT DEFAULT 'balanced',
    ai_expertise                 TEXT DEFAULT 'intermediate',
    created_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- Chat. No chat_jobs table: streaming is a Tauri Channel, not a polling table.
-- ---------------------------------------------------------------------------
CREATE TABLE conversations (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id    INTEGER REFERENCES llm_providers(id) ON DELETE SET NULL,
    model_override TEXT,
    title          TEXT NOT NULL DEFAULT 'New conversation',
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
    content         TEXT NOT NULL DEFAULT '',
    -- JSON array, assistant messages only
    tool_calls      TEXT,
    -- set on role='tool'
    tool_call_id    TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, id);

CREATE TABLE pending_actions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    -- v1: only 'create_snapshot'
    action_type     TEXT NOT NULL,
    -- JSON payload
    payload         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired', 'failed')),
    result_message  TEXT,
    resolved_at     TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_pending_actions_status ON pending_actions(status);

-- ---------------------------------------------------------------------------
-- Memories and goals
-- ---------------------------------------------------------------------------
CREATE TABLE user_memories (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    category        TEXT NOT NULL
                    CHECK (category IN ('personal', 'financial', 'goal', 'preference', 'life_event')),
    key             TEXT NOT NULL,
    content         TEXT NOT NULL,
    source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai_extracted')),
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    importance      INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_user_memories_key ON user_memories(key);

CREATE TABLE user_goals (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    label               TEXT NOT NULL,
    target_amount_minor INTEGER,
    target_date         TEXT,
    priority            TEXT NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('low', 'medium', 'high')),
    category            TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
