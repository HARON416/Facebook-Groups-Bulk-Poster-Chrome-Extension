<svelte:head>
	<title>Privacy Policy | Postika</title>
	<meta
		name="description"
		content="Postika Privacy Policy explaining how the Chrome extension handles Google account information, saved posts and listings, images, Facebook workflow data, and optional Gemini rewriting."
	/>
</svelte:head>

<section class="legal-shell">
	<article class="legal-card">
		<p class="legal-card__eyebrow">Legal</p>
		<h1>Privacy Policy</h1>
		<p class="legal-card__updated">Last updated: August 25, 2026</p>

		<div class="legal-copy">
			<h2>1. What Postika Is</h2>
			<p>
				Postika is a Chrome extension that helps a signed-in user prepare and save Facebook Group
				posts and Marketplace listings, publish selected content, and delete selected older active
				Marketplace listings. The extension uses a supporting Postika server for Google sign-in,
				account access limits, saved content, and image storage. Postika does not offer a public
				API to users or developers.
			</p>
			<p>
				The Postika website provides product information and this Privacy Policy. Product actions,
				including sign-in, saving content, publishing, and Marketplace cleanup, take place through
				the Chrome extension.
			</p>
			<p>
				Postika is an independent product. It is not affiliated with, endorsed by, sponsored by,
				or officially connected to Meta or Facebook.
			</p>

			<h2>2. Google Sign-In and Account Information</h2>
			<p>
				When you choose to sign in, the extension uses Chrome’s <code>chrome.identity</code>
				feature to request Google account access limited to OpenID, email, and basic profile information.
				Chrome returns a Google access token to the extension. The extension sends that token to the supporting
				Postika server, which asks Google to validate it and obtain the corresponding profile.
			</p>
			<p>The following account information is stored by Postika:</p>
			<ul>
				<li>Google’s stable account identifier.</li>
				<li>Email address and email-verification status.</li>
				<li>Display name and profile image URL when Google provides them.</li>
				<li>The browser timezone supplied during the first sign-in.</li>
				<li>
					Your Postika access tier, such as Free or Pro, and any temporary Pro grant and
					expiration details.
				</li>
			</ul>
			<p>
				Temporary Pro access lasts for the granted number of consecutive 24-hour periods, measured
				from the exact grant time. Lifetime Pro access has no scheduled expiration.
			</p>
			<p>
				The Google access token is used to complete authentication and is not stored in the
				Postika database. After successful sign-in, Postika issues a separate application
				session token that expires after seven days. The raw application session token is stored in
				Chrome extension storage; the server stores only its SHA-256 hash, expiry time, creation
				time, and last-used time.
			</p>

			<h2>3. Content You Choose to Save</h2>
			<p>
				Saved content is sent to the supporting Postika server only when you choose to save or
				update it in the extension.
			</p>
			<ul>
				<li>Prepared Group post text and the images attached to each saved post.</li>
				<li>
					Saved Marketplace listing type, title, price, category, condition, description, location,
					and attached images.
				</li>
				<li>
					For saved vehicle listings: vehicle type, year, make, model, mileage, body style, title
					status, condition, fuel type, transmission, and exterior and interior colors when
					provided.
				</li>
			</ul>
			<p>
				The server stores database identifiers, creation and update times, and ordered image
				references needed to return saved content to the correct Google account.
			</p>

			<h2>4. Images and Bunny.net</h2>
			<p>
				Images attached to saved posts and listings are transferred through the supporting Postika
				server and uploaded to Bunny Storage. Postika stores each image’s Bunny object path,
				delivered image URL, and display order in its database. Bunny.net stores and delivers those
				image files.
			</p>
			<p>
				A delivered Bunny CDN image URL may be accessible to anyone who possesses the URL. Do not
				upload an image that you do not have permission to use or do not want hosted in this way.
			</p>

			<h2>5. Facebook Information Processed in the Browser</h2>
			<p>
				Postika operates through the Facebook account already signed in to the active Chrome
				profile. Depending on the feature you start, the extension processes:
			</p>
			<ul>
				<li>
					Joined Group identifiers, names, URLs, join state, last-visited information when
					available, and your Group selections.
				</li>
				<li>The post text and images you select for a Group publishing queue.</li>
				<li>
					For Group balance history, the selected Group identifiers and the latest known name of
					each Group that accepts a post.
				</li>
				<li>
					Facebook request URLs, headers, request bodies, form fields, and response data needed to
					load Groups and carry out the posting queue you started.
				</li>
				<li>
					Marketplace form fields and audience options shown by Facebook while publishing a listing.
				</li>
				<li>
					Active Marketplace listing identifiers, titles, creation times, pagination data, and
					deletion-request data needed for the cleanup you confirmed.
				</li>
				<li>
					Facebook cookie names and request-cookie availability used for local diagnostics. For a
					publishing workflow, the extension also reads the numeric <code>c_user</code>
					Facebook account identifier and sends that identifier to the Postika server for Free-tier
					binding and per-Facebook-account Group balance history. It does not send other Facebook cookie
					values.
				</li>
			</ul>
			<p>
				This Facebook workflow information and captured request templates are processed inside the
				browser and sent to Facebook to perform the action you requested. The server converts the
				numeric Facebook account identifier into a keyed HMAC for Free-tier binding and Group
				balance history and does not store the raw identifier. Postika does not store Facebook
				passwords, other Facebook cookie values, or captured Facebook request templates in its
				server database.
			</p>
			<p>
				When a Group post fails, Postika may temporarily display Facebook's response body in the
				current activity log so you can copy it for troubleshooting. The response remains in the
				current extension session, is not uploaded to the Postika server, and is copied only when
				you press the copy button.
			</p>
			<p>
				When you choose Balanced posting, the extension sends the selected Group identifiers and
				latest names, accepted-post target, active Facebook account identifier, Groups that
				genuinely failed during the current queue, and starter-incompatible Groups remembered for
				the current browser session to the supporting Postika server. The server converts the
				Facebook identifier to a keyed HMAC, compares the selected Groups with stored lifetime
				counts, and returns an ordered posting plan. Merely including a Group in a plan does not
				create or increment its stored statistic; that happens only after Facebook accepts a post as
				published or pending approval.
			</p>
			<p>
				Saved post and listing content is stored by Postika as described above. Content published
				to Facebook is also received and handled by Facebook under Facebook’s own terms and privacy
				practices.
			</p>

			<h2>6. Information Stored in Chrome</h2>
			<p>The extension stores the following information in Chrome extension storage:</p>
			<ul>
				<li>
					The seven-day Postika application session token, its expiry time, and a local copy of
					the signed-in profile information returned by Postika.
				</li>
				<li>A signed-out preference so the extension does not silently sign in again.</li>
				<li>
					Loaded Group information, selected Group identifiers, Group search text, and display
					preferences.
				</li>
				<li>
					During the current browser session, a SHA-256 key representing the active Facebook account
					and Group identifiers that could not initialize the first visible composer, so the current
					or a later Balanced or selected-order queue can automatically choose another starter
					Group.
				</li>
				<li>
					Group and Marketplace queue intervals, successful-post targets, shuffle settings, and
					other current side-panel workflow settings.
				</li>
				<li>
					The Gemini API key, rewrite toggles, hashtag preferences, and custom rewrite instructions
					when you choose to save them.
				</li>
			</ul>
			<p>
				Clearing extension data or uninstalling Postika removes this locally stored information.
				It does not delete the Postika account, server-stored drafts and listings, Bunny-hosted
				images, or content already published on Facebook.
			</p>

			<h2>7. Optional Gemini Rewriting</h2>
			<p>
				Gemini rewriting is off by default. If you enable it and provide your own Gemini API key,
				the extension sends the original Group post body or Marketplace description, your custom
				instructions, destination type, and hashtag preference directly to Google’s Gemini service.
				The Gemini API key is stored in Chrome extension storage and is not sent to or stored by the
				Postika server.
			</p>
			<p>
				Google handles Gemini requests under Google’s applicable terms and privacy policies. If
				rewriting is disabled, unavailable, or unsuccessful, Postika uses the original content.
			</p>

			<h2>8. Access-Tier, Daily-Usage, and Group-Balance Records</h2>
			<p>
				Postika stores your access tier and counts saved Group posts and Marketplace listings to
				enforce Free-account storage limits. Immediately before a Facebook publishing action, the
				extension requests a usage reservation from the supporting server. For Free accounts, the
				first publishing claim creates a one-to-one binding between the signed-in Google account and
				the Facebook account active in Chrome. The same Free Google account cannot switch to another
				Facebook account, and the same Facebook account cannot obtain another Free allowance through
				a different Google account. The server stores:
			</p>
			<ul>
				<li>A keyed HMAC of the numeric Facebook account identifier, not the raw identifier.</li>
				<li>Whether the operation is a Group post or Marketplace listing.</li>
				<li>A randomly generated operation identifier.</li>
				<li>Whether the operation was claimed, succeeded, or released after a known failure.</li>
				<li>Claim, success, release, and daily-expiry times as applicable.</li>
				<li>
					For accepted Group posts, the Group identifier, latest known Group name, lifetime
					accepted-post count, last accepted time, and an operation identifier used to prevent a
					retried request from incrementing the count twice.
				</li>
			</ul>
			<p>
				These records enforce the current calendar-day allowance against both the Google account and
				the bound Facebook account inside a database transaction. Saved drafts do not count as
				publications. Facebook-accepted Group submissions, including posts awaiting administrator
				approval, successful Marketplace publications, and active reservations count toward the
				displayed daily usage; a confirmed failed attempt is released.
			</p>
			<p>
				Published Group posts and posts awaiting administrator approval increment the lifetime
				Group-balance count. Confirmed failures do not. This count does not impose a posting limit
				and does not reset; it is used only when you choose Balanced posting to prioritize selected
				Groups with fewer accepted posts. You can instead choose the normal selected-order workflow.
			</p>

			<h2>9. Server Logs</h2>
			<p>
				The supporting Postika server creates operational request and error logs. These logs may
				include the request time, method, path, response status, processing duration, network
				address, and sanitized error details. They are used to operate the service and investigate
				failures. Google access tokens and application bearer tokens are not intentionally written
				to application logs.
			</p>

			<h2>10. When Information Is Shared</h2>
			<p>Postika transfers information only as needed for the current product flow:</p>
			<ul>
				<li>
					<strong>Google:</strong> to authenticate the selected Google account and, separately, to process
					Gemini rewriting only when you enable that optional feature.
				</li>
				<li>
					<strong>Facebook:</strong> to load available Groups and Marketplace information and to perform
					publishing or cleanup actions that you start.
				</li>
				<li><strong>Bunny.net:</strong> to store and deliver images attached to saved content.</li>
				<li>
					<strong>Hosting, database, and network providers:</strong> to run and secure the supporting
					Postika server and website.
				</li>
			</ul>
			<p>
				Postika does not sell personal information and does not use extension data for
				personalized, retargeted, or interest-based advertising.
			</p>

			<h2>11. Retention, Sign-Out, and Deletion</h2>
			<ul>
				<li>
					Saved Group posts, Marketplace listings, and associated image references remain until you
					delete the saved item or request deletion of your account data.
				</li>
				<li>
					Deleting a saved post or listing removes its database records and requests deletion of its
					Bunny Storage directory. It does not delete copies already published on Facebook.
				</li>
				<li>
					Marketplace cleanup permanently deletes the active Facebook listings included in the
					confirmed cleanup. Postika cannot restore those Facebook listings.
				</li>
				<li>
					Signing out invalidates the current Postika application session and removes the local
					session and cached Google access token. Signing out does not delete your account or saved
					content.
				</li>
				<li>
					Application sessions are created with a seven-day expiry. Expired session records may
					remain until routine server cleanup removes them.
				</li>
				<li>
					Account, hashed Facebook-account binding, Group-balance history, access-tier, usage, and
					operational records remain while needed to provide the account, enforce limits, address
					security or abuse, resolve disputes, or meet legal requirements.
				</li>
			</ul>
			<p>
				Postika currently provides deletion controls for individual saved posts and listings. For
				deletion of the complete Postika account and its server-stored data, email
				<a href="mailto:haronkibetrutoh@gmail.com">haronkibetrutoh@gmail.com</a> from the Google account
				used with Postika. We may verify account ownership before completing the request.
			</p>

			<h2>12. Your Controls</h2>
			<ul>
				<li>Review and edit content before saving or publishing it.</li>
				<li>Choose the posts, listings, Groups, audiences, and actions in each workflow.</li>
				<li>Pause, resume, or stop an active publishing queue.</li>
				<li>Keep Gemini rewriting disabled or remove the locally stored Gemini API key.</li>
				<li>Delete individual saved posts and Marketplace listings from the extension.</li>
				<li>Clear extension storage or uninstall Postika to remove local extension data.</li>
				<li>Contact us to request deletion of the complete Postika account and stored data.</li>
			</ul>

			<h2>13. Chrome Web Store and Google Limited Use</h2>
			<p>
				Information obtained through Chrome extension permissions is used only to provide and
				improve Postika’s disclosed user-facing features. It is not used for personalized
				advertising, creditworthiness, lending, or unrelated profiling.
			</p>
			<p>
				Postika’s use and transfer of information received from Google APIs adheres to the Google
				API Services User Data Policy, including its Limited Use requirements. Postika also
				follows the Chrome Web Store User Data Policy for data handled by the extension.
			</p>

			<h2>14. Security</h2>
			<p>
				Postika uses reasonable safeguards for stored information. Production communication with
				the supporting server uses HTTPS, application session tokens are stored as SHA-256 hashes in
				the database, and Bunny Storage credentials are kept on the server rather than embedded in
				the extension. No transmission or storage method can guarantee absolute security.
			</p>

			<h2>15. Children’s Privacy</h2>
			<p>
				Postika is intended for business and selling workflows and is not directed to children. We
				do not knowingly collect personal information from children.
			</p>

			<h2>16. Changes to This Policy</h2>
			<p>
				This policy may be updated when Postika’s implemented features, data handling, service
				providers, or legal obligations change. The revised policy will display a new “Last updated”
				date.
			</p>

			<h2>17. Contact</h2>
			<p>
				For privacy questions or account-data requests, email
				<a href="mailto:haronkibetrutoh@gmail.com">haronkibetrutoh@gmail.com</a>.
			</p>
		</div>
	</article>
</section>
