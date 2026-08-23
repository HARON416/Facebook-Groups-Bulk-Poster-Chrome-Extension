-- +goose Up
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Google identities are the account boundary for all extension-owned data.
-- google_subject is Google's stable account identifier; email is display data
-- and is not used as an ownership key.
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    google_subject VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(320) NOT NULL,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    display_name TEXT,
    avatar_url TEXT,
    access_tier VARCHAR(16) NOT NULL DEFAULT 'free',
    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT users_google_subject_check
        CHECK (char_length(trim(google_subject)) > 0),
    CONSTRAINT users_email_check CHECK (char_length(trim(email)) > 0),
    CONSTRAINT users_access_tier_check CHECK (access_tier IN ('free', 'pro')),
    CONSTRAINT users_timezone_check CHECK (char_length(trim(timezone)) > 0)
);

CREATE INDEX users_email_lower_idx ON users (lower(email));

-- The extension receives a random session token after Google authentication.
-- Only its SHA-256 digest is persisted by the API.
CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT auth_sessions_token_hash_length_check
        CHECK (char_length(token_hash) = 64),
    CONSTRAINT auth_sessions_expiry_check
        CHECK (expires_at > created_at)
);

CREATE INDEX auth_sessions_user_id_idx ON auth_sessions (user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions (expires_at);

-- Free-tier publishing is enforced with an idempotent claim immediately
-- before each Facebook action. Claims are assigned to the user's current
-- calendar day and expire at their next local midnight. Claimed rows count so
-- concurrent extension windows cannot oversubscribe the allowance; known
-- Facebook failures release their claim.
CREATE TABLE posting_usage_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(32) NOT NULL,
    operation_id UUID NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'claimed',
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    succeeded_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,

    CONSTRAINT posting_usage_claims_kind_check
        CHECK (kind IN ('group_post', 'marketplace_listing')),
    CONSTRAINT posting_usage_claims_status_check
        CHECK (status IN ('claimed', 'succeeded', 'released')),
    CONSTRAINT posting_usage_claims_expiry_check
        CHECK (expires_at > claimed_at),
    CONSTRAINT posting_usage_claims_succeeded_check
        CHECK (
            (status = 'succeeded' AND succeeded_at IS NOT NULL) OR
            (status <> 'succeeded' AND succeeded_at IS NULL)
        ),
    CONSTRAINT posting_usage_claims_released_check
        CHECK (
            (status = 'released' AND released_at IS NOT NULL) OR
            (status <> 'released' AND released_at IS NULL)
        ),
    CONSTRAINT posting_usage_claims_operation_unique
        UNIQUE (user_id, kind, operation_id)
);

CREATE INDEX posting_usage_claims_active_idx
    ON posting_usage_claims (user_id, kind, claimed_at DESC);
CREATE INDEX posting_usage_claims_expiry_idx
    ON posting_usage_claims (expires_at)
    WHERE status = 'claimed';

-- Groups prepared posts intentionally persist only their body and ordered
-- Bunny-hosted image URLs. Selection and shuffle state remain UI concerns.
CREATE TABLE group_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT group_posts_body_check CHECK (char_length(trim(body)) > 0)
);

CREATE INDEX group_posts_user_id_idx ON group_posts (user_id, created_at DESC);

CREATE TABLE group_post_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_post_id UUID NOT NULL
        REFERENCES group_posts(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    bunny_object_path TEXT NOT NULL,
    position SMALLINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT group_post_images_url_check
        CHECK (char_length(trim(image_url)) > 0),
    CONSTRAINT group_post_images_object_path_check
        CHECK (char_length(trim(bunny_object_path)) > 0),
    CONSTRAINT group_post_images_position_check CHECK (position >= 0),
    CONSTRAINT group_post_images_post_position_unique
        UNIQUE (group_post_id, position) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT group_post_images_post_object_path_unique
        UNIQUE (group_post_id, bunny_object_path)
);

