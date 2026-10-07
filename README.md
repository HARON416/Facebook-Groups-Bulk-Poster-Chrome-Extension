# Facebook Marketing Tool

Chrome extension, API, and landing page for managing Facebook Group posts and
Marketplace listings.

## Administrator user deletion

Delete a user by email with the server's `ADMIN_API_KEY`:

```bash
export ADMIN_API_KEY='your-server-admin-api-key'

curl --request DELETE \
  --url 'https://api.facebook-groups-bulk-poster.softwrhq.com/api/admin/users' \
  --header "Authorization: Bearer ${ADMIN_API_KEY}" \
  --header 'Content-Type: application/json' \
  --data '{"email":"user@example.com"}'
```

Replace `user@example.com` with the user's email. This permanently removes the
user, their stored Facebook binding, sessions, saved posts and listings, usage
records, and their complete Bunny folder and files. It does not delete the
account on Facebook or published Facebook posts. Keep the administrator key
in a trusted terminal; never put it in the extension.

See [API administrator documentation](API/README.md#private-administrator-endpoints)
for response codes and retry behavior.

## Google authentication

The Manifest V3 extension uses `chrome.identity.getAuthToken()` with the Chrome
extension OAuth client declared in `public/manifest.json`. The manifest's public
key pins local unpacked builds to the published extension ID
`lphjckpophfkedacijahclaoenhikcgo`.

The extension sends the Google access token once to `POST /api/auth/google`.
The API verifies its audience and Google profile, then returns an application
session used by the prepared-post and Marketplace-listing APIs. Saved records
are owned by the Google user's stable subject ID rather than their changeable email address.

No Google client secret belongs in the extension or API for this Chrome
extension OAuth client. The downloaded `client_secret_*.json` file is not a
runtime dependency and must not be packaged with `public`.

## Extension build

`public/manifest.json` is the extension manifest and the only source of truth
for its version, name, permissions, and other metadata. The build does not
modify it.

The API URL is the `AUTH_API_BASE_URL` constant in `src/auth-config.ts`.
`npm run build` always embeds the exact URL currently written there; it does
not choose between local development and production automatically.

For production, use:

```ts
export const AUTH_API_BASE_URL =
  "https://api.facebook-groups-bulk-poster.softwrhq.com";
```

For local development, use:

```ts
export const AUTH_API_BASE_URL = "http://localhost:4000";
```

Whenever the API host changes, update `host_permissions` in
`public/manifest.json` to match. Production needs:

```json
"https://api.facebook-groups-bulk-poster.softwrhq.com/*"
```

Local development needs:

```json
"http://localhost/*"
```

After setting both values, build the extension:

```bash
npm run build
```

For a Chrome Web Store release, increment the version directly in
`public/manifest.json`, build, and package the contents of `public` so
`manifest.json` is at the ZIP root:

```bash
npm run build
rm -f public.zip
cd public
zip -r ../public.zip .
cd ..
```

Generated extension scripts are written to `public/dist`. The build leaves
`public/manifest.json` unchanged.
