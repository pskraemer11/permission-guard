# permission-guard

Dynamic path and command checking for shell calls. The plugin raises an `ask`
from the static rules to `allow` when the script demonstrably only reads, or only
writes into trusted folders. An `allow` or `deny` from the static rules is never
touched.

## Problem

The static rules in `opencode.jsonc` match the **prefix** of a command:

```jsonc
{ "action": "shell", "resource": "Get-ChildItem *", "effect": "allow" }
```

An agent almost never calls `Get-ChildItem ...` directly, though. It writes
something like:

```powershell
cd "C:\...\Projekt"
"=== Status ==="
git status
Get-ChildItem -Force | Select-Object Name
```

The command starts with `cd`, so no rule matches, so `ask`. The result: a
prompt every few seconds although nothing is being written.

## Solution

The plugin hooks into `permission.evaluate` and raises an **`ask` to `allow`**
when the script demonstrably only reads — or only writes into **trusted
folders**. It **never** touches `allow` or `deny`; the static rules remain the
hard boundary.

Exactly two locations are trusted:

- the session's project folder (`ctx.location.directory`)
- `%TEMP%\opencode`

A narrowly bounded exception permits installing and updating the checked Ruff
user baseline: create `APPDATA\ruff` and copy only
`staging/ruff-global-baseline.toml` to `APPDATA\ruff\ruff.toml`. This does
**not** make `APPDATA` a trusted root; other files, subfolders and write
commands stay denied.

Relative paths are resolved against the project folder; a `cd <absolute>` in
the script moves the reference point. Only unambiguously assigned variables
(`$f = "C:\p\x.txt"`) are resolved; everything else stays `ask`.

The global load context without a project (base = user profile) deliberately
does not register itself; otherwise the entire profile would be trusted.

## Installation

