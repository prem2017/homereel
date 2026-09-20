// Served from the same origin as the backend, so a relative base works both in
// production (Express serves the built app) and in dev (Vite proxies /api).
export const API_BASE_URL = 'api';

export const SUPPORTED_VIDEO_EXTENSIONS = ['mp4', 'mkv', 'avi', 'webm', 'mov'];
export const SUPPORTED_AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'wma'];
export const SUPPORTED_SUBTITLE_EXTENSIONS = ['vtt', 'srt'];
