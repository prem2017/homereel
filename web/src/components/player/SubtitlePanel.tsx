import React from 'react';
import { Loader2 } from 'lucide-react';
import { SubsceneIdState } from '../../hooks/useSubsceneId';
import { OFFSET_STEP, useSubtitleSlots } from './useSubtitleSlots';
import { OnlineSubtitles } from './useOnlineSubtitles';

/**
 * How the by-id box looks and what it says, per state.
 *
 * A table because there are eight of them and the alternative is a ladder of
 * ternaries in the middle of the panel. `say` is the fallback - the server's own
 * words replace it wherever there are any, since only it knows the film's title
 * or which line of .env is wrong.
 *
 * No `gap-*` and no `focus-visible:` anywhere near this: Chromium 47.
 */
type SubsceneLook = { border: string; text: string; invalid: boolean; say: string };

const SUBSCENE_LOOK: Record<SubsceneIdState, SubsceneLook> = {
  empty: { border: 'border-gray-700 focus:border-blue-500', text: 'text-gray-400', invalid: false, say: 'The number at the end of the subtitle\'s page URL. The language comes with it.' },
  bad: { border: 'border-red-500', text: 'text-red-400', invalid: true, say: 'Just the number from the end of the page URL, nothing else.' },
  short: { border: 'border-red-500', text: 'text-red-400', invalid: true, say: 'Keep typing - an ID is about seven digits.' },
  checking: { border: 'border-amber-400', text: 'text-amber-400', invalid: false, say: 'Checking that ID…' },
  good: { border: 'border-green-500', text: 'text-green-400', invalid: false, say: 'Found it. Press Get.' },
  missing: { border: 'border-red-500', text: 'text-red-400', invalid: true, say: 'No subtitle to download at that ID.' },
  unreachable: { border: 'border-amber-400', text: 'text-amber-400', invalid: false, say: 'That address is not answering. Set a working one as SUBSCENE_URL in .env and restart.' },
  unchecked: { border: 'border-amber-400', text: 'text-amber-400', invalid: false, say: 'Could not check that ID - Get will try anyway.' },
  off: { border: 'border-gray-700', text: 'text-amber-400', invalid: false, say: 'Set SUBSCENE_URL in .env to a working Subscene address and restart.' },
};

// The states Get is offered in: verified, or unverified for a reason that is not
// about the id. A check that could not run is not a verdict and must not take a
// working button with it, and an address that was down a second ago is worth one
// press to retry - it fails with this same explanation if it is still down.
const CAN_FETCH: SubsceneIdState[] = ['good', 'unchecked', 'unreachable'];

// Not one of the box's states: the id is well-formed and the site would answer
// for it perfectly well. This is a fact about the session that outranks that
// answer, because the file the answer would produce is already on the disk. It
// needs no `invalid` - it is the one green that means "and you need not press".
const REUSE_LOOK = { border: 'border-green-500', text: 'text-green-400' };

