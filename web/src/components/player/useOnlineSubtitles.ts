import React, { useState, useCallback, useMemo } from 'react';
import { parseSubtitleFileName } from '../../utils/subtitleNaming';
import { useSubtitleDownload, SavedSubtitles, reusableSubtitle } from '../../hooks/useSubtitleDownload';
import { useSubsceneId } from '../../hooks/useSubsceneId';
import { FileNode, SubtitleCandidate } from '../../types';

/**
 * Subtitles from outside the folder: the provider search, the metered download,
 * and the Subscene by-id box - and the glue that puts what they save into the
 * folder listing and, when it is empty, the bottom slot.
 *
 * Called by the player rather than by the panel that shows it: the panel mounts
 * only while open, and what this session has fetched (`takenBefore`) must
 * outlive closing it.
 */
export const useOnlineSubtitles = ({
  filePath, availableSubtitles, filePathRef, fillBottom, onSubtitlesSaved,
}: {
  filePath: string | null;
  availableSubtitles: FileNode[];
  filePathRef: React.MutableRefObject<string | null>;
  fillBottom: (node: FileNode) => boolean;
  onSubtitlesSaved: (nodes: FileNode[]) => void;
}) => {
  // Downloading is one control, not two. Which of the two overlays a subtitle ends
  // up on is a separate decision, made in the Source menus above - a file on disk
  // is not "the top one" until something puts it there.
  const subtitleFinder = useSubtitleDownload(filePath || '');
  const [searchLanguage, setSearchLanguage] = useState('');
  const [showCandidates, setShowCandidates] = useState(false);
  // Subscene has its own setting and takes no part in SUBTITLE_PROVIDERS, so the
  // ID box appears and disappears independently of the search menu above it.
  // Unknown (an older server that does not report it) counts as on: the box then
  // behaves as it did before there was anything to report.
  const subsceneOffered = subtitleFinder.subscene?.ready !== false;

  // Told while typing rather than after a failed fetch. The hook holds both
  // halves of that: the shape, which costs nothing, and whether the site
  // actually has a subtitle at that id, which costs one free lookup.
  const subsceneBox = useSubsceneId(subsceneOffered);

  // What this app has already fetched for this video in the chosen language. The
  // filenames are the record - there is no list kept anywhere - so this is still
  // right after a restart, and a subtitle the user deleted stops counting.
  // (availableSubtitles is already narrowed to this video, so language is the
  // only thing left to ask.)
  const alreadyDownloaded = useMemo(() => availableSubtitles
    .map(node => ({ node, parsed: parseSubtitleFileName(node.name) }))
    .filter(({ parsed }) => parsed !== null && parsed.language === searchLanguage)
    .sort((a, b) => a.parsed!.counter - b.parsed!.counter),
    [availableSubtitles, searchLanguage]);

  // A downloaded subtitle is saved next to the video, so it belongs in the same
  // list as the files that were already there. Splicing it into the folder
  // listing beats refetching the file tree: the tree scan is synchronous and
  // whole-library, and this runs on a TV that is mid-playback.
  //
  // All of it goes up, this video's own along with the rest. A season pack also
  // wrote subtitles for the other episodes here, so episode 6 would not see its
  // own until a reload - and keeping this one back would leave two lists in play,
  // the private one being discarded the moment the folder listing changed, which
  // those very extras cause.
  const applySubtitle = useCallback(({ node, extras }: SavedSubtitles) => {
    onSubtitlesSaved([node, ...extras]);
    // Finished after the user moved to another video. It is saved and listed for
    // the video it was fetched for; filling an empty slot now would put that
    // video's dialogue over this one, with nothing in the menus to say so.
    if (filePath !== filePathRef.current) return;
    // Into the bottom slot if it is empty, never over a choice (see fillBottom).
    fillBottom(node);
  }, [onSubtitlesSaved, fillBottom, filePath, filePathRef]);

  const handleLanguagePick = useCallback((language: string) => {
    setSearchLanguage(language);
    setShowCandidates(false);
  }, []);

  // Take the best match that is not already on disk. Pressing Download again
  // therefore walks down the ranked list rather than paying for the same file
  // twice - which is what "that one is no good, try another" has to mean when
  // every download is metered.
  const handleDownload = useCallback(async () => {
    if (!searchLanguage) return;
    const saved = await subtitleFinder.autoFetch(searchLanguage, alreadyDownloaded.length);
    if (saved) applySubtitle(saved);
  }, [subtitleFinder, applySubtitle, searchLanguage, alreadyDownloaded.length]);

  const handleShowAll = useCallback(async () => {
    setShowCandidates(true);
    await subtitleFinder.list(searchLanguage);
  }, [subtitleFinder, searchLanguage]);

  const handleTakeCandidate = useCallback(async (candidate: SubtitleCandidate) => {
    const saved = await subtitleFinder.take(candidate);
    if (saved) {
      applySubtitle(saved);
      setShowCandidates(false);
    }
  }, [subtitleFinder, applySubtitle]);

  // The id in the box, if this session already fetched it *and* what it wrote is
  // a subtitle for the video playing. Both halves matter: a season pack taken
  // during episode 1 has a file for this episode too, and it is that file - not
  // the one the download was named for - that "already downloaded" means here.
  //
  // Known locally and immediately, so it is the answer even while the site is
  // still being asked about the same id.
  const subsceneReuse = useMemo(
    () => reusableSubtitle(subtitleFinder.takenBefore('subscene', subsceneBox.value.trim()), availableSubtitles),
    [subtitleFinder.takenBefore, subsceneBox.value, availableSubtitles],
  );

  // Subscene has no searchable API, so its half of the feature is the user
  // pasting the id from a page they found themselves.
  const handleSubsceneFetch = useCallback(async () => {
    const id = subsceneBox.value.trim();
    if (!id) return;

    // Already fetched, already on disk: select it and say so instead of fetching
    // the same archive again to write a copy of a file that is already here.
    // What reaches the screen follows the same rule a real download follows -
    // fill an empty slot, never displace a choice the user has made - so the two
    // paths cannot disagree about what a press does to what is playing.
    if (subsceneReuse) {
      const wasEmpty = fillBottom(subsceneReuse);
      subtitleFinder.say(wasEmpty
        ? `Already downloaded this session - showing ${subsceneReuse.name}.`
        : `Already downloaded this session - ${subsceneReuse.name} is in the Source menus.`);
      subsceneBox.setValue('');
      return;
    }

    // The language menu is passed as a fallback, not as an instruction: the id
    // names one specific file on the site, and the site states what language it
    // is. If the two disagree, the file wins and the panel says so.
    const saved = await subtitleFinder.takeRef('subscene', id, searchLanguage || undefined);
    if (saved) {
      applySubtitle(saved);
      subsceneBox.setValue('');
    }
  }, [subtitleFinder, applySubtitle, subsceneBox, searchLanguage, subsceneReuse, fillBottom]);

  return {
    subtitleFinder, subsceneOffered, subsceneBox, subsceneReuse, alreadyDownloaded,
    searchLanguage, handleLanguagePick, showCandidates,
    handleDownload, handleShowAll, handleTakeCandidate, handleSubsceneFetch,
  };
};

export type OnlineSubtitles = ReturnType<typeof useOnlineSubtitles>;
