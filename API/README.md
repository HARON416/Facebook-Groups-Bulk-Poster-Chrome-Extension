# Facebook Groups Bulk Poster API

This API currently supports two access systems:

- Existing account/auth endpoints, kept for future signup, login, and subscriptions.
- Anonymous extension access for the current 7-day trial and manual lifetime deal flow.

## Anonymous Trial And Lifetime Access

The Chrome extension no longer requires signup/login to unlock the main workflow.

When the sidepanel opens, the extension:

1. Creates or reuses a local `install_id` stored in `chrome.storage.local`.
2. Creates or reuses a user-facing `activation_id`, for example `FGBP-8KQ2-X9LM`.
3. Calls the API to start or check access.
4. Unlocks the extension if the trial is active or lifetime access is enabled.
5. Shows contact instructions when the trial has expired.

The API stores only a hash of the install ID. Opening the sidepanel repeatedly does not restart the 7-day trial.

## Database

Run the migration that creates `extension_accesses` before using this flow:

```sql
API/db/migrations/20260623120000_extension_accesses.sql
```

The table stores:

- hashed install ID
- activation ID
- trial expiry time
- lifetime access flag
- activation timestamp
- optional admin note
- last seen timestamp

## Environment

Add an admin API key to `API/.env`:

```env
ADMIN_API_KEY=your_random_secret_here
```

Generate a strong value with:

```bash
openssl rand -hex 32
```

Keep this value private. Do not put it in the Chrome extension, frontend code, GitHub, or public docs.

## Public Extension Endpoint

The extension calls this endpoint on sidepanel load:

```http
POST /api/extension-access/start
Content-Type: application/json
```

Request:

```json
{
  "install_id": "browser-local-random-uuid",
  "activation_id": "FGBP-XXXX-XXXX"
}
```

Response:

```json
{
  "active": true,
  "access_type": "trial",
  "activation_id": "FGBP-XXXX-XXXX",
  "trial_expires_at": "2026-06-30T12:00:00Z",
  "lifetime_active": false
}
```

`access_type` can be:

- `trial`
- `lifetime`
- `expired`

## Activate Lifetime Access

When a customer pays manually, ask them to send their Activation ID from the extension.

Then activate lifetime access with:

```bash
curl -X POST https://YOUR_API_DOMAIN/api/admin/extension-access/activate-lifetime \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"activation_id":"FGBP-XXXX-XXXX","note":"Paid via WhatsApp"}'
```

Successful response:

```json
{
  "active": true,
  "access_type": "lifetime",
  "activation_id": "FGBP-XXXX-XXXX",
  "trial_expires_at": "2026-06-30T12:00:00Z",
  "lifetime_active": true,
  "activated_at": "2026-06-23T12:00:00Z"
}
```

After activation, the customer can click **Refresh Access** in the extension or reopen the sidepanel.

## Contact Details In Extension

Expired trials show:

- Email: `haronkibetrutoh@gmail.com`
- WhatsApp: `+254718448461`

Those values are currently configured in `src/sidepanel.ts`.

## Notes

- This access method is intentionally low-friction for early sales.
- It is tied to the browser profile/install, not a permanent user identity.
- If users clear extension storage or reinstall, they may need to contact you again.
- The existing user/auth tables and endpoints are still available for future account-based billing.
