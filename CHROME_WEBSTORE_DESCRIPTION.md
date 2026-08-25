# KundiPost – Groups & Marketplace

Save time, reach more buyers, and manage Facebook Group posts and Marketplace listings from one focused Chrome side panel. Prepare your content once, choose exactly where it should go, and run paced publishing queues without rebuilding every post or listing by hand.

KundiPost never publishes or deletes content merely because you open the extension. You select the content and destinations and explicitly start every publishing or cleanup action using the Facebook account already signed in to Chrome.

## Publish to Facebook Groups in Bulk

- Save, edit, reuse, and delete prepared posts. Each prepared post requires text and at least one image.
- Add and reorder up to 50 JPEG, PNG, WebP, or GIF images per prepared post, up to 12 MB each.
- Load, search, select, and optionally shuffle Groups joined by your signed-in Facebook account.
- Select multiple prepared posts; KundiPost shuffles them once when the queue starts, then rotates them across your chosen Groups.
- Optionally balance a queue by prioritizing selected Groups with fewer previous accepted posts; normal selected-order posting remains available.
- Use randomized intervals of at least 60 seconds between submissions.
- Pause, resume, or stop a queue at any time.
- See separate published, pending-approval, failed, and remaining totals in the activity log.
- Copy diagnostic details from a failed attempt when troubleshooting is needed.

KundiPost initializes each Group queue through Facebook's visible standard English **“Write something...”** composer. The first compatible selected Group receives a real submission, which may publish immediately or await administrator approval. If a selected Group cannot start the queue because that composer is unavailable, KundiPost automatically tries another selected Group and remembers the incompatible starter for the current browser session. The skipped Group remains eligible for a later submission after fresh posting templates have been captured. If none of the selected Groups has the required composer, the queue stops without publishing.

KundiPost reports the submission result returned by Facebook, including posts awaiting Group approval. Group rules, moderation, account restrictions, Facebook rate limits, and administrator decisions still apply.

Balanced posting sends the selected Groups and accepted-post target to KundiPost's authenticated planning service. The service compares their stored lifetime history and returns the complete priority sequence. Published and pending-approval submissions count; confirmed failures do not. Each eligible Group gets one turn before another round begins. If a Group genuinely fails, its remaining plan entries are replaced using a new plan that excludes it. Rounds continue until the requested accepted-post target is reached or no eligible Groups remain. The lifetime count is used only for ordering and does not limit how many times a Group may be used.

## Publish Saved Facebook Marketplace Listings

- Save, edit, reuse, and delete **Item for sale** and **Vehicle for sale (Car/Truck)** listings.
- Add, preview, and reorder up to 10 Item photos or 20 Car/Truck photos.
- Save the listing details needed for repeat publishing, select one or several listings, and optionally shuffle their order.
- Run a paced queue with randomized intervals of at least 60 seconds.
- Pause, resume, or stop posting and follow its progress in the activity log.
- Choose whether each listing should go to **Marketplace only** or also to the visible suggested Groups offered by Facebook.

Marketplace publishing uses the visible Facebook listing form in the active tab, so that tab navigates while the queue runs and should remain open. Item publishing currently fills photos, title, price, category, condition, and description; a saved Item location is not currently applied to Facebook's form. Home listings and vehicle types other than Car/Truck are not currently supported.

Car/Truck listings can store and apply location, year, make, model, mileage, price, body style, clean-title choice, condition, fuel type, transmission, exterior color, interior color, and description. A Facebook field that is optional and unavailable in the current layout may be skipped; a missing required field stops that listing attempt.

### Marketplace compatibility

Marketplace publishing and cleanup are tested with the **English-language Kenyan Facebook Marketplace layout**. Facebook fields and page structures vary by account and region and can change without notice, so these features may not work with other layouts, including the United States layout. Support for another regional layout can be assessed on request at **haronkibetrutoh@gmail.com** or **WhatsApp +254 718 448 461**.

## Delete Old Marketplace Listings

Choose an age in whole days, review a confirmation, and delete older listings returned by Facebook's visible **Active** selling section. Entering `0` targets every listing returned in that Active view, including listings created today. KundiPost displays cleanup progress and refreshes the selling page after successful deletion.

