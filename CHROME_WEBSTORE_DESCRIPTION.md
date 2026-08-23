# KundiPost – Facebook Groups & Marketplace Publisher

KundiPost is a user-controlled publishing workspace for people who already use Facebook Groups and Facebook Marketplace. It helps you prepare reusable posts and listings, choose what to publish, run paced posting queues, and review a live activity log from a Chrome side panel.

KundiPost does not publish or delete anything automatically when the extension opens. Every posting queue and Marketplace cleanup must be started by the signed-in user. The extension works through the Facebook account that is already signed in within the active Chrome profile.

## Facebook Groups

### Prepare reusable Group posts

- Create, save, edit, and delete prepared posts.
- Each prepared Group post must contain both a post body and at least one image.
- Attach up to 50 JPEG, PNG, WebP, or GIF images, with a maximum size of 12 MB per image.
- Drag images into the required order, preview them, and choose one or more prepared posts for a queue.
- Selected prepared posts are shuffled once when the queue starts and then rotate through that queue order across the selected Groups.

### Load and select Groups

- Load Groups joined by the Facebook account currently open in Chrome.
- Search the loaded list and select one, several, or all Groups.
- Optionally shuffle the selected Group order before posting starts.

### Run a controlled posting queue

- Choose a minimum and maximum interval of at least 60 seconds. KundiPost selects a new random delay between posting attempts.
- Set a maximum number of successful Group posts.
- Failed attempts do not count toward the successful-post target.
- Pause, resume, or stop the queue.
- View posted, failed, waiting, paused, and rate-limit activity in a scrollable log.
- Filter the log to focus on successful or failed attempts.

### Important first-Group requirement

KundiPost uses Facebook's visible user interface for the first post in every Group queue. It opens the first selected Group, clicks the English **“Write something...”** composer, adds the selected text and images, and publishes that first post. While this happens, the extension captures fresh Facebook-generated upload and post request templates from the user's own authenticated browser session. Those templates are then reused locally to submit the remaining user-requested posts through Facebook's GraphQL endpoint.

The first Group post is an actual published post; it is not a test or preview.

For the queue to initialize, the first selected Group must show a standard **“Write something...”** composer to that Facebook account. Some Buy and Sell Groups, restricted Groups, Groups with a different composer, non-English Facebook layouts, or layouts changed by Facebook may not expose this element. If the first attempt reports that the composer was not found, stop the queue, deselect Groups that appear before a compatible standard Group (or change the shuffled selection), and start again. Repeat this step until the first selected Group has the required composer.

Group rules, post approval, account restrictions, Facebook rate limits, and permissions still apply. A Group may reject, hold for approval, limit, or remove a post independently of KundiPost.

## Facebook Marketplace

### Prepare and publish saved listings

- Create, save, edit, and delete reusable Marketplace listings.
- Currently supported publishing types are **Item for sale** and **Vehicle for sale (Car/Truck)**.
- Home listings and additional vehicle types shown as “Coming soon” are not currently supported for automated publishing.
- Add, preview, and reorder photos before saving or posting.
- Item listings support up to 10 photos.
- Car/Truck listings support up to 20 photos.
- The saved Item form includes title, price, category, condition, description, and location. The current automated Item routine fills photos, title, price, category, condition, and description; it does not currently apply the saved location value to Facebook's Item form.
- Car/Truck forms include location, year, make, model, mileage, price, body style, clean-title choice, condition, fuel type, transmission, exterior color, interior color, and description.
- Select one or several saved listings, optionally shuffle their order, and publish them through a paced queue.
- Choose randomized intervals of at least 60 seconds between listings.
- Pause, resume, or stop Marketplace posting and follow successes and failures in the activity log.

Marketplace publishing opens Facebook's Item or Vehicle creation page in the active tab and interacts with the visible form controls on the user's behalf. The active Facebook tab will navigate while the workflow runs, so it should be left open until the queue completes or is stopped.

Before a Marketplace queue starts, KundiPost asks whether the user wants to publish only on Marketplace or also share each listing to suggested Groups. If the user chooses **Marketplace + Groups**, KundiPost selects all visible audience-group checkboxes offered by Facebook on the audience step before clicking **Publish**. Choosing **Marketplace only** clears those visible audience-group selections before publishing.

### Marketplace regional-layout limitation

Marketplace publishing and cleanup have been developed and tested against the **English-language Kenyan Facebook Marketplace layout**. Facebook uses different fields, labels, options, and page structures for different accounts and regions, and changes those layouts without notice. As a result, Marketplace features may not work correctly with other regional layouts, including the United States layout.

Unsupported optional fields may be skipped when Facebook does not display them, but a changed required field or page structure can stop a listing from being published. Support for another regional layout can be assessed and customized on request. Contact **haronkibetrutoh@gmail.com** or **WhatsApp +254 718 448 461**.

