import { describe, it, expect } from 'vitest';
import { defaultSubtitle, describeSubtitle, languageName, languageOfSubtitle } from './subtitleLabel';
import type { FileNode } from '../types';

const sub = (path: string): FileNode => ({ name: path.split('/').pop()!, path, type: 'file' });

describe('languageOfSubtitle', () => {
  it('reads the three shapes subtitles arrive in', () => {
    expect(languageOfSubtitle('OS_Ford-V-Ferrari_1080p_en1.srt')).toBe('en');
    expect(languageOfSubtitle('Sintel.2010.720p.fr.srt')).toBe('fr');
    expect(languageOfSubtitle('Film.eng.forced.srt')).toBe('en');
    expect(languageOfSubtitle('French.srt')).toBe('fr');
    expect(languageOfSubtitle('2_English.srt')).toBe('en');
    expect(languageOfSubtitle('kan.srt')).toBe('kn');
  });

  it('says nothing for a name that says nothing', () => {
    expect(languageOfSubtitle('Episode 1.srt')).toBeNull();
    expect(languageOfSubtitle('Film.srt')).toBeNull();
    // "_HI_" style tags and three-letter words that are not languages.
    expect(languageOfSubtitle('Film.the.srt')).toBeNull();
  });
});

describe('describeSubtitle', () => {
  const video = 'Films/Sintel (2010)/Sintel.2010.720p.mp4';
  it('says what each kind of subtitle is', () => {
    expect(describeSubtitle(sub('Films/Sintel (2010)/Sintel.2010.720p.en.srt'), video, 'Sintel.2010.720p.mp4'))
      .toBe('English · named like the film (.en.srt)');
    expect(describeSubtitle(sub('Films/Sintel (2010)/Subs/French.srt'), video, 'Sintel.2010.720p.mp4'))
      .toBe('French · Subs/French.srt');
    expect(describeSubtitle(sub('Films/Sintel (2010)/OS_Sintel_720p_en2.srt'), video, 'Sintel.2010.720p.mp4'))
      .toBe('English · OpenSubtitles #2 · 720p');
    expect(describeSubtitle(sub('Films/Sintel (2010)/Sintel.2010.720p.srt'), video, 'Sintel.2010.720p.mp4'))
      .toBe('Subtitles · named like the film (.srt)');
    expect(describeSubtitle(sub('Films/Sintel (2010)/other.srt'), video, 'Sintel.2010.720p.mp4')).toBe('other.srt');
  });

  it('names languages it knows and capitalises the rest', () => {
    expect(languageName('kn')).toBe('Kannada');
    expect(languageName('xx')).toBe('XX');
  });
});

describe('defaultSubtitle', () => {
  const ar = sub('Films/Film.ar.srt');
  const en = sub('Films/Film.en.srt');
  const otherEn = sub('Films/Subs/English.srt');
  const plain = sub('Films/notes.srt');

  it('prefers the language over the folder order', () => {
    expect(defaultSubtitle([ar, en], 'Film.mp4', 'en')).toBe(en);
    expect(defaultSubtitle([ar, en], 'Film.mp4', 'ar')).toBe(ar);
  });

  it('prefers a file named after the film within the language, then the language anywhere', () => {
    expect(defaultSubtitle([otherEn, en], 'Film.mp4', 'en')).toBe(en);
    expect(defaultSubtitle([ar, otherEn], 'Film.mp4', 'en')).toBe(otherEn);
  });

  it('falls back to the old rule: named after the film, then the first', () => {
    expect(defaultSubtitle([plain, ar], 'Film.mp4', 'de')).toBe(ar);
    expect(defaultSubtitle([plain], 'Film.mp4', null)).toBe(plain);
    expect(defaultSubtitle([], 'Film.mp4', 'en')).toBeNull();
  });

  it('leaves out what the other slot shows', () => {
    expect(defaultSubtitle([ar, en], 'Film.mp4', 'en', en)).toBe(ar);
  });
});
