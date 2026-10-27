import { ChildProcess, spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { openInBrowser } from "../src/browser.ts";

vi.mock("node:child_process", async (importOriginal) => {
  const module = await importOriginal<typeof import("node:child_process")>();
  return { ...module, spawn: vi.fn<typeof spawn>() };
});

const platform = process.platform;
const WINDOWS_URLS = [
  "https://example.com/cli?code=abc&calc.exe",
  'https://example.com/cli?code="&calc.exe&"',
  "https://example.com/cli?code=$(calc.exe);'`|%COMSPEC%^&",
];

afterEach(() => {
  Object.defineProperty(process, "platform", { value: platform });
  vi.restoreAllMocks();
  vi.mocked(spawn).mockReset();
});

describe("openInBrowser", () => {
  it.each(WINDOWS_URLS)("passes Windows URL characters as data, outside the command: %s", async (url) => {
    const child = new ChildProcess();
    const unref = vi.spyOn(child, "unref");
    vi.mocked(spawn).mockReturnValue(child);
    Object.defineProperty(process, "platform", { value: "win32" });

    const opened = openInBrowser(url);
    expect(spawn).toHaveBeenCalledWith(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "Start-Process -FilePath $env:SLOPPER_BROWSER_URL"],
      expect.objectContaining({
        shell: false,
        env: expect.objectContaining({ SLOPPER_BROWSER_URL: new URL(url).href }),
      }),
    );
    child.emit("spawn");
    await expect(opened).resolves.toBe(true);
    expect(unref).toHaveBeenCalledOnce();
  });

  it.runIf(platform === "win32").each(WINDOWS_URLS)(
    "preserves the URL through the native Windows PowerShell parser: %s",
    async (url) => {
      const child = new ChildProcess();
      vi.mocked(spawn).mockReturnValue(child);
      const opened = openInBrowser(url);
      child.emit("spawn");
      await expect(opened).resolves.toBe(true);

      const invocation = vi.mocked(spawn).mock.calls.at(-1);
      if (!invocation || invocation[0] !== "powershell.exe" || !Array.isArray(invocation[1])) {
        throw new Error("Expected the fixed PowerShell launcher before running the parser check.");
      }
      const [command, args, options] = invocation;
      const script = args.at(-1);
      if (typeof script !== "string" || !options?.env) throw new Error("Expected the launch script and environment.");

      // Capture the bound target without opening a desktop browser on the runner.
      const capture = "function Start-Process { param([string]$FilePath) [Console]::Write($FilePath) }; ";
      const result = spawnSync(command, [...args.slice(0, -1), capture + script], {
        env: options.env,
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(new URL(url).href);
    },
  );

  it.each(["not a URL", "javascript:alert(1)", "file:///C:/Windows/System32/calc.exe", "--help"])(
    "does not launch non-HTTP(S) targets: %s",
    async (url) => {
      await expect(openInBrowser(url)).resolves.toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["darwin", "open"],
    ["linux", "xdg-open"],
  ])("passes the page as one argument on %s", async (platform, command) => {
    const child = new ChildProcess();
    vi.mocked(spawn).mockReturnValue(child);
    Object.defineProperty(process, "platform", { value: platform });
    const url = "https://example.com/cli?code=abc&other=def";

    const opened = openInBrowser(url);
    expect(spawn).toHaveBeenCalledWith(command, [url], expect.objectContaining({ shell: false }));
    child.emit("spawn");
    await expect(opened).resolves.toBe(true);
  });

  it("returns false when the browser launcher is unavailable", async () => {
    const child = new ChildProcess();
    vi.mocked(spawn).mockReturnValue(child);

    const opened = openInBrowser("https://example.com/cli");
    child.emit("error", new Error("Launcher not installed"));
    await expect(opened).resolves.toBe(false);
  });
});
