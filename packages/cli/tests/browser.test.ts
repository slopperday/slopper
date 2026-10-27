import { ChildProcess, spawn } from "node:child_process";
import process from "node:process";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { openInBrowser } from "../src/browser.ts";

vi.mock("node:child_process", async (importOriginal) => {
  const module = await importOriginal<typeof import("node:child_process")>();
  return { ...module, spawn: vi.fn<typeof spawn>() };
});

const platform = process.platform;

afterEach(() => {
  Object.defineProperty(process, "platform", { value: platform });
  vi.restoreAllMocks();
  vi.mocked(spawn).mockReset();
});

describe("openInBrowser", () => {
  it.each([
    "https://example.com/cli?code=abc&calc.exe",
    'https://example.com/cli?code="&calc.exe&"',
    "https://example.com/cli?code=$(calc.exe);'`|%COMSPEC%^&",
  ])("passes Windows URL characters as data, outside the command: %s", async (url) => {
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
