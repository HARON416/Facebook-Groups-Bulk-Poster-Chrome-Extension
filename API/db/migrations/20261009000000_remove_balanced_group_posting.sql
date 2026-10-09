-- +goose Up
-- Retire the history and event ledger used only by even-distribution posting.
-- Posting allowance accounting remains in posting_usage_events.
DROP TABLE IF EXISTS facebook_group_posting_events;
DROP TABLE IF EXISTS facebook_group_posting_stats;

-- +goose Down
-- Restore the table structure; previously removed history cannot be recovered.
CREATE TABLE facebook_group_posting_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_hash VARCHAR(64) NOT NULL,
    group_id VARCHAR(64) NOT NULL,
    group_name TEXT NOT NULL,
    accepted_count BIGINT NOT NULL DEFAULT 0,
    last_accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT facebook_group_posting_stats_actor_hash_length_check
        CHECK (char_length(actor_hash) = 64),
    CONSTRAINT facebook_group_posting_stats_group_id_check
        CHECK (char_length(trim(group_id)) > 0),
    CONSTRAINT facebook_group_posting_stats_group_name_check
        CHECK (char_length(trim(group_name)) > 0),
    CONSTRAINT facebook_group_posting_stats_accepted_count_check
        CHECK (accepted_count >= 0),
    CONSTRAINT facebook_group_posting_stats_identity_unique
        UNIQUE (user_id, actor_hash, group_id)
);

CREATE INDEX facebook_group_posting_stats_balance_idx
    ON facebook_group_posting_stats (
        user_id, actor_hash, accepted_count, last_accepted_at, group_id
    );

-- The ledger makes accepted-count recording idempotent when an extension
-- retries an API request after an uncertain network response.
CREATE TABLE facebook_group_posting_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_hash VARCHAR(64) NOT NULL,
    group_id VARCHAR(64) NOT NULL,
    operation_id UUID NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT facebook_group_posting_events_actor_hash_length_check
        CHECK (char_length(actor_hash) = 64),
    CONSTRAINT facebook_group_posting_events_group_id_check
        CHECK (char_length(trim(group_id)) > 0),
    CONSTRAINT facebook_group_posting_events_operation_unique
        UNIQUE (user_id, actor_hash, operation_id)
);

CREATE INDEX facebook_group_posting_events_group_idx
    ON facebook_group_posting_events (user_id, actor_hash, group_id, accepted_at);

