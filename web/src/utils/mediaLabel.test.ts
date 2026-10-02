import { describe, it, expect } from 'vitest';
import { labelOf, fullTitleOf, seriesOf, seasonOf, tidyName } from './mediaLabel';
import type { FileNode } from '../types';

const file = (path: string, info?: FileNode['info']): FileNode => ({
  name: path.split('/').pop()!, path, type: 'file', mimeType: 'video/mp4', info,
});

describe('labelOf', () => {
  it('puts what differs between episodes first, and the marker beside it', () => {
    const episode = file('TV Shows/Le Bureau des Légendes/Season 1/Le.Bureau.des.Legendes.S01E02.1080p.mp4',
      { title: 'Le Bureau des Legendes', season: 1, episode: 2, resolution: '1080p' });
    expect(labelOf(episode)).toEqual({
      title: 'Episode 2', marker: 'S01E02', resolution: '1080p', series: 'Le Bureau des Légendes', risk: undefined,
    });
  });

  it('keeps an episode\'s own title', () => {
    const pilot = file('Show/Show.S01E01.Pilot.720p.mp4', { title: 'Show', season: 1, episode: 1, episodeTitle: 'Pilot' });
    expect(labelOf(pilot).title).toBe('Episode 1 · Pilot');
  });

  it('names a film by its title, and leaves out a year its folder already gives', () => {
    const inFolder = file('Movies/Sintel (2010)/Sintel.2010.720p.mp4', { title: 'Sintel', year: 2010, resolution: '720p' });
    expect(labelOf(inFolder)).toMatchObject({ title: 'Sintel', year: undefined, resolution: '720p' });
    const loose = file('Movies/Cosmos.Laundromat.2015.mp4', { title: 'Cosmos Laundromat', year: 2015 });
    expect(labelOf(loose)).toMatchObject({ title: 'Cosmos Laundromat', year: 2015 });
  });

  it('flags what a TV most often refuses', () => {
    expect(labelOf(file('Tears.of.Steel.2012.2160p.HEVC.mp4', { title: 'Tears of Steel', codec: 'h265' })).risk).toBe('HEVC');
    expect(labelOf(file('Film.x265.mp4', { title: 'Film' })).risk).toBe('HEVC');
    expect(labelOf({ ...file('Film.mkv', { title: 'Film' }), mimeType: 'video/x-matroska' }).risk).toBe('MKV');
    expect(labelOf(file('Film.mp4', { title: 'Film' })).risk).toBeUndefined();
  });

  it('gives a song its track number and title', () => {
    expect(labelOf(file('Music/01 - Nocturne.flac', { title: 'Nocturne', track: 1 }))).toMatchObject({ title: 'Nocturne', track: 1 });
  });

  it('tidies a name the server said nothing about', () => {
    expect(labelOf(file('Some.Home_Video.mp4')).title).toBe('Some Home Video');
    expect(tidyName('a.b_c.mp4')).toBe('a b c');
  });
});

describe('seriesOf', () => {
  it('prefers the folder, accents and all, when it names the show', () => {
    expect(seriesOf(file('Le Bureau des Légendes/Le.Bureau.des.Legendes.S01E01.mp4',
      { title: 'Le Bureau des Legendes', season: 1, episode: 1 }))).toBe('Le Bureau des Légendes');
  });

  it('uses the parsed title when the folder is not the show', () => {
    expect(seriesOf(file('TV/Breaking.Bad.S01E01.mkv', { title: 'Breaking Bad', season: 1, episode: 1 }))).toBe('Breaking Bad');
  });

  it('uses the folder when the name is only the episode', () => {
    expect(seriesOf(file('Show/Episode 1.mp4', { title: 'Episode 1', episode: 1 }))).toBe('Show');
    expect(seriesOf(file('Breaking Bad/Season 2/S02E01.mp4', { title: 'S02E01', season: 2, episode: 1 }))).toBe('Breaking Bad');
  });

  it('is nothing for a file that is not an episode', () => {
    expect(seriesOf(file('Films/Sintel.mp4', { title: 'Sintel' }))).toBeUndefined();
  });
});

describe('seasonOf', () => {
  it('reads season folders and nothing else', () => {
    expect(seasonOf('Season 2')).toBe(2);
    expect(seasonOf('S03')).toBe(3);
    expect(seasonOf('Saison 1')).toBe(1);
    expect(seasonOf('Movies')).toBeNull();
    expect(seasonOf('1917')).toBeNull();
  });
});

describe('fullTitleOf', () => {
  it('names an episode by its show and marker, and a film with its year', () => {
    expect(fullTitleOf(file('Le Bureau des Légendes/Le.Bureau.des.Legendes.S01E02.mp4',
      { title: 'Le Bureau des Legendes', season: 1, episode: 2 }))).toBe('Le Bureau des Légendes · S01E02');
    expect(fullTitleOf(file('Movies/Big.Buck.Bunny.2008.mp4', { title: 'Big Buck Bunny', year: 2008 }))).toBe('Big Buck Bunny (2008)');
  });
});
