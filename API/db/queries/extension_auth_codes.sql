-- name: CreateExtensionAuthCode :one
INSERT INTO extension_auth_codes (
    user_id,
    code_hash,
    expires_at
) VALUES (
    $1,
    $2,
    $3
)
RETURNING
    id,
    user_id,
    code_hash,
    expires_at,
    used_at,
    created_at;

-- name: ConsumeExtensionAuthCode :one
UPDATE extension_auth_codes
SET used_at = NOW()
WHERE code_hash = $1
  AND used_at IS NULL
  AND expires_at > NOW()
RETURNING
    id,
    user_id,
    code_hash,
    expires_at,
    used_at,
    created_at;
