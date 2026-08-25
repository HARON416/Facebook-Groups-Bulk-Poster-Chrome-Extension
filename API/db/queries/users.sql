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

-- name: GetUserByEmail :one
SELECT * FROM users WHERE lower(email) = lower(sqlc.arg(email))
ORDER BY created_at ASC
LIMIT 1;

-- name: GrantTemporaryPro :one
UPDATE users
SET
    access_tier = 'pro',
    pro_expires_at = sqlc.arg(pro_expires_at),
    pro_granted_at = CURRENT_TIMESTAMP,
    pro_grant_note = NULLIF(trim(sqlc.arg(pro_grant_note)::TEXT), ''),
    updated_at = CURRENT_TIMESTAMP
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: GrantLifetimePro :one
UPDATE users
SET
    access_tier = 'pro',
    pro_expires_at = NULL,
    pro_granted_at = CURRENT_TIMESTAMP,
    pro_grant_note = NULLIF(trim(sqlc.arg(pro_grant_note)::TEXT), ''),
    updated_at = CURRENT_TIMESTAMP
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: RevokePro :one
UPDATE users
SET
    access_tier = 'free',
    pro_expires_at = NULL,
    pro_granted_at = NULL,
    pro_grant_note = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: ExpireProAccess :one
UPDATE users
SET
    access_tier = 'free',
    pro_expires_at = NULL,
    pro_granted_at = NULL,
    pro_grant_note = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE id = sqlc.arg(id)
  AND access_tier = 'pro'
  AND pro_expires_at IS NOT NULL
  AND pro_expires_at <= CURRENT_TIMESTAMP
RETURNING *;

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
