import React from 'react';
import { cueRuns } from '../../utils/subtitleParser';

/**
 * One cue's text with its italics, bold and underline, as elements. The markup
 * comes from a subtitle file someone downloaded, so it is read by `cueRuns` and
 * never handed to innerHTML.
 */
export const CueText: React.FC<{ text: string }> = ({ text }) => (
  <>
    {cueRuns(text).map((run, i) => {
      const style = `${run.italic ? 'italic ' : ''}${run.bold ? 'font-bold ' : ''}${run.underline ? 'underline' : ''}`.trim();
      return style ? <span key={i} className={style}>{run.text}</span> : <React.Fragment key={i}>{run.text}</React.Fragment>;
    })}
  </>
);
