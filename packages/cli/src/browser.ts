import { spawn } from "node:child_process";
import process from "node:process";

/**
 * Opens a page in the default browser. Resolves false when this machine
 * can't (a server, a container, no desktop); callers print the link anyway.
 */
export function openInBrowser(url: string): Promise<boolean> {
  const [command, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}
