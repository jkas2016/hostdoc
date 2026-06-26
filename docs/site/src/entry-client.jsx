import { hydrateRoot } from 'react-dom/client';
import './ds/styles.css';
import { App } from './App.jsx';

// The page is prerendered to static HTML at build time; hydrate it so the
// interactive bits (tabs, scroll-spy, copy buttons) come alive on the client.
hydrateRoot(document.getElementById('root'), <App />);
