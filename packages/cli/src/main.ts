import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import manifest from "../package.json" with { type: "json" };
import {
  configPath,
  createApi,
  DEFAULT_URL,
  envValue,
  isSystemError,
  readConfig,
  resolveUrl,
  SlopperError,
  usageError,
} from "./client.ts";
import { type Command, COMMANDS, type Context, type Io, type LocalContext } from "./commands.ts";

export type { Io } from "./commands.ts";

const GLOBAL_OPTIONS = {
  token: { type: "string" },
  url: { type: "string" },
  help: { type: "boolean", short: "h" },
} satisfies ParseArgsOptionsConfig;

const GLOBAL_FLAGS = {
  "--token <token>": "API token. Defaults to SLOPPER_TOKEN, then the token saved for this origin.",
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
  const listed = COMMANDS.filter((command) => !command.hidden);
  const width = Math.max(...listed.map((command) => command.name.length));
  return [
    `slopper ${manifest.version}: too much slop? Not enough yet! Throw it at the wall from your terminal. Built for agents.`,
    "",
    "Usage: slopper <command> [flags]",
    "",
    "Commands:",
    ...listed.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`),
    `  ${"help".padEnd(width)}  Help for one command: slopper help launch`,
    "",
    "Global flags:",
    ...flagLines(GLOBAL_FLAGS),
    "",
    "Results print as JSON. Errors go to stderr; the exit code is 1, or 2 for a usage mistake.",
    "Start with `slopper login`, which signs you in from your browser, then `slopper whoami`.",
    "Agents that shouldn't save a token can set SLOPPER_TOKEN instead.",
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

function canonicalName(name: string): string {
  return /^social-(accounts|post|posts|status|edit|cancel)$/.test(name) ? name.replace("social-", "social ") : name;
}

function findCommand(name: string): Command {
  name = canonicalName(name);
  if (name.startsWith("-")) throw usageError(`Put the command first, then its flags: slopper <command> ${name} …`);
  const command = COMMANDS.find((candidate) => candidate.name === name);
  if (!command) throw usageError(`Unknown command “${name}”.`);
  return command;
}

/** Social subcommands are shown together and can be used without a token for help. */
function socialHelp(): string {
  const commands = COMMANDS.filter((command) => command.name.startsWith("social ") && !command.hidden);
  const width = Math.max(...commands.map((command) => command.name.slice(7).length));
  return [
    "Usage: slopper social <command> [flags]",
    "",
    "Social commands:",
    ...commands.map((command) => `  ${command.name.slice(7).padEnd(width)}  ${command.summary}`),
    "",
    "For details: slopper social <command> --help",
    "",
    "Global flags:",
    ...flagLines(GLOBAL_FLAGS),
  ].join("\n");
}

/** Where to look after a usage mistake. */
function helpHint(argv: readonly string[]): string {
  const name =
    argv[0] === "social" && argv[1] && !argv[1].startsWith("-") ? `social ${argv[1]}` : canonicalName(argv[0] ?? "");
  return COMMANDS.some((command) => command.name === name)
    ? `Run \`slopper help ${name}\`.`
    : argv[0] === "social"
      ? "Run `slopper social --help` for social commands."
      : "Run `slopper help` for the commands.";
}

function print(io: Io, result: unknown): void {
  if (result === undefined) return;
  io.stdout(typeof result === "string" ? result : `${JSON.stringify(result, null, 2)}\n`);
}

/** Settles which site and token to use: flags, then the environment, then what `slopper login` saved. */
async function siteContext(local: LocalContext): Promise<Context> {
  const { values, io, configFile } = local;
  const saved = await readConfig(configFile);
  const flag = (key: "token" | "url") => (typeof values[key] === "string" ? values[key] : undefined);
  const url = resolveUrl(flag("url") ?? envValue(io.env, "SLOPPER_URL") ?? saved.url ?? DEFAULT_URL);
  const userAgent = `slopper-cli/${manifest.version}`;
  const connect = (token: string | undefined) => createApi({ url, token, fetch: io.fetch, userAgent });
  // A destination override must never carry credentials saved for a different origin.
  const token =
    flag("token") ??
    envValue(io.env, "SLOPPER_TOKEN") ??
    (saved.url !== undefined && resolveUrl(saved.url) === url ? saved.token : undefined);
  return { ...local, url, userAgent, api: connect(token), connect };
}

async function run(argv: string[], io: Io): Promise<void> {
  const [name, ...rest] = argv;
  if (name === undefined || name === "help" || name === "--help" || name === "-h") {
    if (rest[0] === "social" && !rest[1]) print(io, `${socialHelp()}\n`);
    else {
      const commandName = rest[0] === "social" ? `social ${rest[1]}` : rest[0];
      print(io, `${commandName ? commandHelp(findCommand(commandName)) : overview()}\n`);
    }
    return;
  }
  if (name === "--version" || name === "-v") {
    print(io, `${manifest.version}\n`);
    return;
  }

  let commandName = name;
  let commandArgs = rest;
  if (name === "social") {
    const [subcommand, ...args] = rest;
    if (!subcommand || subcommand === "--help" || subcommand === "-h" || (subcommand === "help" && !args[0])) {
      print(io, `${socialHelp()}\n`);
      return;
    }
    if (subcommand === "help") {
      print(io, `${commandHelp(findCommand(`social ${args[0]}`))}\n`);
      return;
    }
    commandName = `social ${subcommand}`;
    commandArgs = args;
  }
  const command = findCommand(commandName);
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: commandArgs,
      options: { ...GLOBAL_OPTIONS, ...command.options },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    throw usageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (values.help === true) {
    print(io, `${commandHelp(command)}\n`);
    return;
  }
  // A stray word is a mistake, not something to drop: `post tiltmaze "Fixed it"` forgot --body.
  const extra = positionals[command.args?.split(" ").length ?? 0];
  if (extra !== undefined) throw usageError(`Unexpected “${extra}”. Usage: ${usage(command)}`);

  const local: LocalContext = { values, positionals, io, configFile: configPath(io.env, io.home) };
  print(io, command.local ? await command.run(local) : await command.run(await siteContext(local)));
}

/** Runs one command line and returns the exit code: 0, 1 for a failure, 2 for a usage mistake. */
export async function main(argv: string[], io: Io): Promise<number> {
  try {
    await run(argv, io);
    return 0;
  } catch (error) {
    // A config or file nobody can read or write: say which, without a stack trace.
    if (isSystemError(error)) {
      io.stderr(`slopper: ${error.message}\n`);
      return 1;
    }
    if (!(error instanceof SlopperError)) throw error;
    const details = error.details
      ? Object.entries(error.details).map(([field, problem]) => `\n  ${field}: ${problem}`)
      : [];
    const hint = error.exitCode === 2 ? `\n${helpHint(argv)}` : "";
    io.stderr(`slopper: ${error.message}${details.join("")}${hint}\n`);
    return error.exitCode;
  }
}
