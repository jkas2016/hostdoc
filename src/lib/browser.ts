import { spawn, type ChildProcess } from "node:child_process";

type Opener = { cmd: string; args: (url: string) => string[] };

export function openerCommand(platform: NodeJS.Platform): Opener {
  if (platform === "darwin") return { cmd: "open", args: (u) => [u] };
  if (platform === "win32") return { cmd: "cmd", args: (u) => ["/c", "start", "", u] };
  return { cmd: "xdg-open", args: (u) => [u] };
}

export function openInBrowser(
  url: string,
  opener: Opener = openerCommand(process.platform),
): ChildProcess {
  const child = spawn(opener.cmd, opener.args(url), {
    stdio: "ignore",
    detached: true,
  });
  child.on("error", () => {
    process.stderr.write(
      `Couldn't open a browser automatically. Open this URL manually:\n${url}\n`,
    );
  });
  child.unref();
  return child;
}
