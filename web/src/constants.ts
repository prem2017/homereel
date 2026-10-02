// Served from the same origin as the backend, so a relative base works both in
// production (Express serves the built app) and in dev (Vite proxies /api).
export const API_BASE_URL = 'api';
