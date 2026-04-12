import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../infra/dotenv.js";
import { normalizeEnv } from "../infra/env.js";
import { formatUncaughtError } from "../infra/errors.js";
import { isMainModule } from "../infra/is-main.js";
import { ensureShittimChestCliOnPath } from "../infra/path-env.js";
import { assertSupportedRuntime } from "../infra/runtime-guard.js";
import { installUnhandledRejectionHandler } from "../infra/unhandled-rejections.js";
import { enableConsoleCapture } from "../logging.js";
import { getCommandPath, getPrimaryCommand, hasHelpOrVersion } from "./argv.js";
import { tryRouteCli } from "./route.js";
import { normalizeWindowsArgv } from "./windows-argv.js";

export function rewriteUpdateFlagArgv(argv: string[]): string[] {
  const index = argv.indexOf("--update");
  if (index === -1) {
    return argv;
  }

  const next = [...argv];
  next.splice(index, 1, "update");
  return next;
}

export function shouldRegisterPrimarySubcommand(argv: string[]): boolean {
  return !hasHelpOrVersion(argv);
}

export function shouldSkipPluginCommandRegistration(params: {
  argv: string[];
  primary: string | null;
  hasBuiltinPrimary: boolean;
}): boolean {
  if (params.hasBuiltinPrimary) {
    return true;
  }
  if (!params.primary) {
    return hasHelpOrVersion(params.argv);
  }
  return false;
}

export function shouldEnsureCliPath(argv: string[]): boolean {
  if (hasHelpOrVersion(argv)) {
    return false;
  }
  const [primary, secondary] = getCommandPath(argv, 2);
  if (!primary) {
    return true;
  }
  if (primary === "status" || primary === "health" || primary === "sessions") {
    return false;
  }
  if (primary === "config" && (secondary === "get" || secondary === "unset")) {
    return false;
  }
  if (primary === "models" && (secondary === "list" || secondary === "status")) {
    return false;
  }
  return true;
}

export async function runCli(argv: string[] = process.argv) {
  const normalizedArgv = normalizeWindowsArgv(argv);

  // Fast path: --version prints the version string without loading the full program.
  // This avoids importing the heavy commander tree, plugin registry, and config modules.
  if (normalizedArgv.includes("--version") || normalizedArgv.includes("-V")) {
    const { VERSION } = await import("../version.js");
    console.log(VERSION);
    return;
  }

  loadDotEnv({ quiet: true });
  normalizeEnv();
  if (shouldEnsureCliPath(normalizedArgv)) {
    ensureShittimChestCliOnPath();
  }

  // Enforce the minimum supported runtime before doing any work.
  assertSupportedRuntime();

  if (await tryRouteCli(normalizedArgv)) {
    return;
  }

  // Capture all console output into structured logs while keeping stdout/stderr behavior.
  enableConsoleCapture();

  const { buildProgram } = await import("./program.js");
  const program = buildProgram();

  // Global error handlers to prevent silent crashes from unhandled rejections/exceptions.
  // These log the error and exit gracefully instead of crashing without trace.
  installUnhandledRejectionHandler();

  process.on("uncaughtException", (error) => {
    console.error("[shittimchest] Uncaught exception:", formatUncaughtError(error));
    process.exit(1);
  });

  const parseArgv = rewriteUpdateFlagArgv(normalizedArgv);
  // Register the primary command (builtin or subcli) so help and command parsing
  // are correct even with lazy command registration.
  const primary = getPrimaryCommand(parseArgv);
  if (primary) {
    // Load all command-registration modules in parallel to reduce sequential import latency.
    const [{ getProgramContext }, { registerCoreCliByName }, { registerSubCliByName }] =
      await Promise.all([
        import("./program/program-context.js"),
        import("./program/command-registry.js"),
        import("./program/register.subclis.js"),
      ]);
    const ctx = getProgramContext(program);
    if (ctx) {
      await registerCoreCliByName(program, ctx, primary, parseArgv);
    }
    await registerSubCliByName(program, primary);
  }

  const hasBuiltinPrimary =
    primary !== null && program.commands.some((command) => command.name() === primary);
  const shouldSkipPluginRegistration = shouldSkipPluginCommandRegistration({
    argv: parseArgv,
    primary,
    hasBuiltinPrimary,
  });
  if (!shouldSkipPluginRegistration) {
    // Register plugin CLI commands before parsing — load both modules in parallel.
    const [{ registerPluginCliCommands }, { loadConfig }] = await Promise.all([
      import("../plugins/cli.js"),
      import("../config/config.js"),
    ]);
    registerPluginCliCommands(program, loadConfig());
  }

  await program.parseAsync(parseArgv);
}

export function isCliMainModule(): boolean {
  return isMainModule({ currentFile: fileURLToPath(import.meta.url) });
}
