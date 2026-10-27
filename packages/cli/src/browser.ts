import { spawn } from "node:child_process";
import process from "node:process";

/**
 * Opens a page in the default browser. Resolves false when this machine
 * can't (a server, a container, no desktop); callers print the link anyway.
 */
export function openInBrowser(url: string): Promise<boolean> {
  let page: URL;

  try {
    page = new URL(url);
  } catch {
    return Promise.resolve(false);
  }

  if (page.protocol !== "https:" && page.protocol !== "http:") return Promise.resolve(false);

  const target = page.href;
  // Keep the URL out of shell syntax: PowerShell reads it only as an environment value.
  const [command, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [target]]
      : process.platform === "win32"
        ? [
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", "Start-Process -FilePath $env:SLOPPER_BROWSER_URL"],
          ]
        : ["xdg-open", [target]];

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      detached: true,
      shell: false,
      env: { ...process.env, SLOPPER_BROWSER_URL: target },
    });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}
