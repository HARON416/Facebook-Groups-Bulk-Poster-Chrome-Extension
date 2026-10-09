# Facebook Marketing Tool API

The API authenticates extension users with Google and stores each user's
prepared Group posts and Marketplace listings under their stable Google
account ID.

## Current foundation

- PostgreSQL connection pool using `pgxpool`
- Schema and generated data layer managed by Goose and sqlc
- Google OAuth access-token verification and opaque application sessions
- User-owned Group posts and Marketplace listings
- Account-owned comment options and enabled setting, restored across browsers
- Free and Pro entitlements with race-safe calendar-day posting usage
- Streaming Bunny Storage uploads with database-backed image metadata
- Health endpoint at `GET /health`

## Required environment

```env
DATABASE_URL=postgres://...
PORT=:4000
GOOGLE_OAUTH_CLIENT_ID=248783871494-fpf7i952h85k1433lm9qhhq62e2b4hdt.apps.googleusercontent.com
ADMIN_API_KEY=<at-least-32-random-characters>
FACEBOOK_ACTOR_HMAC_KEY=<at-least-32-random-characters>
BUNNY_STORAGE_ZONE=...
BUNNY_STORAGE_ENDPOINT=https://storage.bunnycdn.com
BUNNY_PUBLIC_BASE_URL=https://your-zone.b-cdn.net
BUNNY_STORAGE_ACCESS_KEY=...
```

Existing deployments may keep using `BUNNY_API_KEY`; it is accepted as a
backwards-compatible alias for `BUNNY_STORAGE_ACCESS_KEY`. Google Chrome
extension OAuth clients are public clients, so this API does not use a Google
client secret.

Generate `FACEBOOK_ACTOR_HMAC_KEY` once with `openssl rand -hex 32`, keep it
secret, and use the same value across deployments. The API uses it to HMAC the
Facebook account identifier used for Free-tier binding; the raw Facebook
identifier is not stored. Rotating or losing this key invalidates comparisons
against existing bindings and requires resetting those bindings.

`ADMIN_API_KEY` protects private account-management endpoints and must never be
included in the extension, landing page, source control, or browser storage.
Generate it with `openssl rand -hex 32`, retain it only in trusted administrator
environments, and send it exclusively over HTTPS.

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

Comment settings use authenticated `GET`, `POST`, and `PUT` requests to
`/api/group-comment-settings`. The payload is `{"enabled":false,"options":["Comment one","Comment two"]}`.
GET returns `{"settings":null}` for accounts without settings. POST initializes
settings without overwriting an existing account record; PUT saves edits.
Settings preserve option order and blank drafts, with a maximum of 50 options
and 10,000 characters per option. Users can access only their own settings.

Apply `db/migrations/20261007000000_add_group_comment_settings.sql` with
`make migrate-up` before deploying the updated API. The extension migrates its
existing local comments when the account has no server settings and removes
the local copy only after loading or saving server settings successfully.

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

New accounts default to Free. Free accounts can store one prepared Group post
and one Marketplace listing, and can publish up to five Group posts and one
Marketplace listing per calendar day in their fixed account timezone. The first Free-tier publishing
claim creates a one-to-one binding between the Google user and the Facebook
account active in Chrome. Both identities are checked inside the same database
transaction, so switching Chrome profiles or attempting concurrent claims does
not create another allowance. Pro accounts have no storage or publishing
limits. The extension claims a posting slot immediately before a Facebook
action, completes it after success, and releases it after a confirmed failure.

Pro access may be temporary or lifetime. Temporary terms use consecutive
24-hour periods measured from the exact grant timestamp; lifetime grants have
no expiry. Expiry is checked on every authenticated request, so no scheduler is
required. Expiry never deletes saved content, but Free limits immediately apply
to new saves and publishing.

Manage access from the API directory with the authenticated server database
configuration. This is intentionally a server-side command rather than a
public API endpoint:

```bash
make access ACCESS_ARGS='--email user@example.com --days 30 --note "Order reference"'
make access ACCESS_ARGS='--email user@example.com --lifetime --note "Lifetime customer"'
make access ACCESS_ARGS='--email user@example.com --revoke'
```

