import type { FileNode } from '../types';
import { parseSubtitleFileName } from './subtitleNaming';
import { folderOf } from './siblings';

/**
 * What a subtitle file is, in words: its language, and where it came from.
 *
 * Read off the name only - the three shapes subtitles arrive in: this app's own
 * downloads (`OS_Film_1080p_en2.srt`), a file named like its film
 * (`Film.en.srt`), and a release's Subs folder (`Subs/French.srt`). A name that
 * says none of that is shown as it is.
 */

// ISO 639-2 codes and English names, folded to the two-letter code the
// downloads use. Not Intl.DisplayNames: that is Chrome 81, the TV is 47.
const ALIASES: Record<string, string> = {
  eng: 'en', english: 'en', fre: 'fr', fra: 'fr', french: 'fr', spa: 'es', spanish: 'es',
  ger: 'de', deu: 'de', german: 'de', ita: 'it', italian: 'it', por: 'pt', portuguese: 'pt',
  dut: 'nl', nld: 'nl', dutch: 'nl', hin: 'hi', hindi: 'hi', kan: 'kn', kannada: 'kn',
  tam: 'ta', tamil: 'ta', tel: 'te', telugu: 'te', mal: 'ml', malayalam: 'ml', ben: 'bn',
  bengali: 'bn', mar: 'mr', marathi: 'mr', urd: 'ur', urdu: 'ur', ara: 'ar', arabic: 'ar',
  chi: 'zh', zho: 'zh', chinese: 'zh', jpn: 'ja', japanese: 'ja', kor: 'ko', korean: 'ko',
  rus: 'ru', russian: 'ru', swe: 'sv', swedish: 'sv', nor: 'no', norwegian: 'no',
  dan: 'da', danish: 'da', fin: 'fi', finnish: 'fi', pol: 'pl', polish: 'pl',
  tur: 'tr', turkish: 'tr', heb: 'he', hebrew: 'he', gre: 'el', ell: 'el', greek: 'el',
  ces: 'cs', cze: 'cs', czech: 'cs', hun: 'hu', hungarian: 'hu', rum: 'ro', ron: 'ro',
  romanian: 'ro', vie: 'vi', vietnamese: 'vi', tha: 'th', thai: 'th', ind: 'id', indonesian: 'id',
};

const NAMES: Record<string, string> = {
  en: 'English', fr: 'French', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese',
  nl: 'Dutch', hi: 'Hindi', kn: 'Kannada', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam',
  bn: 'Bengali', mr: 'Marathi', ur: 'Urdu', ar: 'Arabic', zh: 'Chinese', ja: 'Japanese',
  ko: 'Korean', ru: 'Russian', sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish',
  pl: 'Polish', tr: 'Turkish', he: 'Hebrew', el: 'Greek', cs: 'Czech', hu: 'Hungarian',
  ro: 'Romanian', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian',
};

const PROVIDERS: Record<string, string> = { os: 'OpenSubtitles', sd: 'SubDL', ss: 'Subscene' };

const codeFor = (word: string): string | null => {
  const lower = word.toLowerCase();
  if (NAMES[lower]) return lower;
  return ALIASES[lower] || null;
};

/** "en", "fr" ... or null when the name does not say. */
export const languageOfSubtitle = (name: string): string | null => {
  const download = parseSubtitleFileName(name);
  if (download) return codeFor(download.language) || download.language;
  const base = name.replace(/\.(srt|vtt)$/i, '');
  // "kan.srt", "English.srt": a Subs folder labels its files by language alone.
  if (codeFor(base)) return codeFor(base);
  // "Film.en.srt", "Film.eng.forced.srt", "Film_fr.srt"
  const tagged = /[._-]([a-z]{2,3})(?:[._-](?:forced|sdh|hi|cc|full))?$/i.exec(base);
  if (tagged && codeFor(tagged[1])) return codeFor(tagged[1]);
  // "2_English.srt" - numbered, as some releases ship them.
  const word = /([a-z]+)$/i.exec(base);
  return word && word[1].length > 3 ? codeFor(word[1]) : null;
};

/** "English", or the code in capitals for one this table does not know. */
export const languageName = (code: string): string => NAMES[code] || code.toUpperCase();

/**
 * One line for a Source menu: "English · named like the film (.en.srt)",
 * "French · Subs/French.srt", "English · OpenSubtitles #2 · 1080p". The option's
 * value stays the path; this is only what it says.
 */
export const describeSubtitle = (subtitle: FileNode, videoPath: string, videoName: string): string => {
  const code = languageOfSubtitle(subtitle.name);
  const language = code ? languageName(code) : null;
  const download = parseSubtitleFileName(subtitle.name);
  if (download) {
    const source = PROVIDERS[download.provider.toLowerCase()] || download.provider;
    return [language || download.language.toUpperCase(), `${source} #${download.counter}`, download.resolution]
      .filter(Boolean).join(' · ');
  }
  const base = videoName.replace(/\.[^.]+$/, '');
  if (base && subtitle.name.indexOf(base) === 0) {
    const rest = subtitle.name.slice(base.length);
    return `${language || 'Subtitles'} · named like the film (${rest})`;
  }
  const here = folderOf(videoPath);
  const where = subtitle.path.indexOf(here) === 0 ? subtitle.path.slice(here.length) : subtitle.name;
  return language ? `${language} · ${where}` : where;
};

/**
 * The subtitle a slot shows when nothing was chosen for this video: one in the
 * preferred language, named after the film before any other; then one named
 * after the film; then the folder's first. Folder order alone let
 * `Film.ar.srt` beat `Film.en.srt`. `except` is what the other slot shows.
 */
export const defaultSubtitle = (
  available: FileNode[], videoName: string | null, language: string | null, except?: FileNode | null,
): FileNode | null => {
  const base = videoName ? videoName.replace(/\.[^.]+$/, '') : '';
  const pool = available.filter(s => !except || s.path !== except.path);
  const named = (s: FileNode) => base !== '' && s.name.indexOf(base) === 0;
  const spoken = (s: FileNode) => language !== null && languageOfSubtitle(s.name) === language;
  return pool.find(s => spoken(s) && named(s)) || pool.find(spoken) || pool.find(named) || pool[0] || null;
};
