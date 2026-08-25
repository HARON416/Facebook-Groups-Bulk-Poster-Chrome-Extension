-- name: ListFacebookGroupPostingStats :many
SELECT *
FROM facebook_group_posting_stats
WHERE user_id = sqlc.arg(user_id)
  AND actor_hash = sqlc.arg(actor_hash)
  AND group_id = ANY(sqlc.arg(group_ids)::TEXT[])
ORDER BY accepted_count ASC, last_accepted_at ASC NULLS FIRST, group_id ASC;

-- name: InsertFacebookGroupPostingEvent :execrows
INSERT INTO facebook_group_posting_events (
    user_id, actor_hash, group_id, operation_id, accepted_at
) VALUES (
    sqlc.arg(user_id), sqlc.arg(actor_hash), sqlc.arg(group_id),
    sqlc.arg(operation_id), sqlc.arg(accepted_at)
)
ON CONFLICT (user_id, actor_hash, operation_id) DO NOTHING;

-- name: GetFacebookGroupPostingEvent :one
SELECT *
FROM facebook_group_posting_events
WHERE user_id = sqlc.arg(user_id)
  AND actor_hash = sqlc.arg(actor_hash)
  AND operation_id = sqlc.arg(operation_id);

-- name: IncrementFacebookGroupPostingStat :one
INSERT INTO facebook_group_posting_stats (
    user_id, actor_hash, group_id, group_name,
    accepted_count, last_accepted_at, created_at, updated_at
) VALUES (
    sqlc.arg(user_id), sqlc.arg(actor_hash), sqlc.arg(group_id),
    sqlc.arg(group_name), 1, sqlc.arg(accepted_at),
    sqlc.arg(accepted_at), sqlc.arg(accepted_at)
)
ON CONFLICT (user_id, actor_hash, group_id) DO UPDATE SET
    group_name = EXCLUDED.group_name,
    accepted_count = facebook_group_posting_stats.accepted_count + 1,
    last_accepted_at = EXCLUDED.last_accepted_at,
    updated_at = EXCLUDED.updated_at
RETURNING *;

-- name: GetFacebookGroupPostingStat :one
SELECT *
FROM facebook_group_posting_stats
WHERE user_id = sqlc.arg(user_id)
  AND actor_hash = sqlc.arg(actor_hash)
  AND group_id = sqlc.arg(group_id);
