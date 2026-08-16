/**
 * Draft transport that runs on the Claude subscription instead of API credits.
 *
 * WHY THIS EXISTS: the Messages API bills per token against a separate API
 * balance. A Claude Max seat is already paid for, and the Claude Code CLI
 * authenticates against it, so driving the CLI in headless mode (`claude -p`)
 * gets the same model without a second bill. This is a supported, documented
 * mode of the CLI, not a workaround.
 *
 * TRAPS THIS FILE EXISTS TO AVOID — each one was hit or nearly hit while wiring
 * it up, and each is silent rather than loud:
 *
 *   1. `--bare` looks made for this (it strips hooks, memory, plugin sync) but
 *      the flag documents that Anthropic auth becomes "strictly ANTHROPIC_API_KEY
 *      or apiKeyHelper; OAuth and keychain are never read". Passing it would send
 *      us straight back to needing the API key this file exists to avoid.
 *
 *   2. The default run carries the whole Claude Code harness — measured here at
 *      12,479 cache-creation + 21,158 cache-read tokens to answer "say PONG".
 *      Every one of those counts against the subscription's rate limit. Stripping
 *      the tools and the system prompt takes the same call to 859. That is the
 *      difference between a sweep every 30 min being free and it eating the
 *      five-hour window.
 *
 *   3. CLAUDE.md is auto-discovered and appended to the system prompt. This
 *      user's global CLAUDE.md mandates ASD-STE100 Simplified Technical English —
 *      short declarative sentences, no contractions, no idiom. That is the exact
 *      opposite of a Reddit comment that has to pass as human, and it would have
 *      applied invisibly to every draft. `--safe-mode` plus an explicit
 *      `--system-prompt` is what keeps it out.
 *
 *   4. Passing JSON through a shell mangles it. cmd.exe and PowerShell both
 *      rewrite quotes inside native-exe arguments, and `--json-schema` fails to
 *      parse. Spawning the .exe directly with an argv array skips every shell.
 *      For the same reason the prompt goes over stdin: thread text is arbitrary
 *      user input containing quotes, newlines, backticks and percent signs, and
 *      no amount of escaping makes that safe on a command line.
 *
 * Cost vs the API path: slower (~8s per draft against ~3s) because the CLI boots
 * a process each time. At a handful of drafts per sweep that is irrelevant, and
 * it is the cheaper trade when the alternative is a second invoice.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/** Per-draft ceiling. Measured ~8s; this only catches a hung process. */
const TIMEOUT_MS = 90_000;

const EXE = process.platform === 'win32' ? 'claude.exe' : 'claude';

/**
 * Locate the CLI without trusting PATH.
 *
 * Task Scheduler does not necessarily hand the job the same PATH an interactive
 * shell gets, and the npm global bin is a common casualty. A monitor that
 * silently stops drafting because a scheduled run could not find a binary that
 * works fine when tested by hand is exactly the failure this project keeps
 * hitting, so the known install locations are checked explicitly and PATH is the
 * last resort rather than the first.
 */
function candidatePaths(): string[] {
  const home = os.homedir();
  const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');

  const out = [
    process.env.CLAUDE_CLI_PATH,
    path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', EXE),
    path.join(home, '.local', 'bin', EXE),
    path.join(localAppData, 'Programs', 'claude-code', EXE),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ].filter((p): p is string => Boolean(p));

  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir.trim()) out.push(path.join(dir.trim(), EXE));
  }
  return out;
}

let cached: string | null | undefined;

/** Absolute path to the CLI, or null when it is not installed. Result is cached. */
export function resolveClaudeCli(): string | null {
  if (cached !== undefined) return cached;
  cached = candidatePaths().find((p) => fs.existsSync(p)) ?? null;
  return cached;
}

/** Test seam — lets a test force the resolver's answer without touching disk. */
export function __setClaudeCliForTests(p: string | null | undefined): void {
  cached = p;
}

/**
 * Flags that make a CLI run behave like a plain model call.
 *
 * Exported so a test can assert the safety-critical ones are still present. Three
 * of these are load-bearing rather than tidiness: `--tools ""` and
 * `--system-prompt` strip the harness that would otherwise burn ~33k tokens of
 * rate limit per draft, and `--safe-mode` is what keeps the user's ASD-STE100
 * CLAUDE.md from rewriting every Reddit comment into technical-manual prose.
 */
export function cliArgs(model: string, effort: string, systemPrompt: string, schema: unknown): string[] {
  return [
    '-p',
    '--output-format', 'json',
    '--model', model,
    '--effort', effort,
    // No tools. Nothing here needs to read a file or run a command, and the tool
    // schemas are most of the token overhead.
    '--tools', '',
    '--system-prompt', systemPrompt,
    // The CLI enforces the shape, so a malformed draft never reaches the phone.
    '--json-schema', JSON.stringify(schema),
    // Disables CLAUDE.md, skills, plugins, hooks, MCP and custom agents. Auth is
    // explicitly unaffected, which is why this is safe here and `--bare` is not.
    '--safe-mode',
    '--strict-mcp-config',
    '--disable-slash-commands',
    // 48 sweeps a day would otherwise leave a session transcript each time.
    '--no-session-persistence',
  ];
}

export interface CliResult {
  ok: boolean;
  /** Parsed object matching the caller's schema, when ok. */
  data?: unknown;
  error?: string;
}

/**
 * Run one headless generation. Never throws; every failure path returns
 * `{ok:false}` with a reason the caller can put in front of the operator.
 */
export async function runClaudeCli(
  prompt: string,
  schema: unknown,
  model: string,
  effort: string,
  systemPrompt: string,
): Promise<CliResult> {
  const exe = resolveClaudeCli();
  if (!exe) return { ok: false, error: 'claude CLI not found' };

  return new Promise<CliResult>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exe, cliArgs(model, effort, systemPrompt, schema), {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        // Never `shell: true` — see trap 4 in the file header.
        shell: false,
      });
    } catch (e) {
      return resolve({ ok: false, error: `spawn failed: ${e instanceof Error ? e.message : String(e)}` });
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (r: CliResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, error: `timed out after ${TIMEOUT_MS / 1000}s` });
    }, TIMEOUT_MS);

    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    child.on('error', (e) => finish({ ok: false, error: `cli error: ${e.message}` }));

    child.on('close', (code) => {
      if (code !== 0) {
        const detail = (stderr || stdout).trim().slice(0, 300) || `exit ${code}`;
        return finish({ ok: false, error: `cli exit ${code}: ${detail}` });
      }
      try {
        // Two layers: the CLI's own envelope, then our schema'd payload inside
        // its `result` string.
        const env = JSON.parse(stdout) as { is_error?: boolean; result?: string };
        if (env.is_error) return finish({ ok: false, error: 'cli reported is_error' });
        if (typeof env.result !== 'string') return finish({ ok: false, error: 'cli returned no result' });
        return finish({ ok: true, data: JSON.parse(env.result) });
      } catch (e) {
        return finish({ ok: false, error: `unparseable cli output: ${e instanceof Error ? e.message : String(e)}` });
      }
    });

    child.stdin?.end(prompt);
  });
}