-- Price, description and location are the only editable fields currently
-- shared by Item, Vehicle and Home listings. Images are stored separately.
CREATE TABLE marketplace_listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_type VARCHAR(16) NOT NULL,
    price BIGINT,
    description TEXT,
    location TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT marketplace_listings_type_check
        CHECK (listing_type IN ('item', 'vehicle', 'home')),
    CONSTRAINT marketplace_listings_price_check
        CHECK (price IS NULL OR price >= 0),
    CONSTRAINT marketplace_listings_id_type_unique UNIQUE (id, listing_type)
);

CREATE INDEX marketplace_listings_user_id_idx
    ON marketplace_listings (user_id, created_at DESC);

CREATE INDEX marketplace_listings_user_type_idx
    ON marketplace_listings (user_id, listing_type);

-- Item-only fields from the current Item for sale form.
CREATE TABLE marketplace_item_details (
    listing_id UUID PRIMARY KEY,
    listing_type VARCHAR(16) NOT NULL DEFAULT 'item',
    title VARCHAR(200),
    category_group VARCHAR(100),
    category VARCHAR(150),
    condition VARCHAR(32),

    CONSTRAINT marketplace_item_details_type_check
        CHECK (listing_type = 'item'),
    CONSTRAINT marketplace_item_details_condition_check
        CHECK (
            condition IS NULL OR condition IN (
                'new',
                'used_like_new',
                'used_good',
                'used_fair'
            )
        ),
    CONSTRAINT marketplace_item_details_listing_fk
        FOREIGN KEY (listing_id, listing_type)
        REFERENCES marketplace_listings(id, listing_type)
        ON DELETE CASCADE
);

-- Vehicle-only fields. Values mirror the custom dropdown data-value values in
-- the current frontend, including options marked Coming soon.
CREATE TABLE marketplace_vehicle_details (
    listing_id UUID PRIMARY KEY,
    listing_type VARCHAR(16) NOT NULL DEFAULT 'vehicle',
    vehicle_type VARCHAR(40),
    year SMALLINT,
    make VARCHAR(100),
    model VARCHAR(100),
    mileage_km INTEGER,
    body_style VARCHAR(32),
    clean_title BOOLEAN NOT NULL DEFAULT FALSE,
    condition VARCHAR(32),
    fuel_type VARCHAR(32),
    transmission VARCHAR(40) NOT NULL DEFAULT 'automatic_transmission',
    exterior_color VARCHAR(32),
    interior_color VARCHAR(32),

    CONSTRAINT marketplace_vehicle_details_type_check
        CHECK (listing_type = 'vehicle'),
    CONSTRAINT marketplace_vehicle_details_vehicle_type_check
        CHECK (
            vehicle_type IS NULL OR vehicle_type IN (
                'car_truck',
                'motorcycle',
                'powersport',
                'rv_camper',
                'trailer',
                'boat',
                'commercial_industrial',
                'other'
            )
        ),
    CONSTRAINT marketplace_vehicle_details_year_check
        CHECK (year IS NULL OR year BETWEEN 1901 AND 2027),
    CONSTRAINT marketplace_vehicle_details_mileage_check
        CHECK (mileage_km IS NULL OR mileage_km BETWEEN 300 AND 1000000),
    CONSTRAINT marketplace_vehicle_details_body_style_check
        CHECK (
            body_style IS NULL OR body_style IN (
                'coupe',
                'truck',
                'sedan',
                'hatchback',
                'suv',
                'convertible',
                'wagon',
                'minivan',
                'small_car',
                'other'
            )
        ),
    CONSTRAINT marketplace_vehicle_details_condition_check
        CHECK (
            condition IS NULL OR condition IN (
                'excellent',
                'very_good',
                'good',
                'fair',
                'poor'
            )
        ),
    CONSTRAINT marketplace_vehicle_details_fuel_type_check
        CHECK (
            fuel_type IS NULL OR fuel_type IN (
                'diesel',
                'electric',
                'gasoline',
                'flex',
                'hybrid',
                'petrol',
                'plug_in_hybrid',
                'other'
            )
        ),
    CONSTRAINT marketplace_vehicle_details_transmission_check
        CHECK (
            transmission IN (
                'manual_transmission',
                'automatic_transmission'
            )
        ),
    CONSTRAINT marketplace_vehicle_details_exterior_color_check
        CHECK (
            exterior_color IS NULL OR exterior_color IN (
                'black', 'blue', 'brown', 'gold', 'green', 'gray', 'pink',
                'purple', 'red', 'silver', 'orange', 'white', 'yellow',
                'charcoal', 'off_white', 'tan', 'beige', 'burgundy',
                'turquoise'
            )
        ),
    CONSTRAINT marketplace_vehicle_details_interior_color_check
        CHECK (
            interior_color IS NULL OR interior_color IN (
                'black', 'blue', 'brown', 'gold', 'green', 'gray', 'pink',
                'purple', 'red', 'silver', 'orange', 'white', 'yellow',
                'charcoal', 'off_white', 'tan', 'beige', 'burgundy',
                'turquoise'
            )
        ),
    CONSTRAINT marketplace_vehicle_details_listing_fk
        FOREIGN KEY (listing_id, listing_type)
        REFERENCES marketplace_listings(id, listing_type)
        ON DELETE CASCADE
);

