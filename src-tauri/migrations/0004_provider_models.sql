-- Models a provider offers, and whether chat may use them.
--
-- Chat used to take whatever model id the provider row held. The form now asks
-- the endpoint for its list and lets the user enable the ones worth choosing
-- between; `llm_providers.model` stays as the default for the provider.

CREATE TABLE provider_models (
    provider_id INTEGER NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
    model       TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (provider_id, model)
);

CREATE INDEX idx_provider_models_provider ON provider_models(provider_id);
