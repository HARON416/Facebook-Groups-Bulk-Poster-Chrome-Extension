-- +goose Up
-- The original baseline migration was already applied in production before
-- these Pro-access fields were added to it. Keep this forward migration
-- idempotent so both existing and fresh databases converge on the same schema.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS pro_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pro_granted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pro_grant_note TEXT;

-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'users'::regclass
          AND conname = 'users_pro_grant_check'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_pro_grant_check CHECK (
                access_tier = 'pro' OR (
                    pro_expires_at IS NULL AND
                    pro_granted_at IS NULL AND
                    pro_grant_note IS NULL
                )
            );
    END IF;
END
$$;
-- +goose StatementEnd

-- +goose Down
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_pro_grant_check,
    DROP COLUMN IF EXISTS pro_grant_note,
    DROP COLUMN IF EXISTS pro_granted_at,
    DROP COLUMN IF EXISTS pro_expires_at;