## Delete Old Marketplace Listings

- Enter a whole-number age in days and explicitly confirm the deletion.
- KundiPost opens the Facebook Marketplace selling page, scans the active-listings connection exposed by the visible selling layout, and deletes active listings older than the selected elapsed-day threshold.
- Entering `0` targets all active listings returned by that active-listings view, including listings created today.
- Progress shows scanned, deleted, failed, and remaining totals.
- The Facebook selling page refreshes after one or more successful deletions.

**Cleanup scope:** this feature works only with active listings returned through Facebook's visible **Active** selling section and its pagination request. It does **not** delete duplicate listings from Facebook's inactive/duplicate section, hidden listings, drafts, sold listings, pending listings, or any listing Facebook does not expose through that active-listings request.

Deletion is permanent on Facebook and cannot be undone by KundiPost. The extension always requires the user to start and confirm cleanup.

The same Kenyan-layout limitation described above applies to Marketplace cleanup. If Facebook does not expose the expected active-listings request, KundiPost stops without attempting a different listing type.

## Optional Gemini Rewriting

- Optionally rewrite a Group post body or Marketplace description before publishing.
- Add custom style instructions and choose whether to include relevant hashtags.
- KundiPost instructs Gemini to preserve facts, prices, locations, contact details, and phone-number formatting.
- If Gemini is disabled, no API key is supplied, the request fails, or it times out, KundiPost uses the original text.

Gemini rewriting is off unless the user enables it and supplies their own Gemini API key. The key and rewrite settings are stored only in Chrome extension storage. When rewriting is enabled, the original text, rewrite instructions, and preferences are sent directly from the extension to Google's Gemini API; the KundiPost backend does not receive or store the Gemini API key.

## Google Sign-In and Saved Content

KundiPost uses Chrome's official `chrome.identity` API for Google sign-in. The requested Google OAuth scopes are limited to OpenID, email, and basic profile information. The backend validates the Google access token and associates saved content with Google's stable account identifier.

The service stores the signed-in user's Google identifier, email address, email-verification status, display name, profile image when available, account tier, and account timezone. It also stores saved Group post text, Marketplace listing fields, ordered image references, posting-usage records, and hashed application-session records.

Images attached to saved posts and listings are uploaded to Bunny Storage and delivered through Bunny CDN. Deleting a saved prepared post or saved listing from KundiPost also requests deletion of its associated cloud images. Deleting a saved KundiPost draft is separate from deleting content already published on Facebook.

Facebook cookies, Facebook passwords, and captured Facebook request templates are not stored in the KundiPost backend. Facebook request information is processed inside the extension to carry out the posting or cleanup action requested by the user.

## Free and Pro Access

New accounts start on the Free tier.

Free accounts can:

- Save up to 5 prepared Group posts.
- Save up to 5 Marketplace listings.
- Publish up to 20 successful Group posts per calendar day.
- Publish up to 20 successful Marketplace listings per calendar day.

Only successfully published posts/listings count against daily publishing limits. A confirmed failed attempt releases its reserved allowance. Daily limits reset at midnight in the account timezone recorded when the user first signs in. Pro accounts have unlimited saved content and no KundiPost daily publishing limit; Facebook's own limits and policies still apply.

## User Control and Responsible Use

The user chooses the content, images, destinations, listing details, queue size, posting interval, optional rewriting, and cleanup age before starting an action. Queues can be paused or stopped at any time.

Use KundiPost only for content you are authorized to publish. Users remain responsible for their posts and listings and must follow Facebook's Terms, Marketplace policies, anti-spam rules, and the rules of every selected Group. Use reasonable intervals and review prepared content before publishing.

KundiPost is an independent productivity tool. It is not affiliated with, endorsed by, sponsored by, or officially connected to Meta or Facebook.

---

## Chrome Web Store Reviewer Notes

These notes are intended for the Chrome Web Store review submission and do not need to be copied into the public-facing description field.

### Single purpose

KundiPost's single purpose is to let a signed-in user prepare, save, publish, and manage their own Facebook Group posts and Facebook Marketplace listings from a Chrome side panel.

### User-triggered behavior

- Opening the extension does not post or delete Facebook content.
- **Load Groups**, **Start Posting**, **Post selected listings**, and **Delete old listings** are separate, explicit user actions.
- Marketplace deletion also displays a confirmation dialog before it starts.
- Posting and cleanup activity is visible in the side panel and can be paused or stopped where applicable.

### `sidePanel` permission justification

KundiPost uses Chrome's `sidePanel` permission because the side panel is the extension's primary and only user interface. It allows the user to prepare and select saved Facebook Group posts and Marketplace listings, choose destinations and posting intervals, explicitly start, pause, resume, or stop a publishing queue, confirm Marketplace cleanup, and monitor live progress while the active Facebook tab navigates between Groups and Marketplace pages. The controls must remain available beside Facebook throughout these user-started workflows. A toolbar popup is unsuitable because it closes when the user or extension interacts with or navigates the Facebook page.

