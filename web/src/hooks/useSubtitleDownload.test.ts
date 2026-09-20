import { describe, it, expect } from 'vitest';
import { reusableSubtitle } from './useSubtitleDownload';
import { FileNode } from '../types';

const file = (name: string): FileNode => ({ name, path: `Bureau/${name}`, type: 'file' });

// What one Subscene id left behind: the episode that was playing when it was
// fetched, and the rest of the season alongside it.
const PACK = {
  node: file('SS_Le-Bureau-des-L-gendes-S01E01_fr1.srt'),
  extras: [
    file('SS_Le-Bureau-des-L-gendes-S01E02_fr1.srt'),
    file('SS_Le-Bureau-des-L-gendes-S01E05_fr1.srt'),
  ],
};

describe('reusableSubtitle', () => {
  it('finds the file that pack left for the episode now playing', () => {
    // Episode 5's list, so episode 5's file - not the one the download was named
    // for. Typing that id again while this episode is open must not offer
    // episode 1's dialogue.
    const available = [file('SS_Le-Bureau-des-L-gendes-S01E05_fr1.srt')];
    expect(reusableSubtitle(PACK, available)?.name)
      .toBe('SS_Le-Bureau-des-L-gendes-S01E05_fr1.srt');
  });

  it('has nothing to offer a video the pack wrote nothing for', () => {
    // An id fetched for one film says nothing about another. Answering here
    // would be a wrong answer given instantly; null sends it down the real
    // download path, which writes a file named for *this* video.
    expect(reusableSubtitle(PACK, [file('OS_Ford-V-Ferrari_1080p_en1.srt')])).toBeNull();
  });

  it('ignores a file the id did not write, however alike the name', () => {
    // Same series, same language, same folder - but it came from OpenSubtitles,
    // so this id has not been paid for yet.
    expect(reusableSubtitle(PACK, [file('OS_Le-Bureau-des-L-gendes-S01E01_fr2.srt')])).toBeNull();
  });

  it('is null for an id this session has not fetched', () => {
    expect(reusableSubtitle(null, [file('SS_Le-Bureau-des-L-gendes-S01E01_fr1.srt')])).toBeNull();
  });

  it('is null once the subtitle is no longer listed for this video', () => {
    // The menus are the one record of what is here. If a file has left them,
    // pointing at it would select something that is not there to stream.
    expect(reusableSubtitle(PACK, [])).toBeNull();
  });
});
