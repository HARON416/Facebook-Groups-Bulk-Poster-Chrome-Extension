<section>
	<div class="offer">
		<h1>Post to multiple Facebook groups from one clean workspace.</h1>
		<p>
			Load your joined groups, prepare one post with images, choose the delay between posts, and run
			the queue from a focused Chrome extension side panel.
		</p>
		<div class="actions">
			<a href="https://chromewebstore.google.com/" target="_blank" rel="noopener noreferrer">
				Download Extension
			</a>
			<a
				class="secondary"
				href="https://wa.me/254718448461?text=Hi%2C%20I%27m%20interested%20in%20your%20Facebook%20Groups%20Bulk%20Poster%20extension"
				target="_blank"
				rel="noopener noreferrer"
			>
				WhatsApp Developer
			</a>
		</div>
	</div>
</section>

<style>
	section {
		width: 100%;
		min-height: 50dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 6rem 2rem 2rem;
	}

	section > .offer {
		width: min(100%, 76rem);
		display: flex;
		flex-direction: column;
		gap: 3rem;
		align-items: center;
		justify-content: center;
		text-align: center;
	}

	section > .offer > h1 {
		font-size: clamp(3.4rem, 5vw, 5.8rem);
		font-weight: 600;
		line-height: 1.05;
		color: #222831;
	}

	section > .offer > p {
		font-size: clamp(1.7rem, 2vw, 2rem);
		line-height: 1.65;
		color: #393e46;
		max-width: 62rem;
	}

	section > .offer > .actions {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		width: 100%;
		align-items: center;
	}

	section > .offer > .actions > a {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 1.55rem;
		font-weight: 700;
		letter-spacing: 0.01em;
		color: white;
		transition: all 0.3s ease;
		padding: 1.45rem 2.4rem;
		border-radius: 1.4rem;
		text-decoration: none;
		width: min(100%, 31rem);
		background: linear-gradient(180deg, #239a56 0%, #1b7c44 100%);
		box-shadow: 0 1.6rem 3rem rgba(31, 143, 78, 0.18);
	}

	section > .offer > .actions > a:hover {
		transform: translateY(-0.15rem);
		box-shadow: 0 1.9rem 3.4rem rgba(31, 143, 78, 0.22);
	}

	section > .offer > .actions > a.secondary {
		color: #222831;
		background: rgba(255, 255, 255, 0.92);
		border: 0.1rem solid rgba(34, 40, 49, 0.12);
		box-shadow: 0 0.8rem 2.2rem rgba(34, 40, 49, 0.08);
	}

	section > .offer > .actions > a.secondary:hover {
		box-shadow: 0 1.1rem 2.6rem rgba(34, 40, 49, 0.1);
	}

	@media (max-width: 768px) {
		section {
			min-height: auto;
			padding-top: 5rem;
		}

		section > .offer {
			gap: 2.2rem;
		}

		section > .offer > .actions > a {
			width: 100%;
		}
	}
</style>
