/**
 * Seconds as a clock: "4:05", "1:02:03".
 *
 * `--:--` for anything that is not a real length. Browsers report an infinite
 * duration for a WebM or MKV that carries no duration field, and NaN before the
 * metadata is in; both used to print "NaN:NaN" beside the seek bar.
 */
export const formatTime = (seconds: number): string => {
  if (!isFinite(seconds)) return '--:--';
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const secs = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
};
