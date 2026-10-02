/**
 * What a failed file says on screen: what happened, why, and what fixes it.
 *
 * Written for the person holding the remote, who can do something about the
 * file but not about the browser. The container decides the advice - telling an
 * MP4 to "convert it to MP4" was the message most worth replacing, since it is
 * the one a family member reads when a film will not start.
 */
export interface PlaybackProblem {
  title: string;
  detail: string;
  /** Null when there is nothing to do to the file itself. */
  fix: string | null;
}

const AUDIO = ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'wma', 'ac3', 'dts', 'mka', 'aiff'];
const TO_MP4 = 'Converting it to MP4 with H.264 video and AAC audio fixes it.';
const REENCODE = 'Re-encoding it to H.264 video with AAC audio fixes it.';

const extensionOf = (name: string | null) => {
  const match = name ? /\.([a-z0-9]+)$/i.exec(name) : null;
  return match ? match[1].toLowerCase() : '';
};

/** The advice for a file this browser cannot open, by what kind of file it is. */
const unsupported = (ext: string, mimeType: string | null): PlaybackProblem => {
  const label = ext.toUpperCase();
  if (ext === 'mp4' || ext === 'm4v' || ext === 'mov') {
    return {
      title: `This ${label} won't play in this browser`,
      detail: `It is an ${label === 'MOV' ? 'MOV' : 'MP4'}, but the video or audio inside uses a codec this browser can't decode. On TVs that is usually HEVC (H.265) video, or AC-3 or DTS audio.`,
      fix: REENCODE,
    };
  }
  if (ext === 'mkv') {
    return {
      title: 'This MKV won\'t play in this browser',
      detail: 'Many TV browsers can\'t open MKV files at all, and the ones that can still need codecs they know.',
      fix: TO_MP4,
    };
  }
  if (ext === 'webm') {
    return {
      title: 'This WebM won\'t play in this browser',
      detail: 'It is a WebM, but this browser can\'t decode what is inside. Older TVs have no VP9 or AV1.',
      fix: TO_MP4,
    };
  }
  if (AUDIO.indexOf(ext) !== -1 || (mimeType || '').indexOf('audio/') === 0) {
    return {
      title: `This ${label || 'audio file'} won't play in this browser`,
      detail: `This browser can't decode ${label ? `${label} audio` : 'this kind of audio'}.`,
      fix: 'Converting it to MP3 or AAC (.m4a) fixes it.',
    };
  }
  return {
    title: `This ${label ? `${label} file` : 'file'} won't play in this browser`,
    detail: `This browser can't open ${label ? `${label} files` : (mimeType || 'this kind of file')}.`,
    fix: TO_MP4,
  };
};

/**
 * A MediaError code, read for this file. Codes: 1 aborted, 2 network, 3 decode,
 * 4 source not supported - the last is the codec case, by far the likeliest on
 * a TV.
 */
export const describePlaybackError = (
  code: number | undefined, fileName: string | null, mimeType: string | null,
): PlaybackProblem => {
  const ext = extensionOf(fileName);
  switch (code) {
    case 1:
      return { title: 'Playback stopped before it started', detail: 'The browser gave up on this file before playing any of it.', fix: null };
    case 2:
      return {
        title: 'Lost the connection while streaming',
        detail: 'This screen stopped hearing from the computer running HomeReel.',
        fix: 'Check the Wi-Fi, and that HomeReel is still running, then try again.',
      };
    case 3:
      return {
        title: 'Part of this file can\'t be decoded',
        detail: 'It started, then hit something this browser can\'t decode: a damaged file, or a codec it only partly supports.',
        fix: ext === 'mp4' || ext === 'm4v' || ext === 'mov' ? REENCODE : TO_MP4,
      };
    case 4:
      return unsupported(ext, mimeType);
    default:
      return { title: 'Playback failed', detail: 'The browser did not say why.', fix: null };
  }
};
