import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import manifest from "../package.json" with { type: "json" };
import { configPath, createApi, DEFAULT_URL, readConfig, resolveUrl, SlopperError, usageError } from "./client.ts";
import { type Command, COMMANDS, type Io } from "./commands.ts";

export type { Io } from "./commands.ts";

const GLOBAL_OPTIONS = {
  token: { type: "string" },
  url: { type: "string" },
  help: { type: "boolean", short: "h" },
} satisfies ParseArgsOptionsConfig;

const GLOBAL_FLAGS = {
  "--token <token>": "API token. Defaults to SLOPPER_TOKEN, then the one `slopper login` saved.",
  "--url <url>": `Site to talk to. Defaults to SLOPPER_URL, then the saved one, then ${DEFAULT_URL}.`,
  "-h, --help": "Help for a command.",
};

function flagLines(flags: Record<string, string>): string[] {
  const width = Math.max(...Object.keys(flags).map((flag) => flag.length));
  return Object.entries(flags).map(([flag, description]) => `  ${flag.padEnd(width)}  ${description}`);
}

function usage(command: Command): string {
  return `slopper ${command.name}${command.args ? ` ${command.args}` : ""}${command.flags ? " [flags]" : ""}`;
}

function overview(): string {
  const width = Math.max(...COMMANDS.map((command) => command.name.length));
  return [
    `slopper ${manifest.version}: throw slop at the wall, from your terminal. Built for agents.`,
    "",
    "Usage: slopper <command> [flags]",
    "",
    "Commands:",
    ...COMMANDS.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`),
    `  ${"help".padEnd(width)}  Help for one command: slopper help launch`,
    "",
    "Global flags:",
    ...flagLines(GLOBAL_FLAGS),
    "",
    "Results print as JSON. Errors go to stderr; the exit code is 1, or 2 for a usage mistake.",
    `Start with \`slopper login\` (tokens live at ${DEFAULT_URL}/settings/api), then \`slopper whoami\`.`,
  ].join("\n");
}

function commandHelp(command: Command): string {
  return [
    `Usage: ${usage(command)}`,
    "",
    command.summary,
    ...(command.flags ? ["", "Flags:", ...flagLines(command.flags)] : []),
    "",
    "Global flags:",
    ...flagLines(GLOBAL_FLAGS),
  ].join("\n");
}

function findCommand(name: string): Command {
  const command = COMMANDS.find((candidate) => candidate.name === name);
  if (!command) throw usageError(`Unknown command “${name}”. Run \`slopper help\` for the list.`);
  return command;
}

function print(io: Io, result: unknown): void {
  if (result === undefined) return;
  io.stdout(typeof result === "string" ? result : `${JSON.stringify(result, null, 2)}\n`);
}

async function run(argv: string[], io: Io): Promise<void> {
  const [name, ...rest] = argv;
  if (name === undefined || name === "help" || name === "--help" || name === "-h") {
    print(io, `${rest[0] ? commandHelp(findCommand(rest[0])) : overview()}\n`);
    return;
  }
  if (name === "--version" || name === "-v") {
    print(io, `${manifest.version}\n`);
    return;
  }

  const command = findCommand(name);
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: rest,
      options: { ...GLOBAL_OPTIONS, ...command.options },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    throw usageError(`${error instanceof Error ? error.message : String(error)}\nRun \`slopper help ${name}\`.`);
  }
  const { values, positionals } = parsed;
  if (values.help === true) {
    print(io, `${commandHelp(command)}\n`);
    return;
  }

  const configFile = configPath(io.env, io.home);
  const saved = await readConfig(configFile);
  const flag = (key: "token" | "url") => (typeof values[key] === "string" ? values[key] : undefined);
  const url = resolveUrl(flag("url") ?? io.env.SLOPPER_URL ?? saved.url ?? DEFAULT_URL);
  const connect = (token: string | undefined) =>
    createApi({ url, token, fetch: io.fetch, userAgent: `slopper-cli/${manifest.version}` });
  const token = flag("token") ?? io.env.SLOPPER_TOKEN ?? saved.token;
  const result = await command.run({
    values,
    positionals,
    io,
    url,
    configFile,
    saved,
    api: connect(token),
    connect,
  });
  print(io, result);
}

/** Runs one command line and returns the exit code: 0, 1 for a failure, 2 for a usage mistake. */
export async function main(argv: string[], io: Io): Promise<number> {
  try {
    await run(argv, io);
    return 0;
  } catch (error) {
    if (!(error instanceof SlopperError)) throw error;
    const details = error.details
      ? Object.entries(error.details).map(([field, problem]) => `\n  ${field}: ${problem}`)
      : [];
    io.stderr(`slopper: ${error.message}${details.join("")}\n`);
    return error.exitCode;
  }
}