Deletion is permanent and always requires an explicit user action and confirmation. Cleanup applies only to visible active listings. It does **not** delete duplicate or inactive listings, hidden listings, drafts, sold listings, pending listings, or listings absent from Facebook's Active view. The Kenyan-layout compatibility limitation also applies to cleanup.

Deleting a saved listing or prepared Group post inside KundiPost also deletes its associated cloud-hosted images. This is separate from deleting content already published on Facebook.

## Optional Gemini Rewriting

Optionally rewrite a Group post body or Marketplace description with your own Gemini API key. You can provide style instructions and request relevant hashtags while asking Gemini to preserve important facts, prices, locations, and contact details. If rewriting is disabled or unavailable, KundiPost publishes the original text.

The Gemini feature is opt-in. Its API key and preferences remain in Chrome extension storage, and rewrite requests go directly from the extension to Google's Gemini API.

## Google Sign-In, Free, and Pro

Sign in with Google to connect your saved Group posts and Marketplace listings to your account. Saved images are cloud-hosted so your prepared content remains available when you return. KundiPost does not request or store your Facebook password.

New accounts start on the Free plan:

- Save up to 5 prepared Group posts and 5 Marketplace listings.
- Make up to 20 accepted Group submissions per calendar day. Published and pending-approval submissions count; confirmed failures do not.
- Publish up to 20 successful Marketplace listings per calendar day.
- Daily usage resets at midnight in the timezone recorded for the account.

Pro removes KundiPost's saved-content and daily publishing limits and may be granted for a chosen number of consecutive 24-hour periods or for lifetime access. Facebook's own limits and policies always continue to apply. When temporary Pro access expires, Free limits return without deleting previously saved content.

Free publishing access is linked to one Google account and one Facebook account to prevent repeated free allowances. Contact support if a legitimate account change is required.

## Privacy and Data Use

KundiPost handles only the data needed to provide its publishing, saved-content, account-access, optional rewriting, and cleanup features:

- **Google account and KundiPost session:** Google sign-in supplies a stable account ID, email address, email-verification status, display name, and profile image. KundiPost stores those account details, the account timezone, Free/Pro access state, usage records, and a hashed application-session token so it can identify the user, restore saved content, and enforce account limits.
- **Facebook account identifier:** During a user-started posting workflow, KundiPost reads the numeric `c_user` identifier for the Facebook account already signed in to Chrome. It sends that identifier to the KundiPost API over HTTPS for Free-plan account binding and per-account Group-balancing history. The API immediately converts it to a keyed HMAC and does not store the raw identifier.
- **Saved content:** Prepared Group text and images, Marketplace listing fields and photos, and their display order are stored under the signed-in KundiPost account. Images are stored in Bunny Storage and delivered through Bunny CDN.
- **Facebook workflow data:** The active Facebook page URL, selected Group IDs and names, visible form state, and narrowly scoped Facebook request and response data are processed to load Groups, publish selected content, classify results, show diagnostics, and perform confirmed cleanup. Captured Facebook authentication values, request templates, and failed response bodies remain inside the extension and are not sent to or stored by the KundiPost backend.
- **Local extension settings:** Chrome extension storage keeps the application session, sign-out preference, queue and display settings, selected and loaded Group state, Marketplace preferences, and optional Gemini settings. It does not store Facebook passwords or raw Facebook cookie values.
- **Optional Gemini rewriting:** When enabled with the user's own API key, the selected text, rewrite instructions, and preferences are sent directly to Google's Gemini API. KundiPost's backend does not receive the Gemini key or rewrite request.
- **Operational data:** The API may process standard request-log information, including the connecting IP address, for security, reliability, and troubleshooting.

KundiPost does not sell user data or use it for personalized advertising, creditworthiness, or lending purposes. It does not access Gmail, Google Drive, contacts, calendars, private Facebook messages, or unrelated browsing activity.

## Important Notes

You remain in control of the content, destinations, queue size, timing, optional rewriting, and cleanup criteria. Use KundiPost only for content you are authorized to publish, use reasonable intervals, and follow Facebook's Terms, Marketplace policies, anti-spam rules, and the rules of every selected Group.

KundiPost is an independent productivity tool and is not affiliated with, endorsed by, sponsored by, or officially connected to Meta or Facebook.

---

## Chrome Web Store Reviewer Notes

These notes are intended for the Chrome Web Store review submission and do not need to be copied into the public-facing description field.

### Single purpose

