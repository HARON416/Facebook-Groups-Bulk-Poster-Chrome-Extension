-- +goose Up
CREATE TABLE extension_auth_codes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX extension_auth_codes_user_id_idx ON extension_auth_codes (user_id);
CREATE INDEX extension_auth_codes_expires_at_idx ON extension_auth_codes (expires_at);

-- +goose Down
DROP TABLE IF EXISTS extension_auth_codes CASCADE;
