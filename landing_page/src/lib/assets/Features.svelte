<section>
	<div class="heading">
		<h2>Built for people who post to Facebook groups often.</h2>
	</div>
	<div class="features">
		<div class="feature">
			<h3>Load Joined Groups</h3>
			<p>
				Pull in your joined Facebook groups so you can choose your posting targets from one place.
			</p>
		</div>
		<div class="feature">
			<h3>Write Once, Post Many</h3>
			<p>
				Prepare one post body and reuse it across multiple selected groups instead of repeating the
				same manual work.
			</p>
		</div>
		<div class="feature">
			<h3>Multiple Images</h3>
			<p>
				Attach multiple images to each queued post so listings and promotions look complete.
			</p>
		</div>
		<div class="feature">
			<h3>Control the Delay</h3>
			<p>
				Set the time between posts so the queue moves at a pace that feels more controlled.
			</p>
		</div>
		<div class="feature">
			<h3>Live Progress</h3>
			<p>
				See posted, failed, remaining, and time-to-next-post updates while the queue runs.
			</p>
		</div>
		<div class="feature">
			<h3>Optional Gemini Rewrite</h3>
			<p>
				Optionally rewrite your post copy into something cleaner and more persuasive before posting.
			</p>
		</div>
	</div>
</section>

<style>
	section {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3rem;
		margin-top: 8rem;
		padding: 0 2rem 8rem;
	}

	section > .heading {
		width: 100%;
		display: flex;
		justify-content: center;
		text-align: center;
	}

	section > .heading > h2 {
		width: min(100%, 72rem);
		font-size: clamp(2.8rem, 4vw, 4.2rem);
		font-weight: 600;
		line-height: 1.1;
		color: #222831;
	}

	section > .features {
		width: min(100%, 120rem);
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1.6rem;
	}

	section > .features > .feature {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		border: 0.1rem solid #eeeeee;
		padding: 2rem;
		border-radius: 0.5rem;
		background: #ffffff;
		box-shadow: 0 1.2rem 3rem rgba(15, 23, 42, 0.05);
	}

	section > .features > .feature > h3 {
		font-size: 1.6rem;
		font-weight: 600;
		line-height: 1.2;
		color: #222831;
	}

	section > .features > .feature > p {
		font-size: 1.5rem;
		line-height: 1.65;
		font-weight: 500;
		color: #393e46;
	}

	@media (max-width: 1024px) {
		section > .features {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 768px) {
		section {
			margin-top: 6rem;
			gap: 2.4rem;
			padding-bottom: 6rem;
		}

		section > .features {
			grid-template-columns: 1fr;
		}

		section > .features > .feature {
			padding: 1.8rem;
		}
	}
</style>
