import { API_BASE_URL } from '../constants';
import {
  FileNode, SearchResult, MediaType, SubtitleLanguage,
  SubtitleProviderProblem, SubtitleSearchResponse, SubtitleDownloadResponse,
  SubtitleCheckResponse, SubsceneConfig,
} from '../types';

// Surface the server's own explanation (for example "Media directory not
// found: /media"), which is far more useful on a TV screen than a generic
// failure message.
const readError = async (response: Response): Promise<string> => {
  try {
    const body = await response.json();
    if (body?.error) return body.error;
  } catch {
    // Response was not JSON; fall through to the status text.
  }
  return `Server responded with ${response.status} ${response.statusText}`;
};

export const fetchFileTree = async (): Promise<FileNode[]> => {
  const response = await fetch(`${API_BASE_URL}/files`);
  if (!response.ok) throw new Error(await readError(response));
  return await response.json();
};

export const searchFiles = async (query: string, type: MediaType): Promise<SearchResult[]> => {
  const response = await fetch(
    `${API_BASE_URL}/search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}`
  );
  if (!response.ok) throw new Error(await readError(response));
  return await response.json();
};

// `path` is relative to the server's media directory, so it is safe to hand
// straight back to the API.
export const getStreamUrl = (path: string) =>
  `${API_BASE_URL}/stream?path=${encodeURIComponent(path)}`;

// A subtitle's text, decoded on the server. The player reads subtitles with
// fetch().text(), which only knows UTF-8, so a file saved in anything else comes
// out as "Caf�" when it is read raw through /stream.
export const getSubtitleTextUrl = (path: string) =>
  `${API_BASE_URL}/subtitles/text?path=${encodeURIComponent(path)}`;

// The languages on offer, plus which download sources are actually usable. Both
// depend on .env, so they are asked for rather than assumed.
export const fetchSubtitleLanguages = async (): Promise<{
  languages: SubtitleLanguage[];
  providers: string[];
  unavailable: SubtitleProviderProblem[];
  subscene?: SubsceneConfig;
}> => {
  const response = await fetch(`${API_BASE_URL}/subtitles/languages`);
  if (!response.ok) throw new Error(await readError(response));
  return await response.json();
};

// Free, unlike downloading - the one source with a by-id box has no account and
// no allowance - which is what makes it reasonable to ask while the user types.
export const checkSubtitleRef = async (
  provider: string,
  ref: string
): Promise<SubtitleCheckResponse> => {
  const response = await fetch(
    `${API_BASE_URL}/subtitles/check?provider=${encodeURIComponent(provider)}&ref=${encodeURIComponent(ref)}`
  );
  if (!response.ok) throw new Error(await readError(response));
  return await response.json();
};

// Searching is not metered by the providers, so this is cheap to call.
export const searchSubtitles = async (
  path: string,
  language: string
): Promise<SubtitleSearchResponse> => {
  const response = await fetch(
    `${API_BASE_URL}/subtitles/search?path=${encodeURIComponent(path)}&language=${encodeURIComponent(language)}`
  );
  if (!response.ok) throw new Error(await readError(response));
  return await response.json();
};

// Downloading *is* metered - a handful a day on a free account - so this is only
// ever called for a subtitle the user has actually chosen or auto-accepted.
export const downloadSubtitle = async (
  path: string,
  // Optional: a subtitle taken by id carries its own language, and the server
  // reads it off the provider's page rather than believing this.
  language: string | undefined,
  provider: string,
  ref: string
): Promise<SubtitleDownloadResponse> => {
  const response = await fetch(`${API_BASE_URL}/subtitles/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, language, provider, ref }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return await response.json();
};