KundiPost's single purpose is to let a signed-in user prepare, save, publish, and manage their own Facebook Group posts and Facebook Marketplace listings from a Chrome side panel.

### User-triggered behavior

- Opening the extension does not post or delete Facebook content.
- **Load Groups**, **Start Posting**, **Post selected listings**, and **Delete old listings** are separate, explicit user actions.
- Before a Group queue starts, the user explicitly chooses Balanced posting or the existing selected-order behavior. Both modes operate only on Groups the user selected.
- If the first planned Group cannot expose the required visible composer, the queue automatically tries another selected Group. It does not publish to an unselected Group.
- Marketplace deletion also displays a confirmation dialog before it starts.
- Posting and cleanup activity is visible in the side panel and can be paused or stopped where applicable.

### `sidePanel` permission justification

KundiPost uses Chrome's `sidePanel` permission because the side panel is the extension's primary and only user interface. It allows the user to prepare and select saved Facebook Group posts and Marketplace listings, choose destinations and posting intervals, explicitly start, pause, resume, or stop a publishing queue, confirm Marketplace cleanup, and monitor live progress while the active Facebook tab navigates between Groups and Marketplace pages. The controls must remain available beside Facebook throughout these user-started workflows. A toolbar popup is unsuitable because it closes when the user or extension interacts with or navigates the Facebook page.

### `tabs` permission justification

KundiPost uses Chrome's `tabs` permission to identify the active Facebook tab and coordinate only the publishing or cleanup workflow explicitly started by the user. During Group publishing, the extension navigates that tab to each selected Facebook Group and monitors page loading so it can initialize and continue the requested queue. During Marketplace publishing, it navigates the active tab to Facebook's Item or Vehicle listing form for each selected saved listing. During confirmed Marketplace cleanup, it opens the user's Facebook selling page and refreshes it after successful deletions so the visible listing state is current. KundiPost does not use this permission to inspect or manage unrelated browsing activity.

### `cookies` permission justification

KundiPost uses Chrome's `cookies` permission only during a user-started Facebook workflow. It records Facebook cookie names and counts for local session diagnostics and reads the numeric `c_user` value to identify the Facebook account performing the publishing action. The extension sends only that numeric account identifier to the KundiPost API over HTTPS for Free-tier binding and to keep optional Group-balancing history separate for each Facebook account. The API immediately converts it to a keyed HMAC and does not persist the raw value. KundiPost does not read or transmit Facebook passwords or other Facebook cookie values, does not modify Facebook cookies, and does not access cookies for unrelated websites.

### `identity` permission justification

KundiPost uses Chrome's `identity` permission to authenticate the user with Google through Chrome's supported OAuth 2.0 flow. Sign-in requests only the `openid`, email, and basic profile scopes declared in the manifest. The Google identity allows KundiPost to create or restore the user's application account, associate saved Group posts and Marketplace listings with the correct user, enforce the user's Free or Pro access limits, and issue a separate KundiPost application session. KundiPost does not request access to Gmail, Google Drive, contacts, calendars, or other Google account data.

### `storage` permission justification

KundiPost uses Chrome's `storage` permission to preserve the user's extension state when the side panel closes, the active tab changes, Chrome restarts, or the Manifest V3 service worker is suspended. Stored data includes the KundiPost application session, sign-out preference, user-selected posting intervals and queue limits, loaded Group metadata and selected Group IDs, side-panel display state, Marketplace posting preferences, and optional Gemini settings and user-supplied API key. Session storage also holds a SHA-256 key representing the active Facebook account and starter-only Group exclusions when a selected Group lacks the first visible composer; this lets a restarted Balanced queue choose another starter without persisting the raw Facebook identifier. This allows an explicitly configured workflow and its interface preferences to remain available without requiring the user to re-enter them whenever the side panel or service worker reloads. Saved Group posts, Marketplace listings, account details, usage limits, and lifetime Group-balancing counts are stored by the KundiPost service under the signed-in Google account rather than treated as Chrome storage. KundiPost does not use Chrome storage to save Facebook passwords, raw Facebook cookie values, captured request templates, or failed-post response bodies.

### `scripting` permission justification

