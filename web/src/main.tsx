import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { reportToServer } from './utils/remoteLog';
import { applyTextScale, readTextScale } from './utils/textScale';
import { normalizeKey } from './utils/keys';
import './index.css';

// The text size this browser was left at, before the first paint.
applyTextScale(readTextScale());

// A strong focus outline once keys are moving focus, gone at the next pointer
// press: :focus-visible is Chrome 86 and the TV is Chromium 47, and an outline
// left on every clicked button would follow the TV's pointer around.
const KEYS_THAT_MOVE_FOCUS = ['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
document.addEventListener('keydown', (e) => {
  if (KEYS_THAT_MOVE_FOCUS.indexOf(normalizeKey(e)) !== -1) document.documentElement.classList.add('keyboard');
}, true);
['mousedown', 'touchstart'].forEach((type) => document.addEventListener(type, () => {
  document.documentElement.classList.remove('keyboard');
}, true));

// Registered before anything renders, so a failure while the app is starting is
// reported too. Inside App it missed those, and went away with the root when a
// render error unmounted it.
window.addEventListener('error', (event) => {
  reportToServer(`Global JS Error: ${event.message} at ${event.filename}:${event.lineno}`);
});
// Chrome 49+, so never on the reference TV - but a phone on the same Wi-Fi has it.
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  reportToServer(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary what="app">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);