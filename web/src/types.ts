export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  mimeType?: string; // e.g., 'video/mp4', 'audio/mp3'
}

export interface SearchResult {
  name: string;
  path: string;
  type: 'file' | 'directory';
  // /api/search returns whole file nodes, so the real type detected by the server
  // is already on the wire. Guessing it from the extension instead sends .m4a and
  // .flac down the <video> branch and renders a black box.
  mimeType?: string;
}

export interface SubtitleTrack {
  id: string;
  label: string;
  src: string;
  language: string;
}

export interface MediaState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isFullscreen: boolean;
  playbackRate: number;
}

// A language offered in the subtitle menus. The list comes from the server
// because SUBTITLE_LANGUAGES in .env can replace it, so there is one source of
// truth rather than a copy in the bundle that silently disagrees.
export interface SubtitleLanguage {
  code: string;
  name: string;
}

// One subtitle a provider is offering for the current video.
export interface SubtitleCandidate {
  provider: string;
  ref: string;
  language: string;
  release: string;
  fileName: string;
  downloads: number;
  hashMatch: boolean;
  // 0 = matched on a hash of the video file, 1 = exact release name, 2 = title.
  // Tier 0 is the only one guaranteed to be in sync with this exact copy.
  tier: number;
}

// A source that could not be used, and why. Surfaced briefly on screen so a
// site being down looks different from the feature being broken.
export interface SubtitleProviderProblem {
  name: string;
  reason: string;
}

/** The by-id box's own settings, since it names one site by hand and both facts
 *  about it live in .env: which address, and whether it is switched on. */
export interface SubsceneConfig {
  /** Host only, for showing: "sub-scene.com". Empty when the feature is off. */
  site: string;
  ready: boolean;
  /** Why not, when `ready` is false - it names the line of .env to edit. */
  reason: string | null;
}

/** Whether a typed reference leads to a real subtitle. Asked before Get is
 *  offered, so that a green light means the download will work rather than that
 *  the digits are well-formed. */
export interface SubtitleCheckResponse {
  ok: boolean;
  reason?: string;
  /** The configured address is not answering, as opposed to the reference being
   *  wrong. Different fix: edit .env rather than type another number. */
  unreachable?: boolean;
  /** What the provider's page calls it - it states the language too. */
  title?: string | null;
  language?: string | null;
}

export interface SubtitleSearchResponse {
  candidates: SubtitleCandidate[];
  unavailable: SubtitleProviderProblem[];
}

export interface SubtitleDownloadResponse {
  path: string;
  name: string;
  /** What the file turned out to be written in - the server detects this rather
   *  than trusting the menu, so it can differ from the language that was asked
   *  for. It is the language the saved file is named after. */
  language: string;
  /** Other videos in the same folder this download also produced a subtitle for:
   *  one archive is often a whole season. Empty for an ordinary download. */
  alsoSaved: { path: string; name: string }[];
  // Providers meter downloads; null when the provider does not report a figure.
  /** `key` names which key of a pool the count belongs to; null when there is one. */
  quota: { remaining: number; resetTime: string | null; key?: string | null } | null;
}

export enum MediaType {
  VIDEO = 'video',
  AUDIO = 'audio',
  ALL = 'all'
}