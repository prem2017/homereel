import { describe, it, expect } from 'vitest';
import { describeSubtitle, languageName, languageOfSubtitle } from './subtitleLabel';
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
