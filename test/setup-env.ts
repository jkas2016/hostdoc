import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Hermetic config isolation: point XDG_CONFIG_HOME at a fresh empty directory
// so tests never read the developer's real ~/.config/hostdoc/config.json.
// Tests that need a config write one explicitly under this dir.
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "hostdoc-test-xdg-"));
