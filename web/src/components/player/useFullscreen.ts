import React, { useState, useEffect, useCallback } from 'react';
import { fullscreenElement } from '../../utils/media';

/**
 * Fullscreen for the player's container, with the state kept in step with
 * however fullscreen was left. Each prefix is tried in turn: Chromium 47 has only
 * the webkit ones (see `fullscreenElement`).
 */
export const useFullscreen = (
  containerRef: React.RefObject<HTMLDivElement>,
  videoRef: React.RefObject<HTMLVideoElement>,
) => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(() => {
    if (!fullscreenElement()) {
      const elem = containerRef.current as any;
      if (elem.requestFullscreen) {
        elem.requestFullscreen();
      } else if (elem.webkitRequestFullscreen) { /* Safari */
        elem.webkitRequestFullscreen();
      } else if (elem.msRequestFullscreen) { /* IE11 */
        elem.msRequestFullscreen();
      } else if (elem.mozRequestFullScreen) { /* Firefox */
        elem.mozRequestFullScreen();
      } else if (videoRef.current && (videoRef.current as any).webkitEnterFullscreen) {
        // Fallback for iOS video element
        (videoRef.current as any).webkitEnterFullscreen();
      }
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      } else if ((document as any).mozCancelFullScreen) {
        (document as any).mozCancelFullScreen();
      } else if ((document as any).msExitFullscreen) {
        (document as any).msExitFullscreen();
      }
      setIsFullscreen(false);
    }
  }, []);

  // Leaving fullscreen via Esc or the TV's own back button never went through
  // toggleFullscreen, so the icon used to get stuck showing "exit".
  useEffect(() => {
    const sync = () => setIsFullscreen(!!fullscreenElement());
    const events = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
    events.forEach(evt => document.addEventListener(evt, sync));
    return () => events.forEach(evt => document.removeEventListener(evt, sync));
  }, []);

  return { isFullscreen, toggleFullscreen };
};