### `tabs` permission justification

KundiPost uses Chrome's `tabs` permission to identify the active Facebook tab and coordinate only the publishing or cleanup workflow explicitly started by the user. During Group publishing, the extension navigates that tab to each selected Facebook Group and monitors page loading so it can initialize and continue the requested queue. During Marketplace publishing, it navigates the active tab to Facebook's Item or Vehicle listing form for each selected saved listing. During confirmed Marketplace cleanup, it opens the user's Facebook selling page and refreshes it after successful deletions so the visible listing state is current. KundiPost does not use this permission to inspect or manage unrelated browsing activity.

### `cookies` permission justification

KundiPost uses Chrome's `cookies` permission only during a user-started Facebook workflow to verify, through diagnostics, that the active Facebook requests have access to the browser's existing Facebook session cookies. This helps identify session-related failures while capturing the fresh Group-loading, image-upload, and posting requests needed to complete the user's selected queue. The extension records only cookie names and counts for these diagnostics, not cookie values. It does not modify Facebook cookies or send cookie values to or store them in the KundiPost backend, and it does not access cookies for unrelated websites.

### `identity` permission justification

KundiPost uses Chrome's `identity` permission to authenticate the user with Google through Chrome's supported OAuth 2.0 flow. Sign-in requests only the `openid`, email, and basic profile scopes declared in the manifest. The Google identity allows KundiPost to create or restore the user's application account, associate saved Group posts and Marketplace listings with the correct user, enforce the user's Free or Pro access limits, and issue a separate KundiPost application session. KundiPost does not request access to Gmail, Google Drive, contacts, calendars, or other Google account data.

### `storage` permission justification

KundiPost uses Chrome's `storage` permission to preserve the user's extension state when the side panel closes, the active tab changes, Chrome restarts, or the Manifest V3 service worker is suspended. Stored data includes the KundiPost application session, sign-out preference, user-selected posting intervals and queue limits, loaded Group metadata and selected Group IDs, side-panel display state, Marketplace posting preferences, and optional Gemini settings and user-supplied API key. This allows an explicitly configured workflow and its interface preferences to remain available without requiring the user to re-enter them whenever the side panel or service worker reloads. Saved Group posts, Marketplace listings, account details, and usage limits are stored by the KundiPost service under the signed-in Google account rather than treated as Chrome storage. KundiPost does not use Chrome storage to save Facebook passwords or Facebook cookie values.

### `scripting` permission justification

KundiPost uses Chrome's `scripting` permission only on the supported Facebook hosts and only when the user explicitly loads Groups, starts a Group or Marketplace publishing workflow, or confirms Marketplace cleanup. The extension injects packaged helper scripts that inspect the expected Facebook page state, interact with visible composer or listing-form controls, upload the user's selected images, submit the user's selected content through the active Facebook session, detect page readiness and completion, and scan the visible active-listings view during confirmed cleanup. It also performs limited scrolling and page-state checks needed to load Facebook pagination results. All injected code is bundled with the reviewed extension; KundiPost does not download or execute remote JavaScript, and it does not inject scripts into unrelated websites.

### `webRequest` permission justification

KundiPost uses Chrome's `webRequest` permission to observe specific Facebook GraphQL and composer image-upload requests generated in the active Facebook tab during a workflow explicitly started by the user. The extension reads the matching request URL, headers, and form body to capture fresh request templates for loading the user's joined Groups, uploading the user's selected images, publishing the user's selected Group content, and paginating the visible active Marketplace listings during confirmed cleanup. Observation is restricted at runtime to the tab assigned to the active KundiPost workflow and to the Facebook GraphQL and upload URL patterns declared by the extension. The captured request data is held temporarily inside the extension for that workflow and is not sent to or stored by the KundiPost backend. KundiPost does not block, cancel, redirect, or modify browser requests through `webRequest`, and it does not observe unrelated websites.

### Why each Chrome permission is required

- `sidePanel`: provides the persistent primary interface described in the dedicated justification above.
- `identity`: authenticates the KundiPost user with the limited Google OAuth scopes described in the dedicated justification above.
- `storage`: preserves the local session, user preferences, and temporary workflow state described in the dedicated justification above.
- `tabs`: identifies and coordinates the active Facebook tab as described in the dedicated justification above.
- `scripting`: injects the packaged Facebook workflow helpers described in the dedicated justification above.
- `webRequest`: observes the narrowly scoped Facebook requests described in the dedicated justification above.
- `cookies`: supports the limited Facebook-session diagnostics described in the dedicated justification above.

### Host permission justification

