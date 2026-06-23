-- +goose Up
CREATE TABLE extension_accesses (
    id SERIAL PRIMARY KEY,
    install_id_hash VARCHAR(255) NOT NULL UNIQUE,
    activation_id VARCHAR(64) NOT NULL UNIQUE,
    trial_expires_at TIMESTAMPTZ NOT NULL,
    lifetime_active BOOLEAN NOT NULL DEFAULT FALSE,
    activated_at TIMESTAMPTZ,
    admin_note TEXT,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX extension_accesses_trial_expires_at_idx ON extension_accesses (trial_expires_at);
CREATE INDEX extension_accesses_lifetime_active_idx ON extension_accesses (lifetime_active);

-- +goose Down
DROP TABLE IF EXISTS extension_accesses CASCADE;
