-- name: CreateGroupPost :one
INSERT INTO group_posts (user_id, body)
VALUES ($1, $2)
RETURNING *;

-- name: ListGroupPosts :many
SELECT * FROM group_posts
WHERE user_id = $1
ORDER BY created_at, id;

-- name: CountGroupPostsByUser :one
SELECT COUNT(*) FROM group_posts WHERE user_id = $1;

-- name: GetGroupPost :one
SELECT * FROM group_posts
WHERE id = $1 AND user_id = $2;

-- name: UpdateGroupPost :one
UPDATE group_posts
SET body = $3, updated_at = CURRENT_TIMESTAMP
WHERE id = $1 AND user_id = $2
RETURNING *;

-- name: DeleteGroupPost :execrows
DELETE FROM group_posts
WHERE id = $1 AND user_id = $2;

-- name: CreateGroupPostImage :one
INSERT INTO group_post_images (
    group_post_id, image_url, bunny_object_path, position
) VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListGroupPostImages :many
SELECT * FROM group_post_images
WHERE group_post_id = $1
ORDER BY position;

-- name: DeleteGroupPostImages :exec
DELETE FROM group_post_images WHERE group_post_id = $1;