KundiPost uses Chrome's `scripting` permission only on the supported Facebook hosts and only when the user explicitly loads Groups, starts a Group or Marketplace publishing workflow, or confirms Marketplace cleanup. The extension injects packaged helper scripts that inspect the expected Facebook page state, interact with visible composer or listing-form controls, upload the user's selected images, submit the user's selected content through the active Facebook session, detect page readiness and completion, and scan the visible active-listings view during confirmed cleanup. For the first visible Group submission, a temporary packaged main-world helper observes that submission's Facebook response so KundiPost can distinguish an immediately published post, a post awaiting Group approval, and a genuine rejection. It also performs limited scrolling and page-state checks needed to load Facebook pagination results. All injected code is bundled with the reviewed extension; KundiPost does not download or execute remote JavaScript, and it does not inject scripts into unrelated websites.

### `webRequest` permission justification

KundiPost uses Chrome's `webRequest` permission to observe specific Facebook GraphQL and composer image-upload requests generated in the active Facebook tab during a workflow explicitly started by the user. The extension reads the matching request URL, headers, and form body to capture fresh request templates for loading the user's joined Groups, uploading the user's selected images, publishing the user's selected Group content, and paginating the visible active Marketplace listings during confirmed cleanup. Observation is restricted at runtime to the tab assigned to the active KundiPost workflow and to the Facebook GraphQL and upload URL patterns declared by the extension. The captured request data is held temporarily inside the extension for that workflow and is not sent to or stored by the KundiPost backend. KundiPost does not block, cancel, redirect, or modify browser requests through `webRequest`, and it does not observe unrelated websites.

### Why each Chrome permission is required

- `sidePanel`: provides the persistent primary interface described in the dedicated justification above.
- `identity`: authenticates the KundiPost user with the limited Google OAuth scopes described in the dedicated justification above.
- `storage`: preserves the local session, user preferences, and temporary workflow state described in the dedicated justification above.
- `tabs`: identifies and coordinates the active Facebook tab as described in the dedicated justification above.
- `scripting`: injects the packaged Facebook workflow helpers described in the dedicated justification above.
- `webRequest`: observes the narrowly scoped Facebook requests described in the dedicated justification above.
- `cookies`: supports the limited Facebook-session diagnostics and numeric Facebook-account identification described in the dedicated justification above.

### Host permission justification

KundiPost requires access only to the production hosts used by its user-requested publishing and account workflows. Access to `https://www.facebook.com/*` and `https://web.facebook.com/*` is required to load the user's joined Groups, navigate to selected Groups and Marketplace forms, interact with visible Facebook controls, identify the active Facebook account for Free-tier binding and per-account Group balancing, observe the matching GraphQL requests, publish the user's selected content through the Facebook session already active in Chrome, scan visible active Marketplace listings, and perform explicitly confirmed cleanup. Access to `https://upload.facebook.com/*` is required to upload images selected by the user when publishing Group posts. Access to `https://api.facebook-groups-bulk-poster.softwrhq.com/*` is required for Google-backed KundiPost application sessions, one-to-one Free Facebook-account binding, Free/Pro entitlement and daily-limit checks, optional Group-balancing history, and creating, reading, updating, or deleting the signed-in user's saved Group posts and Marketplace listings. Access to `https://*.b-cdn.net/*` is required to preview and retrieve the user's saved post and listing images from KundiPost's configured Bunny CDN storage. Access to `https://generativelanguage.googleapis.com/*` is required only when the user enables optional Gemini rewriting and supplies a Gemini API key; the extension then sends the selected text directly to Google's Gemini API. The submitted production manifest does not include localhost, development-server, or unrestricted all-site host permissions.

### Why each host is required

- `https://www.facebook.com/*`, `https://web.facebook.com/*`, and `https://upload.facebook.com/*`: load Groups, interact with Facebook posting forms, upload selected images, publish requested content, scan active Marketplace listings, and perform confirmed cleanup using the user's existing Facebook session.
- `https://api.facebook-groups-bulk-poster.softwrhq.com/*`: authenticate the KundiPost account, enforce the account tier, and create/read/update/delete the user's saved prepared content.
- `https://*.b-cdn.net/*`: display and download the user's saved post/listing images for preview and publishing.
- `https://generativelanguage.googleapis.com/*`: send text directly to Gemini only when the user enables optional rewriting and supplies an API key.
- Development builds contain localhost permissions for the local API. Production builds generate the submitted manifest with only the production API host permission; localhost permissions are not included.

### Data usage disclosures

