-- +goose Up
CREATE TABLE
    users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

-- +goose StatementBegin
SELECT
    'up SQL query';

-- +goose StatementEnd
-- +goose Down
DROP TABLE IF EXISTS users CASCADE;

-- +goose StatementBegin
SELECT
    'down SQL query';

-- +goose StatementEnd