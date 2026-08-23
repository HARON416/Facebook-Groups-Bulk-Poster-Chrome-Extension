-- name: LockUserForUsage :one
SELECT * FROM users
WHERE id = sqlc.arg(user_id)
FOR UPDATE;

-- name: GetPostingUsageClaim :one
SELECT * FROM posting_usage_claims
WHERE user_id = sqlc.arg(user_id)
  AND kind = sqlc.arg(kind)
  AND operation_id = sqlc.arg(operation_id);

-- name: CreatePostingUsageClaim :one
INSERT INTO posting_usage_claims (
    user_id, kind, operation_id, claimed_at, expires_at
) VALUES (
    sqlc.arg(user_id), sqlc.arg(kind), sqlc.arg(operation_id),
    sqlc.arg(claimed_at), sqlc.arg(expires_at)
)
RETURNING *;

-- name: MarkPostingUsageClaimSucceeded :one
UPDATE posting_usage_claims
SET
    status = 'succeeded',
    succeeded_at = CURRENT_TIMESTAMP,
    released_at = NULL
WHERE user_id = sqlc.arg(user_id)
  AND kind = sqlc.arg(kind)
  AND operation_id = sqlc.arg(operation_id)
  AND status = 'claimed'
RETURNING *;

-- name: ReleasePostingUsageClaim :one
UPDATE posting_usage_claims
SET
    status = 'released',
    succeeded_at = NULL,
    released_at = CURRENT_TIMESTAMP
WHERE user_id = sqlc.arg(user_id)
  AND kind = sqlc.arg(kind)
  AND operation_id = sqlc.arg(operation_id)
  AND status = 'claimed'
RETURNING *;

-- name: GetPostingUsageSummary :one
SELECT
    COUNT(*)::BIGINT AS used,
    CASE
        WHEN COUNT(*) > 0 THEN sqlc.arg(window_end)::TIMESTAMPTZ
        ELSE NULL
    END::TIMESTAMPTZ AS reset_at
FROM posting_usage_claims
WHERE user_id = sqlc.arg(user_id)
  AND kind = sqlc.arg(kind)
  AND claimed_at >= sqlc.arg(window_start)::TIMESTAMPTZ
  AND claimed_at < sqlc.arg(window_end)::TIMESTAMPTZ
  AND (
      status = 'succeeded'
      OR (status = 'claimed' AND expires_at > CURRENT_TIMESTAMP)
  );