For the Chrome Web Store **Data usage** form, select the following categories based on the current extension behavior. Chrome requires disclosure for data handled locally as well as data transmitted or stored remotely.

- **Personally identifiable information — Select.** KundiPost handles the Google account subject identifier, email address, email-verification status, display name, profile image, and numeric Facebook account identifier used for Free-tier binding. The backend stores the Google details and only a keyed HMAC of the Facebook identifier to associate saved content and access entitlements with the correct identities.
- **Authentication information — Select.** The extension handles a Google OAuth access token during sign-in, a KundiPost application-session token, the optional user-supplied Gemini API key, and Facebook authentication request information temporarily inside the active browser workflow. Authentication values are not publicly disclosed. Except for the numeric `c_user` account identifier used for HMAC-backed Free-tier binding, Facebook cookie and request-authentication values are not sent to or stored by the KundiPost backend.
- **Location — Select.** KundiPost handles the account timezone and location fields entered in saved Marketplace listings. Standard server request logs may also process the connecting IP address for security and operations.
- **Web history — Select.** The extension processes the active Facebook page URL and narrowly scoped Facebook GraphQL and upload-request URLs during user-started workflows. It does not collect a general browsing history or process unrelated websites.
- **User activity — Select.** KundiPost processes user-started publishing and cleanup actions, queue progress, immediately published and pending-approval submission counts, per-Group lifetime accepted counts and last accepted times used for optional balancing, failures, pauses, stops, and narrowly scoped Facebook network-request activity required to run and report those workflows.
- **Website content — Select.** KundiPost handles Group post text and images, Marketplace listing fields and photos, selected Group metadata including Group IDs and latest known names used for optional balancing, visible Facebook form state, and the Facebook request and response content required to publish, classify a submission result, troubleshoot a failed Group submission, or clean up the content chosen by the user. Failed Group response bodies remain local to the current activity-log session unless the user explicitly copies one.

The public description above now gives a pre-install summary of what data KundiPost handles and why. Keep the Chrome Web Store Privacy-tab answers and the linked privacy policy consistent with these disclosures. Chrome Web Store policy requires disclosure even for data processed only inside the extension.

Do **not** select the following categories for the current product:

- **Health information — Do not select.** KundiPost does not request or use health data.
- **Financial and payment information — Do not select.** Marketplace listing prices are product-listing fields, not payment credentials, financial transactions, credit information, or payment history. KundiPost does not process payments or financial accounts.
- **Personal communications — Do not select.** KundiPost does not access email, private messages, SMS, or chat conversations. User-authored public Group posts and Marketplace listing content are disclosed under **Website content**.

### Suggested reviewer test flow

Prerequisites: Sign in to Facebook in a Chrome tab. Open KundiPost and sign in with Google. New Google accounts automatically receive Free access.

1. Save a prepared Group post containing text and at least one image.
2. Click **Load Groups** and select at least one standard Group displaying the English **“Write something...”** composer. A reviewer may also select a Group without that composer before the compatible Group to observe automatic starter fallback.
3. Select the prepared post and start the queue. Choose either **Balance selected Groups** or **Use selected order** in the dialog. For Balanced mode, KundiPost's authenticated API builds the complete destination plan from only the selected Groups, their accepted-post history, and the requested target. Each eligible Group receives one turn per round, and genuine failures are replaced without being retried during that queue. The first compatible submission genuinely uses Facebook's visible composer; it is not a test post. Facebook may publish it immediately or place it in that Group's approval queue. If a planned starter lacks the required composer, KundiPost automatically tries the next eligible selected Group and retains the skipped Group for possible later template-based posting.
4. Observe the live activity log. KundiPost separately reports immediately posted, pending approval, and failed submissions. If a genuine failure returns a Facebook response body, the failure entry includes a copy button for user-initiated troubleshooting. After the first submission, KundiPost uses the fresh Facebook request templates captured from that authenticated browser session for subsequent selected Groups.
5. To test Marketplace publishing, save and select an Item or Car/Truck listing, then start the queue. This workflow is currently tested against Facebook's English Kenyan Marketplace layout and may stop on other regional layouts.
6. To inspect cleanup, enter an age and click **Delete old listings**. KundiPost displays a confirmation before proceeding. Confirm only with a disposable active listing because deletion is permanent. Duplicate, inactive, sold, hidden, and draft listings are not included.
