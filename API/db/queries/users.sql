-- name: CreateUser :one
INSERT INTO users (
    email,
    password_hash
) VALUES (
    $1,
    $2
)
RETURNING
    id,
    email,
    password_hash,
    created_at;