KundiPost requires access only to the production hosts used by its user-requested publishing and account workflows. Access to `https://www.facebook.com/*` and `https://web.facebook.com/*` is required to load the user's joined Groups, navigate to selected Groups and Marketplace forms, interact with visible Facebook controls, observe the matching GraphQL requests, publish the user's selected content through the Facebook session already active in Chrome, scan visible active Marketplace listings, and perform explicitly confirmed cleanup. Access to `https://upload.facebook.com/*` is required to upload images selected by the user when publishing Group posts. Access to `https://api.facebook-groups-bulk-poster.softwrhq.com/*` is required for Google-backed KundiPost application sessions, Free/Pro entitlement and daily-limit checks, and creating, reading, updating, or deleting the signed-in user's saved Group posts and Marketplace listings. Access to `https://*.b-cdn.net/*` is required to preview and retrieve the user's saved post and listing images from KundiPost's configured Bunny CDN storage. Access to `https://generativelanguage.googleapis.com/*` is required only when the user enables optional Gemini rewriting and supplies a Gemini API key; the extension then sends the selected text directly to Google's Gemini API. The submitted production manifest does not include localhost, development-server, or unrestricted all-site host permissions.

### Why each host is required

- `https://www.facebook.com/*`, `https://web.facebook.com/*`, and `https://upload.facebook.com/*`: load Groups, interact with Facebook posting forms, upload selected images, publish requested content, scan active Marketplace listings, and perform confirmed cleanup using the user's existing Facebook session.
- `https://api.facebook-groups-bulk-poster.softwrhq.com/*`: authenticate the KundiPost account, enforce the account tier, and create/read/update/delete the user's saved prepared content.
- `https://*.b-cdn.net/*`: display and download the user's saved post/listing images for preview and publishing.
- `https://generativelanguage.googleapis.com/*`: send text directly to Gemini only when the user enables optional rewriting and supplies an API key.
- Development builds contain localhost permissions for the local API. Production builds generate the submitted manifest with only the production API host permission; localhost permissions are not included.

### Data usage disclosures

For the Chrome Web Store **Data usage** form, select the following categories based on the current extension behavior. Chrome requires disclosure for data handled locally as well as data transmitted or stored remotely.

- **Personally identifiable information — Select.** KundiPost handles the Google account subject identifier, email address, email-verification status, display name, and profile image. The backend stores these details to identify the account and associate it with saved content and access entitlements.
- **Authentication information — Select.** The extension handles a Google OAuth access token during sign-in, a KundiPost application-session token, the optional user-supplied Gemini API key, and Facebook authentication request information temporarily inside the active browser workflow. Authentication values are not publicly disclosed, and Facebook authentication values are not sent to or stored by the KundiPost backend.
- **Location — Select.** KundiPost handles the account timezone and location fields entered in saved Marketplace listings. Standard server request logs may also process the connecting IP address for security and operations.
- **Web history — Select.** The extension processes the active Facebook page URL and narrowly scoped Facebook GraphQL and upload-request URLs during user-started workflows. It does not collect a general browsing history or process unrelated websites.
- **User activity — Select.** KundiPost processes user-started publishing and cleanup actions, queue progress, successful-post usage counts, failures, pauses, stops, and narrowly scoped Facebook network-request activity required to run and report those workflows.
- **Website content — Select.** KundiPost handles Group post text and images, Marketplace listing fields and photos, selected Group metadata, visible Facebook form state, and the Facebook request content required to publish or clean up the content chosen by the user.

Do **not** select the following categories for the current product:

- **Health information — Do not select.** KundiPost does not request or use health data.
- **Financial and payment information — Do not select.** Marketplace listing prices are product-listing fields, not payment credentials, financial transactions, credit information, or payment history. KundiPost does not process payments or financial accounts.
- **Personal communications — Do not select.** KundiPost does not access email, private messages, SMS, or chat conversations. User-authored public Group posts and Marketplace listing content are disclosed under **Website content**.

### Suggested reviewer test flow

Prerequisites: Sign in to Facebook in a Chrome tab. Open KundiPost and sign in with Google. New Google accounts automatically receive Free access.

1. Save a prepared Group post containing text and at least one image.
2. Click **Load Groups** and select a standard Group displaying the English **“Write something...”** composer.
3. Select the prepared post and start the queue. The first post is genuinely published through Facebook's visible composer; it is not a test post.
4. Observe the live activity log. After the first post, KundiPost uses the fresh Facebook request templates captured from that authenticated browser session for subsequent selected Groups.
5. To test Marketplace publishing, save and select an Item or Car/Truck listing, then start the queue. This workflow is currently tested against Facebook's English Kenyan Marketplace layout and may stop on other regional layouts.
6. To inspect cleanup, enter an age and click **Delete old listings**. KundiPost displays a confirmation before proceeding. Confirm only with a disposable active listing because deletion is permanent. Duplicate, inactive, sold, hidden, and draft listings are not included.
