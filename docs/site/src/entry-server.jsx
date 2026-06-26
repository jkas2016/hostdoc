import { renderToString } from 'react-dom/server';
import { App } from './App.jsx';

// Build-time render. prerender.mjs calls this and injects the result into the
// client HTML template, so the deployed page ships real markup (not a blank root).
export function render() {
  return renderToString(<App />);
}
