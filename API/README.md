# Facebook Marketing Tool API

The API authenticates extension users with Google and stores each user's
prepared Group posts and Marketplace listings under their stable Google
account ID.

## Current foundation

- PostgreSQL connection pool using `pgxpool`
- Schema and generated data layer managed by Goose and sqlc
- Google OAuth access-token verification and opaque application sessions
- User-owned Group posts and Marketplace listings
- Free and Pro entitlements with race-safe calendar-day posting usage
- Streaming Bunny Storage uploads with database-backed image metadata
- Health endpoint at `GET /health`

## Required environment

```env
DATABASE_URL=postgres://...
PORT=:4000
GOOGLE_OAUTH_CLIENT_ID=248783871494-fpf7i952h85k1433lm9qhhq62e2b4hdt.apps.googleusercontent.com
BUNNY_STORAGE_ZONE=...
BUNNY_STORAGE_ENDPOINT=https://storage.bunnycdn.com
BUNNY_PUBLIC_BASE_URL=https://your-zone.b-cdn.net
BUNNY_STORAGE_ACCESS_KEY=...
```

Existing deployments may keep using `BUNNY_API_KEY`; it is accepted as a
backwards-compatible alias for `BUNNY_STORAGE_ACCESS_KEY`. Google Chrome
extension OAuth clients are public clients, so this API does not use a Google
client secret.

## Database commands

```bash
make migrate-up
make migrate-down
make migrate-reset
make migrate-status
make sqlc
```

`make migrate-reset` loads `DATABASE_URL` from `API/.env` and rolls back every
applied Goose migration. This deletes all data stored in migration-managed
tables. Run `make migrate-up` afterward when you want to recreate the current
schema from the baseline migration.

The baseline migration is
`db/migrations/20260811000000_initial_schema.sql`.

## Authentication

The extension obtains a Google OAuth access token with `chrome.identity`, then
exchanges it for an application session:

```text
POST /api/auth/google
Authorization: Bearer <google-access-token>
```

The API validates the token's audience against `GOOGLE_OAUTH_CLIENT_ID`, loads
the verified Google profile, upserts the user, and returns a seven-day opaque
session token. Only the SHA-256 hash of that token is stored in PostgreSQL.

All other API routes require:

```text
Authorization: Bearer <application-session-token>
```

Available authenticated routes:

```text
GET    /api/me
POST   /api/auth/logout
POST   /api/posting-usage/claim
POST   /api/posting-usage/complete
POST   /api/posting-usage/release
GET    /api/group-posts
POST   /api/group-posts
PUT    /api/group-posts/{postID}
DELETE /api/group-posts/{postID}
GET    /api/marketplace-listings
POST   /api/marketplace-listings
GET    /api/marketplace-listings/{listingID}
PUT    /api/marketplace-listings/{listingID}
DELETE /api/marketplace-listings/{listingID}
```

Group and Marketplace writes are multipart requests. Images stream to Bunny,
while ordered URLs and associated form fields are stored in PostgreSQL.

New accounts default to Free. Free accounts can store up to five prepared
Group posts and five Marketplace listings, and can publish up to 20 of each per
calendar day in their fixed account timezone. Pro accounts have no storage or
publishing limits.
The extension claims a posting slot immediately before a Facebook action,
completes it after success, and releases it after a confirmed failure.