const formatOffset = (value: number) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}s`;

/**
 * Sync buttons for one subtitle slot.
 *
 * Sits directly under the Source menu it shifts, so with only one subtitle on
 * screen there is only one of these - the two-slot version of this control is
 * only paid for when both slots are in use.
 *
 * The readout doubles as the reset, which keeps a remote to three stops instead
 * of four. "Earlier"/"later" rather than -/+ because the sign is meaningless
 * until you have worked out which way it goes.
 */
const SyncRow: React.FC<{ offset: number; onNudge: (delta: number) => void }> = ({ offset, onNudge }) => {
  const button = 'text-xs px-2 py-1 rounded border border-gray-700 text-gray-300 hover:bg-gray-800 focus:outline-none focus:bg-blue-700 focus:text-white disabled:opacity-40';

  return (
    <div className="flex items-center space-x-1 mt-1">
      <span className="text-xs text-gray-500 mr-1">Sync</span>
      <button type="button" className={button} title="Show subtitles earlier" onClick={() => onNudge(-OFFSET_STEP)}>
        ◀
      </button>
      <button
        type="button"
        className={`${button} font-mono w-16`}
        title={offset === 0 ? 'In sync' : 'Reset to 0.0s'}
        disabled={offset === 0}
        onClick={() => onNudge(0)}
      >
        {formatOffset(offset)}
      </button>
      <button type="button" className={button} title="Show subtitles later" onClick={() => onNudge(OFFSET_STEP)}>
        ▶
      </button>
    </div>
  );
};

interface SubtitlePanelProps {
  /** The panel body, which the bottom cue is shifted clear of (useCuePlacement). */
  bodyRef: React.RefObject<HTMLDivElement>;
  slots: ReturnType<typeof useSubtitleSlots>;
  online: OnlineSubtitles;
  topFontSize: number;
  onTopFontSize: (size: number) => void;
  bottomFontSize: number;
  onBottomFontSize: (size: number) => void;
}

/**
 * The subtitle settings: sizes, what each slot shows and its sync, and the online
 * sources. Mounted only while open; what it shows lives in the hooks above.
 */
export const SubtitlePanel: React.FC<SubtitlePanelProps> = ({
  bodyRef, slots, online,
  topFontSize, onTopFontSize: setTopFontSize, bottomFontSize, onBottomFontSize: setBottomFontSize,
}) => {
  const { availableSubtitles, topSubtitle, bottomSubtitle, topOffset, bottomOffset, nudgeOffset, chooseSubtitle } = slots;
  const {
    subtitleFinder, subsceneOffered, subsceneBox, subsceneReuse, alreadyDownloaded,
    searchLanguage, handleLanguagePick, showCandidates,
    handleDownload, handleShowAll, handleTakeCandidate, handleSubsceneFetch,
  } = online;

  // What the box looks like and what the line under it says. The reuse case is
  // put first deliberately: it is a stronger statement than any verdict the site
  // can give about the same id, and it is true while that verdict is pending.
  const subsceneLook = subsceneReuse ? REUSE_LOOK : SUBSCENE_LOOK[subsceneBox.state];
  const subsceneSaid = subsceneReuse
    ? `Already downloaded this session - ${subsceneReuse.name}. Use it selects that file, nothing is fetched again.`
    : (subsceneBox.state === 'off' ? subtitleFinder.subscene?.reason : subsceneBox.detail)
      || SUBSCENE_LOOK[subsceneBox.state].say;

  return (
    <div
      ref={bodyRef}
      className="absolute bottom-full right-0 mb-10 bg-gray-900/95 backdrop-blur rounded-lg p-4 w-72 max-w-[90vw] max-h-[60vh] overflow-y-auto shadow-2xl border border-gray-700 text-left"
      onClick={(e) => e.stopPropagation()}
    >
      <h3 className="text-sm font-bold text-gray-400 mb-3 border-b border-gray-700 pb-1">Subtitles</h3>

      {/* Font Size Controls */}
      <div className="mb-4 space-y-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1 flex justify-between">
            <span>Top Font Size</span>
            <span className="font-mono">{topFontSize}px</span>
          </label>
          <input
            type="range" min="12" max="48" step="2" value={topFontSize}
            onChange={(e) => setTopFontSize(parseInt(e.target.value))}
            className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1 flex justify-between">
            <span>Bottom Font Size</span>
            <span className="font-mono">{bottomFontSize}px</span>
          </label>
          <input
            type="range" min="12" max="48" step="2" value={bottomFontSize}
            onChange={(e) => setBottomFontSize(parseInt(e.target.value))}
            className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
          />
        </div>
      </div>

      <hr className="border-gray-700 mb-4" />

      {/* Top Subtitle Selection */}
      <div className="mb-2">
        <label className="text-xs text-blue-300 block mb-1">Top Source</label>
        <select
          className="w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-blue-500 outline-none"
          value={topSubtitle?.path || ''}
          onChange={(e) => chooseSubtitle('top', availableSubtitles.find(s => s.path === e.target.value) || null)}
        >
          <option value="">Off</option>
          {availableSubtitles.map(sub => (
            <option key={'top-' + sub.path} value={sub.path}>{sub.name}</option>
          ))}
        </select>
        {topSubtitle && <SyncRow offset={topOffset} onNudge={(d) => nudgeOffset('top', d)} />}
      </div>


      {/* Bottom Subtitle Selection */}
      <div className="mb-4">
        <label className="text-xs text-blue-300 block mb-1">Bottom Source</label>
        <select
          className="w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-blue-500 outline-none"
          value={bottomSubtitle?.path || ''}
          onChange={(e) => chooseSubtitle('bottom', availableSubtitles.find(s => s.path === e.target.value) || null)}
        >
          <option value="">Off</option>
          {availableSubtitles.map(sub => (
            <option key={'bottom-' + sub.path} value={sub.path}>{sub.name}</option>
          ))}
        </select>
        {bottomSubtitle && <SyncRow offset={bottomOffset} onNudge={(d) => nudgeOffset('bottom', d)} />}
      </div>

      {/* Online subtitles. Hidden entirely when nothing at all is
          configured - an empty menu that can never return anything is
          worse than no menu, and local subtitle files still work without
          any of this. The two halves come and go independently: the
          search menu belongs to SUBTITLE_PROVIDERS, the ID box below to
          SUBSCENE_URL, and neither setting has anything to say about the
          other. */}
      {(subtitleFinder.ready || subsceneOffered) && (
        <>
          <hr className="border-gray-700 mb-4" />

          {subtitleFinder.ready && (
          <div className="mb-2">
            <label className="text-xs text-blue-300 block mb-1">Get subtitles</label>
            <select
              className="w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-blue-500 outline-none mb-2"
              value={searchLanguage}
              disabled={subtitleFinder.busy !== 'idle'}
              onChange={(e) => handleLanguagePick(e.target.value)}
            >
              <option value="">Choose a language</option>
              {subtitleFinder.languages.map(lang => (
                <option key={'lang-' + lang.code} value={lang.code}>{lang.name}</option>
              ))}
            </select>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                disabled={!searchLanguage || subtitleFinder.busy !== 'idle'}
                onClick={handleDownload}
                className="flex-1 text-xs px-2 py-2 rounded bg-blue-700 text-white hover:bg-blue-600 focus:outline-none focus:bg-blue-500 disabled:opacity-40"
              >
                {alreadyDownloaded.length > 0 ? 'Download another' : 'Download'}
              </button>
              <button
                type="button"
                disabled={!searchLanguage || subtitleFinder.busy !== 'idle'}
                onClick={handleShowAll}
                className="text-xs px-2 py-2 rounded border border-gray-700 text-gray-300 hover:bg-gray-800 focus:outline-none focus:bg-blue-700 focus:text-white disabled:opacity-40"
              >
                More
              </button>
            </div>
          </div>
          )}

          {/* Subscene: an id typed in by hand, because the site cannot be
              searched from here. Its own control with its own setting, so
              it is here whether or not anything above it is - and it stays
              on screen, disabled with a reason, rather than vanishing when
              SUBSCENE_URL is blank. There is nothing to sign up for. */}
          <div className="mb-3">
            <label className="text-xs text-gray-400 block mb-1" htmlFor="subscene-id">
              Subscene ID
              {subtitleFinder.subscene?.site && (
                <span className="text-gray-500"> · {subtitleFinder.subscene.site}</span>
              )}
            </label>
            <div className="flex items-center space-x-2">
              <input
                id="subscene-id"
                type="text"
                inputMode="numeric"
                placeholder="e.g. 3358444"
                value={subsceneBox.value}
                aria-invalid={!subsceneReuse && SUBSCENE_LOOK[subsceneBox.state].invalid}
                disabled={subsceneBox.state === 'off' || subtitleFinder.busy !== 'idle'}
                onChange={(e) => subsceneBox.setValue(e.target.value)}
                className={`flex-1 min-w-0 bg-gray-800 text-white text-xs p-2 rounded border outline-none ${subsceneLook.border}`}
              />
              {/* Blue like Download above, because it does the same kind of
                  thing. It read as permanently disabled while it was the
                  only outline button in the panel. */}
              {/* A file already here needs no verdict from the site, so
                  this is offered while the check is still running - and
                  says what it will do, since it no longer downloads. */}
              <button
                type="button"
                disabled={subtitleFinder.busy !== 'idle'
                  || (!subsceneReuse && CAN_FETCH.indexOf(subsceneBox.state) === -1)}
                onClick={handleSubsceneFetch}
                className="text-xs px-3 py-2 rounded bg-blue-700 text-white hover:bg-blue-600 focus:outline-none focus:bg-blue-500 disabled:opacity-40"
              >
                {subsceneReuse ? 'Use it' : 'Get'}
              </button>
            </div>
            <div className={`text-xs mt-1 break-words ${subsceneLook.text}`}>
              {subsceneSaid}
            </div>
          </div>

          {/* What is already here, so "Download another" is a decision rather
              than a surprise - each one of these cost a download. Listed and
              not clickable on purpose: the Source menus above are the one
              place a subtitle gets put on screen. */}
          {searchLanguage && alreadyDownloaded.length > 0 && (
            <div className="text-xs text-gray-400 mb-3">
              <div className="mb-1">
                Already downloaded ({alreadyDownloaded.length}):
              </div>
              <ul className="space-y-1">
                {alreadyDownloaded.map(({ node }) => (
                  <li key={node.path} className="text-gray-500 truncate">{node.name}</li>
                ))}
              </ul>
            </div>
          )}

          {subtitleFinder.busy !== 'idle' && (
            <div className="text-xs text-gray-300 flex items-center space-x-2 mb-2">
              <Loader2 size={12} className="animate-spin" />
              <span>{subtitleFinder.busy === 'searching' ? 'Searching…' : 'Downloading…'}</span>
            </div>
          )}

          {/* A source being down is temporary and self-explanatory, so it
              fades; a failed download is something the user must act on,
              so it stays. */}
          {subtitleFinder.notice && (
            <div className="text-xs text-amber-300 mb-2">{subtitleFinder.notice}</div>
          )}
          {subtitleFinder.error && (
            <div className="text-xs text-red-400 mb-2">{subtitleFinder.error}</div>
          )}

          {/* Free accounts get a handful of downloads a day, so "try
              another one" needs to be a decision, not a surprise. */}
          {subtitleFinder.quota && (
            <div className="text-xs text-gray-500 mb-2">
              {subtitleFinder.quota.remaining} download{subtitleFinder.quota.remaining === 1 ? '' : 's'} left today
              {subtitleFinder.quota.key && ` on ${subtitleFinder.quota.key}`}
            </div>
          )}

          {/* Real buttons, so the whole list is reachable from a remote. */}
          {showCandidates && subtitleFinder.candidates.length > 0 && (
            <div className="border-t border-gray-700 pt-2">
              <div className="text-xs text-gray-400 mb-1">
                Pick one to download
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {subtitleFinder.candidates.map(candidate => (
                  <button
                    key={candidate.provider + '-' + candidate.ref}
                    type="button"
                    onClick={() => handleTakeCandidate(candidate)}
                    disabled={subtitleFinder.busy !== 'idle'}
                    className="w-full text-left text-xs p-2 rounded text-gray-300 hover:bg-gray-800 focus:outline-none focus:bg-blue-700 focus:text-white disabled:opacity-40"
                  >
                    <span className="block truncate">
                      {candidate.release || candidate.fileName || 'Untitled'}
                    </span>
                    <span className="block text-gray-500 truncate">
                      {candidate.provider}
                      {candidate.tier === 0 && ' · matches this exact file'}
                      {candidate.tier === 1 && ' · matches this release'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {availableSubtitles.length === 0 && subtitleFinder.busy === 'idle' && (
        <div className="text-xs text-gray-500 italic mt-2">
          {subtitleFinder.ready
            ? 'No subtitle files in this folder. Pick a language above to search online.'
            : 'No subtitle files found in video folder.'}
        </div>
      )}
    </div>
  );
};
