import React, { useEffect, useCallback, useRef } from 'react';

// Leading for a wrapped cue.
//
// A native cue is `display: inline`, so the browser paints its background once
// per *line*, not once per cue. That makes the leading visible as a hole between
// the two halves of a two-line subtitle, and the size of that hole is
// `line-height - contentArea`. The two are set by different fonts:
//
//   contentArea  the ascent+descent of the element's *primary* font (sans-serif
//                -> Arial here), about 1.14em whatever the text says;
//   line box     the metrics of whichever *fallback* font actually draws the
//                glyphs, about 1.29em for Devanagari.
//
// So `normal` is not neutral: it leaves ~0.15em of video showing between the
// lines of a Hindi subtitle and nothing at all between the lines of an English
// one, which is exactly why this was reported from a device and could not be
// seen on another. Matching the top overlay's `leading-relaxed` was worse still
// - the overlay is one <div> with one background box, so its leading sits
// *inside* the box, while here 1.625 widened the hole to 0.49em.
//
// 1.2 sits just above the primary font's content area, so consecutive lines'
// backgrounds meet and read as a single block, and it is still tall enough that
// stacked matras and deep conjuncts clear the line below. Checked in both
// scripts at 16px and 36px.
const CUE_LINE_HEIGHT = 1.2;

// How far each subtitle sits from its own edge of the picture, as a fraction of
// the picture's rendered height. A fraction rather than a constant because the
// same build runs in a phone-sized window and full screen on a 1080p TV, where a
// fixed gap is either invisible or a band.
//
// One number for both, so the two read as a matched pair rather than as two
// independently tuned offsets. Of the *picture*, which is not the same as the
// <video> element - see the letterbox note on pictureGeometry. That distinction
// is the whole reason this number was never the thing worth adjusting.
const PICTURE_EDGE_MARGIN = 0.04;

/**
 * Where both subtitles go: the top overlay against the top of the *picture*, and
 * the native bottom cue lifted clear of every overlay in the bottom strip and
 * shifted clear of the subtitle panel, through the ::cue stylesheet in
 * `styleRef`. All of it measured, never constant.
 *
 * The measured refs belong to the player, which renders them; a new overlay in
 * the bottom strip needs its ref added to `writeCueStyle`. Everything after the
 * refs is a recompute trigger as much as a value.
 */
