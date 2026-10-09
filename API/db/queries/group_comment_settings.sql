-- name: GetGroupCommentSettings :one
SELECT * FROM group_comment_settings WHERE user_id = $1;

-- name: CreateGroupCommentSettings :exec
INSERT INTO group_comment_settings (user_id, enabled, options)
VALUES ($1, $2, $3)
ON CONFLICT (user_id) DO NOTHING;

-- name: UpsertGroupCommentSettings :one
INSERT INTO group_comment_settings (user_id, enabled, options)
VALUES ($1, $2, $3)
ON CONFLICT (user_id) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    options = EXCLUDED.options,
    updated_at = NOW()
RETURNING *;
