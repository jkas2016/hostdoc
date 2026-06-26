import { DocsShell } from './shell/DocsShell.jsx';
import { GuidePage, GUIDE_SECTIONS } from './pages/GuidePage.jsx';

// Root of the docs site. Each docs page is a <DocsShell sections=…><PageBody/></DocsShell>;
// add future pages (changelog, migration guides) the same way, reusing the shell + components.
export function App() {
  return (
    <DocsShell sections={GUIDE_SECTIONS}>
      <GuidePage />
    </DocsShell>
  );
}
