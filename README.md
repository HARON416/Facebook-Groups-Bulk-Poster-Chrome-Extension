# Facebook Marketing Tool

Chrome extension, API, and landing page for managing Facebook Group posts and
Marketplace listings.

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

## Extension build modes

The extension API URL and matching API host permission are generated at build
time. `manifest.base.json` is the manifest source of truth; each build writes
the environment-specific manifest to `public/manifest.json`. Run the command
for the environment you want before loading or packaging the extension.

### Local development

```bash
make build-dev
```

This points the extension to `http://localhost:4000`. Start the local API on
port 4000, reload the unpacked extension from `chrome://extensions`, and use
the Google account configured as an OAuth test user. The generated development
manifest grants `http://localhost/*` and `http://127.0.0.1/*` host access.

You can also run `npm run build:dev` directly.

### Production

```bash
make build-prod
```

This points the extension to
`https://api.facebook-groups-bulk-poster.softwrhq.com`. The generated
production manifest grants that API host and does not contain localhost host
permissions.

Reload the unpacked extension after building, or package the generated
`public` directory for Chrome Web Store. Do not run a development build after
the production build when preparing a release because it replaces the embedded
API URL with localhost.

## Custom API URL

Either build mode can be overridden temporarily:

```bash
AUTH_API_BASE_URL=https://api.example.com npm run build:prod
```

Generated extension scripts are written to `public/dist`, and the generated
manifest is written to `public/manifest.json`.