Source: `<project>\tools\permission-guard\`.
Runtime: `$HOME\.config\opencode\plugins\permission-guard\` or
`${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins/permission-guard` on Linux
and macOS. Since 15.11.2026 there is a second target, `$HOME\.codex\hooks\`, with
`codex_guard.py` (the Codex hook).

The runtime directory is deliberately write-protected (permission `ask`): no
agent should be able to change its own rules unnoticed. Development and testing
therefore happen in the project, and deployment happens **once**:

```powershell
cd "$HOME\Python-Projekte\AI+IDE-Hints"
pwsh -File .\tools\permission-guard\scripts\deploy.ps1          # tests + copy + hash comparison
pwsh -File .\tools\permission-guard\scripts\deploy.ps1 -Check   # compare only
```

```sh
cd tools/permission-guard
./scripts/deploy.sh            # tests + copy + hash comparison
./scripts/deploy.sh --check    # compare only
```

Neither deploy script deploys when `node test/test.mjs`,
`node test/bench-mcp.mjs` or `python -m pytest tests -q` fails, and both report
every byte difference between source and runtime. Do not link the directory by junction or symlink: the guard
would then sit in a folder with write permission, and the self-protection
boundary would be gone.

After cloning, install the Node dependency from the lock file once; without it
the commit test gate fails:

```powershell
npm ci                  # @opencode/plugin from package-lock.json
npm run test:index
```

On Windows, `$HOME` in Git Bash and WSL points at the Linux home, not at the
Windows profile. There either use `deploy.ps1` or set the targets:
`PERMISSION_GUARD_TARGET` and `PERMISSION_GUARD_CODEX_TARGET` to the Windows
paths (`/mnt/c/Users/<name>/...` in WSL, `/c/Users/<name>/...` in Git Bash).

## Operation

Without a running server everything stays at `ask`. Endpoint, model, grammar and
timeout are in `shell-reviewer.config.json` (created from
`shell-reviewer.config.example.json` during deploy, never overwritten
afterwards):

| Field        | Meaning                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------- |
| `enabled`    | reviewer on/off                                                                             |
| `baseUrl`    | OpenAI-compatible endpoint (localhost only, enforced)                                       |
| `model`      | model name: `kev-4b` for `systemone`; in the chat path for backends that require it         |
| `apiKeyEnv`  | name of the environment variable with the key, never the key itself                         |
| `timeoutMs`  | upper bound, then `ask`                                                                     |
| `grammar`    | GBNF; empty only for backends that reject it                                                |
| `gitShadow`  | `off` or `shadow`; in shadow mode destructive Git forms with `effect=allow` are only logged |
| `extraRisky` | project-specific patterns that are never allowed                                            |

A non-localhost `baseUrl` (file or environment) disables the reviewer instead
of being called; everything then stays at `ask`. `ask` is a prompt, not a
block: confirming it frees the action.

Overridable via environment: `PERMISSION_GUARD_REVIEWER` (`0`/`1`), `_URL`,
`_MODEL`, `_KEY_ENV`, `_TIMEOUT_MS`, `_BACKEND` (`mcpBackend`),
`_SHELL_BACKEND`, `_THRESHOLD` (`mcpThreshold`) and `_SHELL_THRESHOLD`
(`shellThreshold`), `PERMISSION_GUARD_GIT_SHADOW` (`0`/`1` or `off`/`shadow`),
`PERMISSION_GUARD_GIT_SHADOW_LOG` (path or `off`).

Both threshold variables only take effect inside the permitted band 0.5 up to
but excluding 1.0 (`THRESHOLD_BOUNDS` in `src/reviewer.js`); a value outside it
is discarded, and the file or the default applies instead.

**Location.** The file is read from the directory next to `reviewer.js`: in the
deployed plugin that is the flat plugin directory, in the repository it is
`src/`. A `shell-reviewer.config.json` in the repo root has had no effect since
the move to `src/` (21.11.2026) — it is not found, and the defaults apply
silently. For measurements inside the repository the environment variables are
therefore the more reliable route: they work regardless of location.

```powershell
.\scripts\start-reviewer.ps1                       # llama-server, Kev-4B, port 8080
.\scripts\start-reviewer.ps1 -ModelPath "D:\…\other.gguf" -Port 8081
.\scripts\start-reviewer.ps1 -Cpu -Server "C:\…\llama-server.exe"   # without GPU offload
.\scripts\start-reviewer.ps1 -Batch 2048 -Ubatch 2048               # smaller batch
.\scripts\start-reviewer.ps1 -Stop
```

The default path uses CUDA with `-ngl all`. `-Cpu` is meant for machines without
an NVIDIA graphics card or for a pure CPU build; set `timeoutMs` to 8000 there,
because one decision then takes about 4 s. Why the starter passes
`-b 2048 -ub 2048` is explained in `METHODOLOGY.md` under "Operational details".

**Configuration is read once, at load time.** `loadConfig()` runs in `setup()`,
so once per plugin instance. A change to `shell-reviewer.config.json` therefore
does **not** take effect immediately:

- A plain restart of the app window is **not** enough. The desktop app connects
  to the already running `opencode-cli` server; that server holds the plugin
  instance and with it the old configuration.
- Reliable is a file touch on `src/index.js` or `src/reviewer.js`: the file
  watcher reloads the plugin, and a new `setup: base=…` line appears in the log.
- Alternatively stop all OpenCode processes (including `opencode-cli`) and start
  again.

You can verify this in the guard log: compare the timestamp of the last `setup:`
line against the modification time of the configuration file.

## What is allowed

**Read-only:** A script is allowed when **every** statement can be classified as
reading — for example `Get-*`, `Test-Path`, `Select-Object`, `Select-String`,
`ConvertFrom-Json`, `git status|diff|log|show`, `rg`, `grep`, `cat`, `cd`,
assignments, `[System.IO.File]::ReadAllText`, `npm view`, and help or version
calls with exactly one help word. Control blocks (`if`, `foreach`, `try`) count
only when their body reads as well.

**Script blocks are code of their own.** A block behind `ForEach-Object`,
`Where-Object`, `Select-Object` and relatives is judged as its own script; `ask`
and `deny` are passed through with their reason. Before that,
`Get-ChildItem | ForEach-Object { Remove-Item -Recurse -Force C:\Windows\x }`
counted as "read-only".

**Script files are code of their own.** For `pwsh -File`/`-Fi` the guard reads
the `.ps1`/`.psm1` file (up to 256 KiB, valid UTF-8, no NUL bytes) and judges
its content with the same rules as a visible command. Relative paths resolve
against the working folder of the call, never against the script's folder;
`$PSScriptRoot` stays unresolvable, and `-WorkingDirectory` stays `ask`. Nested
script calls are followed up to three levels; a cycle or a deeper chain stays
`ask`. `.cmd`, `.bat`, `.sh` and `.py` have a different syntax and stay `ask`.

**Writing inside the project:** allowed when every target is resolvable and lies
inside a trusted folder — `Set-Content`, `Add-Content`, `Out-File`, `New-Item`,
`Copy-Item`, `Move-Item`, `Rename-Item`, redirection into a file,
`[System.IO.File]::WriteAllText`, `git add` and `git commit` (without `--amend`).

**File tools follow the same protection paths.** When the static rule for `edit`,
`write` or `patch` yields `ask`, `scopeEdit()` checks all target paths; existing
path parts are resolved physically so that junctions and symlinks cannot hide
their target.

**Deleting is not writing** (user decision 29.10.2026): `Remove-Item`, `rm`,
`del` and relatives lead to a prompt as soon as `-Recurse` or `-Force` is set, a
target contains a wildcard, or it carries no known file extension. The project
folder's own `.git` stays hard-blocked.

The complete lists, all exceptions and their reasoning are in `METHODOLOGY.md`
under "Regelwerk im Detail".

## What is **not** allowed

| Case                                                                          | Decision                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------- |
| writing outside the project folder                                            | `deny` (decision 25.10.2026)                    |
| write target not determinable (`$var`, foreign environment variable)          | `deny` (decision 10.11.2026)                    |
| write target with a wildcard                                                  | `ask`                                           |
| `Remove-Item` without a target (`Get-ChildItem \| Remove-Item`)               | `deny` (decision 10.11.2026)                    |
| writing into `<project>\.git`, `~/.config/opencode`, `~/.claude`, `~/.codex`  | `deny` (decision 25.10.2026)                    |
| writing into `<project>\.githooks`, `<project>\.github`, `opencode.jsonc`     | `ask` (decision 18.11.2026)                     |
| recursive deletion on the working folder itself                               | `deny` (decision 25.10.2026)                    |
| `git push`                                                                    | `ask` (static and guard)                        |
| `git branch -D`, `git checkout .`, `git restore .`                            | `deny` (guard; `branch -D` additionally static) |
| `git reset --hard`, `git clean`                                               | `deny` (static rule and guard)                  |
| `git branch -d`                                                               | `ask`; on Windows also `deny`                   |
| ↳                                                                             | (case-insensitive `-D` rule)                    |
| `git commit --amend`                                                          | `ask`                                           |
| `git commit --no-verify`, `git commit -n`                                     | `deny` (decision 15.11.2026)                    |
| `npm install`, `pip install`, `winget`, `npx`, `Start-Process`                | `ask`                                           |
| `Invoke-WebRequest`/`-RestMethod` with a save, send or credential plan        | `ask` (details in the methodology)              |
| `git config <key> <value>`                                                    | `ask`                                           |
| registry, task scheduler, `Set-ExecutionPolicy`, `Set-Acl`                    | `ask`                                           |
| `python` outside the allowance, `node` outside the self scripts,              | `ask`                                           |
| `pwsh -File` on `.cmd`, `.bat`, `.sh`, `.py`, or with an unreadable script    | `ask`                                           |
| `pwsh -File` with a cycle, deeper than three scripts, or over 256 KiB         | `ask`                                           |
| `& <command>`, dot-sourcing (target in variables)                             | `deny` (decision 3)                             |
| `Invoke-Expression`, `iex`, `-EncodedCommand`, `powershell -e`                | `deny` (decision 25.10.2026)                    |
| secret paths: `.env`, `.ssh`, `auth.json`, `*.pem`, `*.key`, `.npmrc`, `.aws` | `ask`                                           |
| secret terms: `password`, `secret`, `token`, `api_key`                        | `ask`                                           |
| `$env:NAME` with an unknown name (`$env:TEMP` is allowed)                     | `ask`                                           |
| writing to `.ssh`, `.gnupg`, `.aws/credentials`, `.git-credentials`           | `deny`                                          |
| `Format-Volume`, `Clear-Disk`, `Initialize-Disk`, `diskpart`                  | `deny`                                          |

Anything the classifier does not know stays at `ask` (fail closed).
Since 25.10.2026 a local decider precedes that `ask` (level 1).

## Two implementations: OpenCode and Codex

The same protection exists twice, with separate code: the OpenCode plugin in
`src/` (Node) and the Codex hook `codex_guard.py` (Python). A change to one
implementation does not affect the other. Codex has no `ask`; its hook can only
deny or let through, so it covers a narrow catalogue of hard cases and leaves
the rest to the sandbox. Hook errors (unreadable input, internal failures)
deny instead of letting through; a hook that cannot start at all is the
host's decision. Both sides read the same 40 cases from
`test/shared-cases.jsonl` so they cannot drift apart.

Details, the shared test cases and the differing deletion roots are in
`METHODOLOGY.md` under "Two implementations: OpenCode and Codex".

## Limits

- **No sandboxing.** An allowed command runs with your rights. The plugin only
  decides about place and kind of access — it isolates nothing.
- **Model-dependent polarity.** A new model can swap `Ja` and `Nein` (observed
  with `Jev-Style-Qwen3.5-2B`). The smoke test catches that because the allow
  cases fall back to `ask`.
- **A model verdict is no guarantee.** Hence the static list before it and `ask`
  as the default in every doubtful case.
- **Path checking is text analysis.** A command that computes its target path
  only at runtime and cannot be resolved safely (`Join-Path` with an unknown
  part, loop variable) becomes `deny`.
- **`python` and `node` run only inside the allowances**, otherwise `ask`.
  Interpreters execute arbitrary code. A script behind `pwsh -File` is allowed
  only after its content was read and judged; a file that cannot be read stays
  `ask`.
- **A `cd` into another drive** makes relative targets unclear → `deny`.
- **The decision model has a batch limit, not a character limit.** Over-long
  requests are answered by the server with an error that the guard turns into
  `deny` for that call.
- **The guard only sees what OpenCode asks about.** A `deny` rule in
  `opencode.jsonc` is dependable and is not bypassed — verified on 21.11.2026:
  after adding `{ "action": "edit", "resource": "~/.config/opencode/*",
  "effect": "deny" }`, the agent was refused write access to the very file it
  had changed shortly before. An `allow` rule, by contrast, leaves **no trace in
  the guard log**: the hook decides and logs only when the static rule yields
  `ask`. Saved approvals ("Allow always") turn `ask` into `allow` before the
  hook is consulted. If you want to watch what happens, you need rules that do
  not allow silently — `external_directory` set to `ask` is the switch for
  that.

## Checking it yourself

```powershell
node test/test.mjs                  # 1063 unit tests, classifier and reviewer
node test/test-wiring.mjs           # fake git: deny prevents execution
node test/test-index.mjs            # plugin wiring, fake OpenCode
node test/bench-mcp.mjs             # 40 fixed MCP cases, 25 of them denials
node test/smoke-reviewer.mjs        # 9 cases against the running configuration
python -m pytest tests -q           # Codex guard
python -m ruff check .              # Python lint
python -m pyright                   # Python type check
```

The CI pins every action to a full commit SHA and sets
`persist-credentials: false`. In this repository and in the template,
`zizmor` and `dependency-review` are required checks in addition to the test
matrix; the ruleset requires a pull request with 0 approvals.

The Codex guard tests use a repo-local `tests/conftest.py` fixture instead of
Pytest's `tmp_path` (the Codex Windows sandbox cannot use Pytest's `0o700`
temp directories). Test artifacts land in the git-ignored `tests/artifacts/`.
The convention is recorded in `AGENTS.md` and `docs/adr/0003-tmp-path-workaround-codex-sandbox.md`.

`node src/replay.mjs` replays the commands from `opencode.log` against the
classifier and shows how many run without a prompt; `node src/analyze.mjs`
breaks the remaining prompts down by cause.

`%TEMP%\opencode-permission-guard[-<uid>]\guard.log` holds one line per decision.
Command texts are never stored raw, only as `<name>#<hash>`; directory and file
are private on POSIX (0700/0600).

## Further reading

| File                                     | Content                                                           |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `METHODOLOGY.md`                         | rule set in detail, decision model, MCP verdict, measurement      |
| `METHODOLOGY_de.md`                      | the same in German                                                |
| `PLANUNG.md`                             | state, measurement series, dated decisions (German)               |
| `CHANGELOG.md`                           | file-by-file changes (German)                                     |
| `COMPACTIONS.md`                         | why something was decided the way it was (German)                 |
| `docs/adr/0002-reviewer-und-sandbox.md`  | reviewer and sandbox compared (German)                            |
