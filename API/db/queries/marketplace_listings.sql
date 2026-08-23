-- name: CreateMarketplaceListing :one
INSERT INTO marketplace_listings (
    user_id, listing_type, price, description, location
) VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: ListMarketplaceListings :many
SELECT * FROM marketplace_listings
WHERE user_id = $1
ORDER BY updated_at DESC, id;

-- name: CountMarketplaceListingsByUser :one
SELECT COUNT(*) FROM marketplace_listings WHERE user_id = $1;

-- name: GetMarketplaceListing :one
SELECT * FROM marketplace_listings
WHERE id = $1 AND user_id = $2;

-- name: UpdateMarketplaceListing :one
UPDATE marketplace_listings
SET
    price = $3,
    description = $4,
    location = $5,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $1 AND user_id = $2
RETURNING *;

-- name: CreateMarketplaceItemDetails :one
INSERT INTO marketplace_item_details (
    listing_id, title, category_group, category, condition
) VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetMarketplaceItemDetails :one
SELECT * FROM marketplace_item_details WHERE listing_id = $1;

-- name: UpdateMarketplaceItemDetails :one
UPDATE marketplace_item_details
SET title = $2, category_group = $3, category = $4, condition = $5
WHERE listing_id = $1
RETURNING *;

-- name: CreateMarketplaceVehicleDetails :one
INSERT INTO marketplace_vehicle_details (
    listing_id, vehicle_type, year, make, model, mileage_km, body_style,
    clean_title, condition, fuel_type, transmission, exterior_color,
    interior_color
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
)
RETURNING *;

-- name: GetMarketplaceVehicleDetails :one
SELECT * FROM marketplace_vehicle_details WHERE listing_id = $1;

-- name: UpdateMarketplaceVehicleDetails :one
UPDATE marketplace_vehicle_details
SET
    vehicle_type = $2,
    year = $3,
    make = $4,
    model = $5,
    mileage_km = $6,
    body_style = $7,
    clean_title = $8,
    condition = $9,
    fuel_type = $10,
    transmission = $11,
    exterior_color = $12,
    interior_color = $13
WHERE listing_id = $1
RETURNING *;

-- name: CreateMarketplaceHomeDetails :one
INSERT INTO marketplace_home_details (
    listing_id, title, category_group, category, condition, rental_type,
    bedrooms, bathrooms
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetMarketplaceHomeDetails :one
SELECT * FROM marketplace_home_details WHERE listing_id = $1;

-- name: UpdateMarketplaceHomeDetails :one
UPDATE marketplace_home_details
SET
    title = $2,
    category_group = $3,
    category = $4,
    condition = $5,
    rental_type = $6,
    bedrooms = $7,
    bathrooms = $8
WHERE listing_id = $1
RETURNING *;

-- name: CreateMarketplaceListingImage :one
INSERT INTO marketplace_listing_images (
    listing_id, image_url, bunny_object_path, position
) VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListMarketplaceListingImages :many
SELECT * FROM marketplace_listing_images
WHERE listing_id = $1
ORDER BY position;

-- name: DeleteMarketplaceListingImages :exec
DELETE FROM marketplace_listing_images WHERE listing_id = $1;

-- name: DeleteMarketplaceListing :execrows
DELETE FROM marketplace_listings
WHERE id = $1 AND user_id = $2;
