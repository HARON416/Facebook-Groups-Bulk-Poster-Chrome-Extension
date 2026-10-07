<script lang="ts">
	const storeUrl =
		'https://chromewebstore.google.com/detail/kundipost/lphjckpophfkedacijahclaoenhikcgo';
	const whatsappUrl =
		'https://wa.me/254718448461?text=Hi%2C%20I%27m%20interested%20in%20Postika%20Pro';
	const emailUrl = 'mailto:haronkibetrutoh@gmail.com?subject=Postika%20Pro%20upgrade';

	const groupFeatures = [
		'Reach more relevant communities with every campaign',
		'Reuse your best text-and-image promotions instead of rebuilding them',
		'Keep your message fresh by rotating different prepared posts',
		'Post at a steady pace without being tied to your screen',
		'Stay in charge with pause, resume, and stop controls'
	];

	const marketplaceFeatures = [
		'List more Item and Car/Truck inventory in less time',
		'Reuse complete listings instead of refilling the same forms',
		'Expand your reach through Marketplace and suggested Groups',
		'Clear older active listings so buyers see relevant inventory',
		'Spend less time checking tabs with progress in one place'
	];

	const faqs = [
		{
			question: 'How does Postika save me time and money?',
			answer:
				'It combines Group and Marketplace publishing in one extension and lets you reuse prepared content. That means less copying, fewer repeated form entries, and less need for separate posting tools.'
		},
		{
			question: 'Does Postika post without my permission?',
			answer:
				'No. You choose the content, destinations, timing, and when a queue starts. Marketplace cleanup also requires your confirmation.'
		},
		{
			question: 'Which Facebook account does it use?',
			answer:
				'It works through the Facebook account already signed in to Chrome. Saved Postika content is connected to the Google account used to sign in to the extension.'
		},
		{
			question: 'Does it work with every Facebook layout?',
			answer:
				'For Groups, only the first post in each queue depends on Facebook’s visible interface and requires a Group with the English “Write something...” composer. Marketplace automation is currently tested on the English Kenyan layout. Other regional layouts may need customization.'
		},
		{
			question: 'What counts toward a daily limit?',
			answer:
				'Only successfully published posts and listings count. Saved drafts do not. Free usage resets at midnight in the timezone recorded for your account.'
		},
		{
			question: 'Is Gemini required?',
			answer:
				'No. Rewriting is optional and off by default. You supply your own Gemini API key, and Postika uses the original copy if rewriting fails.'
		}
	];
</script>

<svelte:head>
	<title>Postika — Facebook Groups Bulk Poster & Marketplace Auto Poster</title>
	<meta
		name="description"
		content="Save time, reach more buyers, and spend less on separate tools with a Facebook Groups bulk poster and Marketplace auto poster in one Chrome extension."
	/>
	<meta
		name="keywords"
		content="Facebook groups bulk poster, Facebook Marketplace auto poster, Facebook group posting extension, Marketplace listing tool, Postika"
	/>
	<meta
		property="og:title"
		content="Post to Facebook Groups and Marketplace in bulk with Postika"
	/>
	<meta
		property="og:description"
		content="Reach more potential buyers while spending less time copying posts and filling listing forms. Start with Postika for free."
	/>
</svelte:head>

<header class="site-header">
	<a class="brand" href="#top" aria-label="Postika home">
		<span class="brand-mark" aria-hidden="true">P</span><span>Postika</span>
	</a>
	<nav aria-label="Main navigation">
		<a href="#workflows">Benefits</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a>
	</nav>
	<a
		class="button button-small button-dark"
		href={storeUrl}
		target="_blank"
		rel="noopener noreferrer"
	>
		Add to Chrome
	</a>
</header>

