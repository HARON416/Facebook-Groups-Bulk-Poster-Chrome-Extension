<script lang="ts">
	import { createExtensionCode, loginRequest, saveWebSession, signupRequest } from '$lib/auth-client';

	type Mode = 'login' | 'signup';

	let { mode }: { mode: Mode } = $props();

	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let loading = $state(false);
	let error = $state('');
	let success = $state('');

	const isSignup = $derived(mode === 'signup');

	function authPageTitle() {
		return isSignup ? 'Create your account' : 'Welcome back';
	}

	function authPageSummary() {
		return isSignup
			? 'Create an account to unlock the extension and manage your Facebook group posting workflow.'
			: 'Sign in to continue using the extension and generate a fresh auth session.';
	}

	function alternateHref() {
		return isSignup ? '/login' : '/signup';
	}

	function alternateLabel() {
		return isSignup ? 'Already have an account? Log in' : 'Need an account? Sign up';
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		success = '';

		const trimmedEmail = email.trim().toLowerCase();
		const trimmedPassword = password.trim();

		if (!trimmedEmail) {
			error = 'Email is required.';
			return;
		}

		if (trimmedPassword.length < 8) {
			error = 'Password must be at least 8 characters.';
			return;
		}

		if (isSignup && trimmedPassword !== confirmPassword.trim()) {
			error = 'Passwords do not match.';
			return;
		}

		const params = new URLSearchParams(window.location.search);
		const redirectUri = params.get('redirect_uri');
		const state = params.get('state');

		loading = true;
		try {
			const response = isSignup
				? await signupRequest(trimmedEmail, trimmedPassword)
				: await loginRequest(trimmedEmail, trimmedPassword);

			saveWebSession(response);

			if (redirectUri) {
				const extensionCode = await createExtensionCode(response.token);
				const callbackUrl = new URL(redirectUri);
				callbackUrl.searchParams.set('code', extensionCode.code);
				if (state) {
					callbackUrl.searchParams.set('state', state);
				}

				window.location.href = callbackUrl.toString();
				return;
			}

			success = isSignup
				? 'Account created successfully. You are now signed in.'
				: 'Logged in successfully.';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unable to complete authentication.';
		} finally {
			loading = false;
		}
	}
</script>

<section class="auth-shell">
	<div class="auth-card">
		<p class="auth-card__eyebrow">{isSignup ? 'Create Access' : 'Sign In'}</p>
		<h1>{authPageTitle()}</h1>
		<p>{authPageSummary()}</p>

	<form class="auth-form" onsubmit={handleSubmit}>
			<label>
				<span>Email</span>
				<input bind:value={email} type="email" autocomplete="email" placeholder="you@example.com" />
			</label>

			<label>
				<span>Password</span>
				<input
					bind:value={password}
					type="password"
					autocomplete={isSignup ? 'new-password' : 'current-password'}
					placeholder="At least 8 characters"
				/>
			</label>

			{#if isSignup}
				<label>
					<span>Confirm password</span>
					<input
						bind:value={confirmPassword}
						type="password"
						autocomplete="new-password"
						placeholder="Repeat your password"
					/>
				</label>
			{/if}

			{#if error}
				<div class="auth-feedback auth-feedback--error">{error}</div>
			{/if}

			{#if success}
				<div class="auth-feedback auth-feedback--success">{success}</div>
			{/if}

			<button type="submit" disabled={loading}>
				{#if loading}
					{isSignup ? 'Creating account...' : 'Signing in...'}
				{:else}
					{isSignup ? 'Create account' : 'Log in'}
				{/if}
			</button>
		</form>

		<a class="auth-link" href={alternateHref()}>{alternateLabel()}</a>
	</div>
</section>
