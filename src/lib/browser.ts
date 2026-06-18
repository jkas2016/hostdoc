import { spawn } from "node:child_process";

export function openerCommand(platform: NodeJS.Platform): {
  cmd: string;
  args: (url: string) => string[];
} {
  if (platform === "darwin") return { cmd: "open", args: (u) => [u] };
  if (platform === "win32") return { cmd: "cmd", args: (u) => ["/c", "start", "", u] };
  return { cmd: "xdg-open", args: (u) => [u] };
}

export function openInBrowser(url: string): void {
  const { cmd, args } = openerCommand(process.platform);
  spawn(cmd, args(url), { stdio: "ignore", detached: true }).unref();
}