<main id="top">
	<section class="hero shell">
		<div class="hero-copy">
			<p class="eyebrow"><span></span> Reach more buyers. Spend less time posting.</p>
			<h1>Facebook Groups Bulk Poster &amp; <em>Marketplace Auto Poster</em> in One Place.</h1>
			<p class="hero-lead">
				Reach more potential buyers without spending hours copying and pasting. Prepare your posts
				and listings once, publish them across selected Facebook Groups and Marketplace, and manage
				both workflows from one Chrome extension instead of paying for separate posting tools.
			</p>
			<div class="hero-actions">
				<a class="button button-primary" href={storeUrl} target="_blank" rel="noopener noreferrer">
					Start Posting Free <span aria-hidden="true">→</span>
				</a>
				<a class="text-link" href="#how-it-works"
					>See What Postika Can Do <span aria-hidden="true">↓</span></a
				>
			</div>
			<div class="trust-row">
				<span>Save hours of repetitive work</span><span>One tool for two sales channels</span><span
					>Free to start</span
				>
			</div>
		</div>

		<div class="hero-product" aria-label="Postika product preview">
			<div class="product-window">
				<div class="window-bar">
					<div class="window-brand"><span class="mini-mark">P</span> Postika</div>
					<div class="window-actions"><span></span><span></span><span></span></div>
				</div>
				<div class="window-tabs"><strong>GROUPS</strong><span>MARKETPLACE</span></div>
				<div class="window-content">
					<p class="mock-label">PREPARED POSTS</p>
					<div class="mock-card selected">
						<div class="mock-thumb coral"></div>
						<div><strong>Weekend vehicle offer</strong><small>3 images · Ready to post</small></div>
						<span class="check">✓</span>
					</div>
					<div class="mock-card">
						<div class="mock-thumb blue"></div>
						<div><strong>Fresh arrivals</strong><small>5 images · Ready to post</small></div>
						<span class="empty-check"></span>
					</div>
					<div class="queue-card">
						<div><span>QUEUE PROGRESS</span><strong>12 / 20 posted</strong></div>
						<div class="progress"><span></span></div>
						<div class="queue-meta"><span>Next post in 02:14</span><b>Running</b></div>
					</div>
					<div class="mock-button">START POSTING</div>
				</div>
			</div>
			<div class="floating-note note-top">
				<span>✓</span>
				<div><b>Post published</b><small>Queue continues safely</small></div>
			</div>
			<div class="floating-note note-bottom">
				<span>20</span>
				<div><b>Free daily posts</b><small>For each workflow</small></div>
			</div>
		</div>
	</section>

	<section class="proof-strip" aria-label="Postika benefits">
		<div class="shell proof-grid">
			<div><strong>2</strong><span>sales channels in one tool</span></div>
			<div><strong>5 + 1</strong><span>free Group + Marketplace publications daily</span></div>
			<div><strong>Hours</strong><span>saved on repetitive posting</span></div>
			<div><strong>More</strong><span>time to respond to buyers</span></div>
		</div>
	</section>

	<section class="section shell">
		<div class="section-heading centered">
			<p class="eyebrow"><span></span> Work less on posting. Focus more on selling.</p>
			<h2>Spend less time repeating tasks—and more time talking to buyers.</h2>
			<p>
				Postika removes the repetitive work between a ready-to-sell product and the people who
				need to see it. One extension helps you save time, control costs, and get more value from
				every promotion.
			</p>
		</div>
		<div class="benefit-grid">
			<article>
				<span class="feature-number">01</span>
				<h3>Save hours every week</h3>
				<p>
					Reuse complete posts and listings instead of copying text, finding images, and filling the
					same forms again.
				</p>
			</article>
			<article>
				<span class="feature-number">02</span>
				<h3>Reach more potential buyers</h3>
				<p>Put your offers in front of selected Groups and Marketplace audiences from one place.</p>
			</article>
			<article>
				<span class="feature-number">03</span>
				<h3>Spend less on separate tools</h3>
				<p>
					Handle Group posts, Marketplace listings, copy rewriting, and cleanup in one extension.
				</p>
			</article>
		</div>
	</section>

	<section class="section workflow-section" id="workflows">
		<div class="shell">
			<div class="section-heading split-heading">
				<div>
					<p class="eyebrow"><span></span> More value from every promotion</p>
					<h2>More reach from the content you already have.</h2>
				</div>
				<p>
					Give every post and listing more opportunities to be seen while keeping the final choice
					of what, where, and when to publish in your hands.
				</p>
			</div>

			<div class="workflow-card">
				<div class="workflow-copy">
					<span class="pill">Postika GROUPS</span>
					<h3>Show up in more relevant Groups without repeating the work.</h3>
					<p>
						Turn one prepared campaign into wider Group visibility. Keep promotions moving at a
						steady pace while you focus on enquiries, customers, and closing sales.
					</p>
					<ul>
						{#each groupFeatures as feature}<li><span>✓</span>{feature}</li>{/each}
					</ul>
				</div>
				<div class="screenshot-frame">
					<div class="screenshot-label"><span class="live-dot"></span> Real extension workflow</div>
					<img
						src="/images/screenshot.png"
						alt="Postika side panel with loaded Facebook Groups and selectable posting targets"
					/>
				</div>
			</div>

			<div class="workflow-card marketplace-card">
				<div class="workflow-copy">
					<span class="pill pill-coral">Postika MARKETPLACE</span>
					<h3>List more inventory and keep buyers seeing what matters.</h3>
					<p>
						Get more Item and Car/Truck listings in front of potential buyers without repeatedly
						filling forms—and clear older active inventory when it is no longer useful.
					</p>
					<ul>
						{#each marketplaceFeatures as feature}<li><span>✓</span>{feature}</li>{/each}
					</ul>
				</div>
				<div class="marketplace-visual" aria-hidden="true">
					<div class="listing-card back-card">
						<div class="listing-photo photo-two"></div>
						<small>DRAFT</small><strong>Fresh arrival</strong>
					</div>
					<div class="listing-card front-card">
						<div class="listing-photo photo-one"><span>5 photos</span></div>
						<small>ITEM · READY</small><strong>Weekend offer</strong>
						<p>KSh 85,000</p>
						<div class="listing-progress"><span></span></div>
					</div>
					<div class="audience-card">
						<b>Choose your audience</b><span
							><i class="radio selected-radio"></i> Marketplace + Groups</span
						><span><i class="radio"></i> Marketplace only</span>
					</div>
				</div>
			</div>
		</div>
	</section>

	<section class="section shell" id="how-it-works">
		<div class="section-heading centered compact">
			<p class="eyebrow"><span></span> Less effort between you and your buyers</p>
			<h2>Four steps to wider reach and more selling time.</h2>
		</div>
		<div class="steps">
			<article>
				<span>1</span>
				<div>
					<h3>Keep your best offers ready</h3>
					<p>Save complete promotions once so they are ready whenever you want to sell.</p>
				</div>
			</article>
			<article>
				<span>2</span>
				<div>
					<h3>Choose your reach</h3>
					<p>Select the posts, listings, Groups, and audiences that matter to your business.</p>
				</div>
			</article>
			<article>
				<span>3</span>
				<div>
					<h3>Let the queue handle repetition</h3>
					<p>Start a paced publishing run instead of manually repeating every step.</p>
				</div>
			</article>
			<article>
				<span>4</span>
				<div>
					<h3>Focus on buyers</h3>
					<p>Monitor progress at a glance while you respond to leads and grow sales.</p>
				</div>
			</article>
		</div>
	</section>

	<section class="section highlight-section">
		<div class="shell highlight-grid">
			<div>
				<p class="eyebrow light"><span></span> Optional Gemini rewrite</p>
				<h2>Turn basic copy into buyer-ready descriptions faster.</h2>
				<p>
					Spend less time polishing every caption. Use your own Gemini API key to refresh wording
					and add relevant hashtags while preserving important prices, locations, and contact
					details. If rewriting fails, your original copy is still used.
				</p>
			</div>
			<div class="rewrite-demo">
				<div class="rewrite-label"><span>ORIGINAL</span><small>Saved locally</small></div>
				<p>Clean vehicle, well maintained. Call for viewing.</p>
				<div class="rewrite-arrow">↓</div>
				<div class="rewrite-label"><span>REWRITTEN</span><small>Optional</small></div>
				<p class="rewritten">
					Well-maintained and ready for the road. Contact us to arrange a viewing.
				</p>
			</div>
		</div>
	</section>

	<section class="section shell" id="pricing">
		<div class="section-heading centered compact">
			<p class="eyebrow"><span></span> Reach more buyers without a large upfront cost</p>
			<h2>Start selling for free. Upgrade when volume grows.</h2>
			<p>Facebook’s own posting limits, policies, and Group rules always continue to apply.</p>
		</div>
		<div class="pricing-grid">
			<article class="price-card">
				<div class="price-heading">
					<span>FREE</span><strong>KSh 0</strong><small>start saving time today</small>
				</div>
				<ul>
					<li><span>✓</span>1 saved Group post</li>
					<li><span>✓</span>1 saved Marketplace listing</li>
					<li><span>✓</span>5 successful Group posts per day</li>
					<li><span>✓</span>1 successful Marketplace listing per day</li>
					<li><span>✓</span>All core queue controls</li>
				</ul>
				<a class="button button-outline" href={storeUrl} target="_blank" rel="noopener noreferrer"
					>Start Posting Free</a
				>
			</article>
			<article class="price-card pro-card">
				<div class="popular-tag">FOR BUSINESSES READY TO REACH MORE BUYERS</div>
				<div class="price-heading">
					<span>PRO</span><strong>Let’s talk</strong><small
						>remove Postika limits as you grow</small
					>
				</div>
				<ul>
					<li><span>✓</span>Unlimited saved Group posts</li>
					<li><span>✓</span>Unlimited saved Marketplace listings</li>
					<li><span>✓</span>No Postika daily publishing limit</li>
					<li><span>✓</span>All core queue controls</li>
					<li><span>✓</span>Direct upgrade support</li>
				</ul>
				<div class="contact-actions">
					<a
						class="button button-primary"
						href={whatsappUrl}
						target="_blank"
						rel="noopener noreferrer">WhatsApp</a
					><a class="button button-outline" href={emailUrl}>Email</a>
				</div>
			</article>
		</div>
		<p class="reset-note">
			Daily Free limits reset at midnight in your account timezone. Only successful publications
			count.
		</p>
	</section>

	<section class="section shell compatibility">
		<div class="compatibility-card">
			<div>
				<p class="eyebrow"><span></span> Know before you install</p>
				<h2>Designed for real Facebook interfaces—not an imaginary one-size-fits-all layout.</h2>
			</div>
			<div class="compatibility-copy">
				<p>
					Only the <strong>first Group post in each queue</strong> depends on Facebook’s visible
					composer. The first selected Group must show the English
					<strong>“Write something...”</strong> button. If a Buy & Sell or nonstandard Group does not
					show it, place a compatible Group first and restart the queue. After that first post succeeds,
					Postika can continue with the remaining selected Groups.
				</p>
				<p>
					Marketplace publishing and cleanup are tested against the <strong
						>English Kenyan layout</strong
					>. Other regional layouts—including the US—may differ and can be assessed for
					customization.
				</p>
				<p>
					Cleanup targets only visible <strong>active listings</strong> older than your selected threshold.
					It does not remove inactive or duplicate listings.
				</p>
			</div>
		</div>
	</section>

	<section class="section faq-section" id="faq">
		<div class="shell faq-layout">
			<div class="section-heading">
				<p class="eyebrow"><span></span> Straight answers</p>
				<h2>Frequently asked questions.</h2>
				<p>Still unsure? Reach the developer directly for setup or regional-layout questions.</p>
				<a class="text-link" href={whatsappUrl} target="_blank" rel="noopener noreferrer"
					>Ask on WhatsApp →</a
				>
			</div>
			<div class="faq-list">
				{#each faqs as faq}<details>
						<summary>{faq.question}<span aria-hidden="true">+</span></summary>
						<p>{faq.answer}</p>
					</details>{/each}
			</div>
		</div>
	</section>

	<section class="final-cta">
		<div class="shell final-cta-inner">
			<div>
				<p class="eyebrow light"><span></span> Make every selling hour count</p>
				<h2>Spend less time reposting. Spend more time closing sales.</h2>
			</div>
			<a class="button button-light" href={storeUrl} target="_blank" rel="noopener noreferrer"
				>Start Posting Free <span aria-hidden="true">→</span></a
			>
		</div>
	</section>
</main>

<footer>
	<div class="shell footer-inner">
		<a class="brand" href="#top"
			><span class="brand-mark" aria-hidden="true">P</span><span>Postika</span></a
		>
		<p>Helping sellers reach more buyers with less repetitive work.</p>
		<div><a href="/privacy-policy">Privacy Policy</a><a href={emailUrl}>Contact</a></div>
	</div>
	<p class="disclaimer">
		© 2026 Postika. Not affiliated with, endorsed by, or sponsored by Meta or Facebook.
	</p>
</footer>
