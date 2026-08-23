-- name: UpsertGoogleUser :one
INSERT INTO users (
    google_subject, email, email_verified, display_name, avatar_url, timezone
) VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (google_subject) DO UPDATE SET
    email = EXCLUDED.email,
    email_verified = EXCLUDED.email_verified,
    display_name = EXCLUDED.display_name,
    avatar_url = EXCLUDED.avatar_url,
    -- The first sign-in fixes the accounting timezone. A browser timezone
    -- change must not silently move the user's daily reset boundary.
    timezone = users.timezone,
    updated_at = CURRENT_TIMESTAMP
RETURNING *;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: CreateAuthSession :one
INSERT INTO auth_sessions (user_id, token_hash, expires_at)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetAuthSessionByTokenHash :one
SELECT * FROM auth_sessions
WHERE token_hash = $1 AND expires_at > CURRENT_TIMESTAMP;

-- name: TouchAuthSession :exec
UPDATE auth_sessions
SET last_used_at = CURRENT_TIMESTAMP
WHERE id = $1;

-- name: DeleteAuthSessionByTokenHash :exec
DELETE FROM auth_sessions WHERE token_hash = $1;

-- name: DeleteExpiredAuthSessions :exec
DELETE FROM auth_sessions WHERE expires_at <= CURRENT_TIMESTAMP;
