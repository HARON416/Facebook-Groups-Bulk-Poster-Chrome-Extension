<script>
	import Features from '$lib/assets/Features.svelte';
	import Footer from '$lib/Footer.svelte';
	import Image from '$lib/Image.svelte';
	import Offer from '$lib/Offer.svelte';
</script>

<svelte:head>
	<title>Facebook Groups Bulk Poster</title>
	<meta
		name="description"
		content="Post to multiple Facebook groups from one Chrome extension side panel. Load your groups, attach images, set delays, and optionally rewrite copy with Gemini."
	/>
</svelte:head>

<Offer />
<Image />
<Features />
<Footer />
