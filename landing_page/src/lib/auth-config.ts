import { dev } from '$app/environment';

export const WEB_STORAGE_TOKEN_KEY = 'fgbp_web_token';
export const WEB_STORAGE_USER_KEY = 'fgbp_web_user';
export const WEB_STORAGE_EXPIRES_AT_KEY = 'fgbp_web_expires_at';

const DEV_API_BASE_URL = 'http://localhost:4000';
const PROD_API_BASE_URL = 'https://api.facebook-groups-bulk-poster.softwrhq.com';

export const API_BASE_URL = dev ? DEV_API_BASE_URL : PROD_API_BASE_URL;