-- Home-only fields from the currently disabled Home for sale or rent form.
-- The frontend currently exposes rental type but has no separate sale/rent
-- selector, so the schema intentionally does not invent one yet.
CREATE TABLE marketplace_home_details (
    listing_id UUID PRIMARY KEY,
    listing_type VARCHAR(16) NOT NULL DEFAULT 'home',
    title VARCHAR(200),
    category_group VARCHAR(100),
    category VARCHAR(150),
    condition VARCHAR(32),
    rental_type VARCHAR(32),
    bedrooms INTEGER,
    bathrooms INTEGER,

    CONSTRAINT marketplace_home_details_type_check
        CHECK (listing_type = 'home'),
    CONSTRAINT marketplace_home_details_condition_check
        CHECK (
            condition IS NULL OR condition IN (
                'new',
                'used_like_new',
                'used_good',
                'used_fair'
            )
        ),
    CONSTRAINT marketplace_home_details_rental_type_check
        CHECK (
            rental_type IS NULL OR rental_type IN (
                'house',
                'townhouse',
                'apartment_condo',
                'room_only'
            )
        ),
    CONSTRAINT marketplace_home_details_bedrooms_check
        CHECK (bedrooms IS NULL OR bedrooms >= 0),
    CONSTRAINT marketplace_home_details_bathrooms_check
        CHECK (bathrooms IS NULL OR bathrooms >= 0),
    CONSTRAINT marketplace_home_details_listing_fk
        FOREIGN KEY (listing_id, listing_type)
        REFERENCES marketplace_listings(id, listing_type)
        ON DELETE CASCADE
);

-- Ordered Bunny-hosted image URLs shared by all Marketplace listing types.
-- The API enforces the frontend limits: Item 10, Vehicle 20 and Home 50.
CREATE TABLE marketplace_listing_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL
        REFERENCES marketplace_listings(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    bunny_object_path TEXT NOT NULL,
    position SMALLINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT marketplace_listing_images_url_check
        CHECK (char_length(trim(image_url)) > 0),
    CONSTRAINT marketplace_listing_images_object_path_check
        CHECK (char_length(trim(bunny_object_path)) > 0),
    CONSTRAINT marketplace_listing_images_position_check CHECK (position >= 0),
    CONSTRAINT marketplace_listing_images_listing_position_unique
        UNIQUE (listing_id, position) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT marketplace_listing_images_listing_object_path_unique
        UNIQUE (listing_id, bunny_object_path)
);

-- +goose Down
-- The legacy license schema used extension_auth_codes and extension_accesses.
-- Include them here because deployments that applied the deleted legacy
-- migrations can still contain those tables even though Goose can no longer
-- discover their original Down statements. CASCADE also removes any remaining
-- legacy constraints or views that reference this discarded schema.
DROP TABLE IF EXISTS
    extension_auth_codes,
    extension_accesses,
    marketplace_listing_images,
    marketplace_home_details,
    marketplace_vehicle_details,
    marketplace_item_details,
    marketplace_listings,
    group_post_images,
    group_posts,
    posting_usage_claims,
    auth_sessions,
    users
CASCADE;
