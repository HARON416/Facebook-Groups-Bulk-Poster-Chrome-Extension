import { WEB_STORAGE_EXPIRES_AT_KEY, WEB_STORAGE_TOKEN_KEY, WEB_STORAGE_USER_KEY, API_BASE_URL } from '$lib/auth-config';

export type AuthUser = {
	id: number;
	email: string;
	created_at: string;
};

export type AuthResponse = {
	user: AuthUser;
	token: string;
	expires_at: string;
};

type ExtensionCodeResponse = {
	code: string;
	expires_at: string;
};

export async function loginRequest(email: string, password: string): Promise<AuthResponse> {
	return requestAuth('/api/auth/login', email, password);
}

export async function signupRequest(email: string, password: string): Promise<AuthResponse> {
	return requestAuth('/api/auth/register', email, password);
}

async function requestAuth(path: string, email: string, password: string): Promise<AuthResponse> {
	const response = await fetch(`${API_BASE_URL}${path}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ email, password })
	});

	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(typeof payload?.error === 'string' ? payload.error : 'Authentication failed.');
	}

	return payload as AuthResponse;
}

export function saveWebSession(response: AuthResponse) {
	localStorage.setItem(WEB_STORAGE_TOKEN_KEY, response.token);
	localStorage.setItem(WEB_STORAGE_USER_KEY, JSON.stringify(response.user));
	localStorage.setItem(WEB_STORAGE_EXPIRES_AT_KEY, response.expires_at);
}

export async function createExtensionCode(token: string): Promise<ExtensionCodeResponse> {
	const response = await fetch(`${API_BASE_URL}/api/auth/extension/code`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`
		}
	});

	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to authorize extension.');
	}

	return payload as ExtensionCodeResponse;
}