export const useCuePlacement = ({
  videoRef, styleRef, controlBarRef, resumeNoticeRef, upNextRef, subPanelBodyRef,
  bottomFontSize, showControls, filePath, resumedFrom, upNextIn, showSubSettings, isFullscreen,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  styleRef: React.RefObject<HTMLStyleElement>;
  controlBarRef: React.RefObject<HTMLDivElement>;
  resumeNoticeRef: React.RefObject<HTMLDivElement>;
  upNextRef: React.RefObject<HTMLDivElement>;
  subPanelBodyRef: React.RefObject<HTMLDivElement>;
  bottomFontSize: number;
  showControls: boolean;
  filePath: string | null;
  resumedFrom: number | null;
  upNextIn: number | null;
  showSubSettings: boolean;
  isFullscreen: boolean;
}) => {
  // The top subtitle, which is not in that strip but needs the same measurement
  // from the other end. Mutable rather than a plain RefObject because it is set
  // from a ref callback - it only exists while a cue is on screen.
  const topOverlayRef = useRef<HTMLDivElement | null>(null);

  // Where the film is actually drawn, which is not where the <video> element is.
  //
  // The element is `object-contain`, so a film whose shape does not match the
  // window is drawn as a smaller rectangle centred in it, with black above and
  // below. Both subtitles are positioned against the element - Blink lays native
  // cues out that way, and the top overlay is absolutely positioned in a box that
  // matches it - so both were being placed against the edge of the *black*.
  // Measured: a 2.40:1 film in a 366x688 portrait element renders 366x153,
  // leaving a 268px bar, which put the bottom cue 240px below the picture and the
  // top overlay some 228px above it.
  //
  // One helper because it is one measurement; two copies is how the two subtitles
  // end up disagreeing about where the picture is. `known` is false until
  // loadedmetadata, since videoWidth is 0 until then, and for an <audio> element
  // forever - callers fall back to the element's own box, which is the old
  // behaviour.
  const pictureGeometry = useCallback(() => {
    const el = videoRef.current;
    if (!el) return null;

    const box = el.getBoundingClientRect();
    const width = (el as HTMLVideoElement).videoWidth;
    const ratio = width ? (el as HTMLVideoElement).videoHeight / width : 0;
    const height = ratio ? Math.min(box.height, box.width * ratio) : box.height;

    return { box, height, letterbox: (box.height - height) / 2, known: !!ratio };
  }, []);

  // The top overlay is this app's own element, so it is placed by writing `top`
  // rather than by transforming a shadow pseudo-element - but it is the same
  // measurement and was the same bug, upside down.
  //
  // Written through a ref rather than into state, for the reason the rest of this
  // file writes to the DOM directly: MediaPlayer is memoized and this runs on
  // every resize, so a style prop would put it back on the render treadmill.
  //
  // It is a ref *callback* because the overlay is only mounted while a cue is on
  // screen. That is the one moment its position must be set, and doing it here
  // keeps the cue text out of writeCueStyle's dependencies - which would rewrite
  // the ::cue rule, and so invalidate the CSSOM, once per line of dialogue.
  //
  // Geometry that is not known yet leaves `top` alone, so the class's own top-10
  // stands as the fallback.
  const placeTopSubtitle = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const picture = pictureGeometry();
    if (!picture || !picture.known) return;
    node.style.top = `${Math.round(picture.letterbox + picture.height * PICTURE_EDGE_MARGIN)}px`;
  }, [pictureGeometry]);

  const topSubtitleRef = useCallback((node: HTMLDivElement | null) => {
    topOverlayRef.current = node;
    placeTopSubtitle(node);
  }, [placeTopSubtitle]);

  // ::cue cannot be set from an inline style, so it needs a real stylesheet. Mutating
  // the element's text from an effect - rather than re-emitting <style> on render -
  // keeps a font-size change from invalidating the CSSOM on every frame of playback.
  // Deliberately not a CSS custom property: var() needs Chrome 49 and the TVs this
  // targets are Chromium 47.
  // filePath is in the deps because the element itself only exists once there is
  // something to play - before that the player renders nothing and there is
  // nothing to write to. Keyed on the size alone, the rule was written
  // at mount into a null ref and then never again, so the bottom subtitle used
  // the browser's default size until the slider was touched. Invisible while the
  // size was 18px every time; obvious the moment the size is remembered.
  //
  // The second rule is why the bottom subtitle read as broken. The browser draws
  // native cues at the foot of the video, which is exactly where this player
  // stacks everything else, so the subtitle sat *behind* whatever was there -
  // present in the DOM, showing, timed correctly, and unreadable.
  //
  // ::cue cannot move a cue - it styles the box, not its position - so the
  // container is the only handle Blink offers.
  //
  // The lift clears *every* overlay in that strip, not just the control bar.
  // Clearing the bar alone was the first attempt and it moved the subtitle
  // straight underneath the resume notice, which is centred at bottom-24 - the
  // exact band a lifted cue lands in. That notice is on screen for the opening
  // seconds of a resumed film, which is precisely when someone checks whether
  // subtitles work, so the fault looked identical to the one it replaced. Hence
  // the measurement is per-overlay and against the foot of the picture: a
  // constant would have to be re-derived every time one of them changes height,
  // and an overlay added later would silently reintroduce this.
  //
  // The horizontal shift is the same problem lying down. The settings panel
  // covers the right-hand side, and a centred cue runs under it at exactly the
  // moment the user is certainly reading subtitles - they opened the panel to
  // adjust them.
  //
  // An engine that does not know the selector drops this rule alone and behaves
  // exactly as before; ::cue above is a separate rule and is unaffected.
  const writeCueStyle = useCallback(() => {
    if (!styleRef.current) return;

    const picture = pictureGeometry();
    const video = picture ? picture.box : null;
    const foot = video ? video.bottom : 0;
    // A null ref is an overlay that is not rendered at all; `visible` covers the
    // one that is rendered but faded out, since it keeps its layout box.
    const clearance = (node: HTMLElement | null, visible: boolean) =>
      node && visible ? Math.max(0, foot - node.getBoundingClientRect().top) : 0;

    const pictureHeight = picture ? picture.height : 0;
    const letterbox = picture ? picture.letterbox : 0;

    const lift = Math.round(
      Math.max(
        clearance(controlBarRef.current, showControls),
        clearance(resumeNoticeRef.current, showControls),
        clearance(upNextRef.current, true),
        // Not an overlay but the same kind of obstacle: everything below this is
        // not the film. Taking the greater of the two rather than adding them
        // keeps a full-bleed picture behaving exactly as it did.
        letterbox,
      )
      // Always, not only when something is in the way: Blink sits a cue flush on
      // the foot of the picture, which reads as falling off the bottom edge.
      + pictureHeight * PICTURE_EDGE_MARGIN,
    );
    const shift = subPanelBodyRef.current
      ? subPanelBodyRef.current.getBoundingClientRect().width / 2
      : 0;

    // Absolute, and stated twice. A line box is the taller of the cue's own
    // leading and the *strut* of the block it sits in, and that block's font is
    // sized by the browser from the video's height (~27px here), not from the
    // size chosen for subtitles. So a small subtitle keeps the strut's leading
    // and the hole comes back below about 24px - which is the size the setting
    // starts at. Setting it on the display block too pins the strut to the same
    // value; in px so it does not multiply that block's font size instead.
    const leading = Math.round(bottomFontSize * CUE_LINE_HEIGHT * 100) / 100;

    styleRef.current.textContent =
      `video::cue { font-size: ${bottomFontSize}px; line-height: ${leading}px; background-color: rgba(0,0,0,0.75); color: white; border-radius: 4px; }`
      + `\nvideo::-webkit-media-text-track-display { line-height: ${leading}px; }`
      + `\nvideo::-webkit-media-text-track-container { transform: translate(-${shift}px, -${lift}px); transition: transform 300ms; }`;
    // Everything after the first two is a *recompute trigger* rather than a value
    // this reads: each one changes the size or presence of something measured
    // above, so the numbers are wrong until it runs again.
  }, [bottomFontSize, showControls, filePath, resumedFrom, upNextIn, showSubSettings, isFullscreen]);

  useEffect(() => { writeCueStyle(); }, [writeCueStyle]);

  // ...and again whenever the picture itself changes size, which no amount of
  // state can announce. This is what was wrong with the margin: every number
  // above is measured, so all of them go stale the moment the video is laid out
  // differently, and the lift stayed at the value computed for the old size.
  //
  // Fullscreen is the case that bit, and `isFullscreen` above does not cover it:
  // toggleFullscreen sets the state synchronously, so the effect runs before the
  // browser has resized anything, and the fullscreenchange event that follows
  // sets the same value again - so React bails out and it is never recomputed
  // against the size that actually shipped. Measuring on the event, not on the
  // state, is the fix. Rotating a phone is the same failure with no state
  // involved at all.
  //
  // Plain listeners rather than a ResizeObserver: that is Chrome 64 and the
  // reference TV is Chromium 47, and these cover every case that moves the foot
  // of the picture.
  //
  // `loadedmetadata` is in here for the letterbox bar rather than the window:
  // videoWidth is 0 until it fires, so until then the film's shape is unknown
  // and the bar reads as zero. Without it the first cue of every file is placed
  // as though the picture filled the element.
  useEffect(() => {
    // Both subtitles, since both are placed off the same measurement. The top one
    // is only repositioned here and on mount: nothing else about it moves, so it
    // has no business in writeCueStyle's deps.
    const recompute = () => { writeCueStyle(); placeTopSubtitle(topOverlayRef.current); };
    const fsEvents = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
    const media = videoRef.current;

    window.addEventListener('resize', recompute);
    window.addEventListener('orientationchange', recompute);
    fsEvents.forEach(e => document.addEventListener(e, recompute));
    if (media) media.addEventListener('loadedmetadata', recompute);

    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('orientationchange', recompute);
      fsEvents.forEach(e => document.removeEventListener(e, recompute));
      if (media) media.removeEventListener('loadedmetadata', recompute);
    };
  }, [writeCueStyle, placeTopSubtitle]);

  return { topSubtitleRef };
};
