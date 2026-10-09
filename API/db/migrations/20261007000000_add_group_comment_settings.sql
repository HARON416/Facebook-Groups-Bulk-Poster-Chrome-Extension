-- +goose Up
CREATE TABLE group_comment_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    options TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT group_comment_options_count CHECK (cardinality(options) <= 50)
);

-- +goose Down
DROP TABLE group_comment_settings;