For a 30-day grant, the user receives exactly 720 hours of Pro access beginning
at the grant time. The account card displays the exact expiry in the user's
stored timezone or “Lifetime Pro.”

### Private administrator endpoints

The number of temporary days is dynamic; replace `30` with any positive whole
number. A new temporary grant replaces the previous expiry and starts from the
exact time of the new grant. Export the administrator secret only in your
trusted terminal:

```bash
export ADMIN_API_KEY='your-server-admin-api-key'
```

List all users, ordered by newest account first:

```bash
curl --request GET \
  --url 'https://api.facebook-groups-bulk-poster.softwrhq.com/api/admin/users' \
  --header "Authorization: Bearer ${ADMIN_API_KEY}"
```

The response includes the total and an array of account-management details,
including email, display name, effective tier, timezone, Pro grant information,
and account timestamps. Google subject identifiers are not exposed.

Grant temporary Pro:

```bash
curl --request POST \
  --url 'https://api.facebook-groups-bulk-poster.softwrhq.com/api/admin/access/temporary' \
  --header "Authorization: Bearer ${ADMIN_API_KEY}" \
  --header 'Content-Type: application/json' \
  --data '{"email":"user@example.com","days":30,"note":"Order reference"}'
```

Grant lifetime Pro:

```bash
curl --request POST \
  --url 'https://api.facebook-groups-bulk-poster.softwrhq.com/api/admin/access/lifetime' \
  --header "Authorization: Bearer ${ADMIN_API_KEY}" \
  --header 'Content-Type: application/json' \
  --data '{"email":"user@example.com","note":"Lifetime customer"}'
```

Revoke Pro:

```bash
curl --request POST \
  --url 'https://api.facebook-groups-bulk-poster.softwrhq.com/api/admin/access/revoke' \
  --header "Authorization: Bearer ${ADMIN_API_KEY}" \
  --header 'Content-Type: application/json' \
  --data '{"email":"user@example.com"}'
```

The API returns `401` for a missing or incorrect key, `404` when the Google
user does not exist, and `400` for invalid input. Successful responses return
the effective tier, stored timezone, and temporary expiry or lifetime status.

Delete a user by email, including their stored Facebook account binding and
all Bunny folders and files:

```bash
curl --request DELETE \
  --url 'https://api.facebook-groups-bulk-poster.softwrhq.com/api/admin/users' \
  --header "Authorization: Bearer ${ADMIN_API_KEY}" \
  --header 'Content-Type: application/json' \
  --data '{"email":"user@example.com"}'
```

Email matching is case-insensitive and surrounding whitespace is removed.
Success returns `200` with `{"id":"<user UUID>","email":"user@example.com","deleted":true}`.
The deletion removes the user's sessions, Facebook account binding, posting
usage and statistics, saved group posts, marketplace listings, and image
records through database cascades. It recursively deletes the complete Bunny
`users/<user UUID>/` directory, including untracked files and empty folders.
This deletes the application's Facebook binding, not the account on Facebook
or posts already published there. A later Google sign-in can create a fresh user.

Missing users return `404`; multiple accounts matching the same email return
`409` without deleting anything. Bunny cleanup failures return `502` and roll
back the database deletion so the request can be retried. A missing Bunny
directory is treated as already deleted. Database changes commit only after
storage cleanup succeeds. Storage deletion cannot be rolled back, so assets
may already be removed if cleanup or the final database commit fails.

## Group posting order

The extension shuffles selected groups once per posting run, rotating reusable
posts in their saved order and repeating the shuffled selected groups until the chosen
post limit is reached. Failed groups are skipped for the rest of that run.

The even-distribution planner and accepted-post history endpoints have been
removed. After deploying the API and extension together, run `make migrate-up`
to apply `20261009000000_remove_balanced_group_posting.sql`, which drops the
retired per-group history tables. Posting allowances and account limits keep
using `posting_usage_events`. The migration's rollback recreates the retired
tables but does not restore their previous contents.
