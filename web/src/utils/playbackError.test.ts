import { describe, it, expect } from 'vitest';
import { describePlaybackError } from './playbackError';

describe('describePlaybackError', () => {
  it('never tells an MP4 to become an MP4', () => {
    const said = describePlaybackError(4, 'Tears.of.Steel.2012.2160p.HEVC.mp4', 'video/mp4');
    expect(said.title).toBe('This MP4 won\'t play in this browser');
    expect(said.detail).toMatch(/HEVC/);
    expect(said.fix).toMatch(/^Re-encoding/);
    expect(`${said.title} ${said.detail} ${said.fix}`).not.toMatch(/to MP4/);
  });

  it('says what is wrong with an MKV, and that MP4 fixes it', () => {
    const said = describePlaybackError(4, 'Film.mkv', 'video/x-matroska');
    expect(said.detail).toMatch(/MKV/);
    expect(said.fix).toMatch(/MP4/);
  });

  it('gives audio advice for audio', () => {
    expect(describePlaybackError(4, 'Song.wma', 'audio/x-ms-wma').fix).toMatch(/MP3/);
    expect(describePlaybackError(4, null, 'audio/ogg').fix).toMatch(/MP3/);
  });

  it('names other containers by their extension', () => {
    expect(describePlaybackError(4, 'Old.avi', 'video/x-msvideo').title).toBe('This AVI file won\'t play in this browser');
  });

  it('keeps the network case about the network', () => {
    const said = describePlaybackError(2, 'Film.mp4', 'video/mp4');
    expect(said.title).toMatch(/connection/);
    expect(said.fix).toMatch(/Wi-Fi/);
  });

  it('has something to say for every code, known or not', () => {
    for (const code of [1, 2, 3, 4, 99, undefined]) {
      expect(describePlaybackError(code, 'x.mp4', 'video/mp4').title.length).toBeGreaterThan(0);
    }
  });
});
