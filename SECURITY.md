# Security Policy

## System and Scope

`opencode-permission-guard` v0.1.0 (`package.json:2`, `package.json:3`) is a fail-closed permission classifier for OpenCode. It registers a `permission.evaluate` hook (`src/index.js:111`, `src/index.js:257`), elevates a static-rule `ask` to `allow` only when a shell script provably only reads or only writes into trusted folders, and never overrides a static `allow`/`deny` (`src/index.js:439`, `src/guard.js:3267`). It is **not a sandbox** and not an isolation boundary: an allowed command runs with the rights of the logged-in user.

Verification: Scope confirmed as the selected component only; tests and offline reporting CLIs are not production decision paths. The Codex runtime below is inside the selected component scope, but whether it is intended to be covered by this policy is unresolved (see Open Decisions).

## Threat Model and Trust Boundaries

Assumed: an agent proposes commands/MCP calls; a user does not want to answer prompts at every step. The guard prevents read-only commands from prompting and writing commands from running without a prompt. It does not protect against a command classified as read-only that writes via an indirect route, a manipulated model that approves a grey-area call, an attacker with write access to the plugin or configuration, exfiltration through a tool the guard does not see, or prompt injection in tool results. The `[ud-…]` boundary marking around MCP/`execute` results and the `[verdacht: …]` note name format collisions only and recognise no meaning; both are hints to the model, not a boundary.

Boundaries implemented in source:

- Agent/model → guard: static classification for shell (`src/guard.js:3267`), file edits with physically resolved targets (`src/guard.js:2278`), webfetch (`src/guard.js:2375`), and MCP criteria/verdict. Trusted write roots are the project directory and the temp `opencode` folder (`src/index.js:100`, `src/index.js:104`).
- Guard → local model server: only loopback endpoints are used; a non-loopback `baseUrl` disables the reviewer instead of sending data remotely (`src/reviewer.js:385`, `src/reviewer.js:452`). A static `RISKY` pre-filter runs before any model call (`src/reviewer.js:1218`). Reviewer errors/timeouts return `ask` (`src/reviewer.js:1214`).
- Guard → audit/log storage: audit records contain field names, resource kinds, flags, decisions and hashes, never argument values or result content (`src/audit.js:8`).
- Codex host → hook: `codex_guard.py` reads hook JSON on stdin and emits `deny` for destructive/history-loss/`--no-verify`/mass-deletion/protected-patch cases (`codex_guard.py:489`, `codex_guard.py:509`). Unreadable input and internal exceptions produce `deny` (`codex_guard.py:512`).

Caller/operator obligations: the host must supply the static permission rules and show `ask` prompts; the guard depends on static `deny` rules it never overrides (`src/index.js:439`). The operator must protect the deployed plugin copy, its configuration, the audit chain/anchor/key, and the environment variable named by `apiKeyEnv`. The local model server and its weights are assumed trusted; the guard cannot verify model integrity. Deployment assumptions not confirmed by the owner: supported operating systems and OpenCode/Codex versions, and how runtime-directory write protection is enforced on Windows where `chmod` is not ACL-effective (`src/diagnostics.js:42`).

## Security Invariants

- Fail closed: unknown/unclassifiable → `ask`; errors → `ask` (`src/guard.js:3267`, `src/reviewer.js:1214`); static `deny` is never overwritten (`src/index.js:439`).
- Only an eligible `ask` may be elevated to `allow` (`src/index.js:439`).
- No raw command text, argument values, URLs, or results in logs/audit; only names, hashes, and field names (`src/audit.js:8`).
- Audit integrity (implemented design): SHA256 hash chain plus HMAC-SHA256 (`mac`) plus an anchor file detecting tail truncation while the anchor is intact (`src/audit.js:11`, `src/audit.js:76`, `src/audit.js:95`, `src/audit.js:103`). Whoever can write chain, anchor, and key can forge records; the chain is not a signature (`src/audit.js:18`).
- Credentials are referenced only by environment-variable name (`apiKeyEnv`); no key is read from a file in the plugin (`src/shell-reviewer.config.json:14`).
- MCP gating mode is `active` in code (`src/guard.js:1545`); any shadow-by-default comment is stale and must be corrected regardless of the policy decision.

## Reportable Findings and Severity Context

Reportable: a bypass that lets a writing/destructive call run as `allow` without a prompt, any overwrite of a static `deny`, disclosure of argument values/results/URLs/credentials in audit or logs, activation of a non-loopback model endpoint, or a Codex-hook fail-open on malformed input. Severity ratings have not been owner-confirmed; assess by realistic reachability and impact (unauthorised write/execution, credential or data disclosure, or loss of audit integrity) rather than by an invented rating.

## Out of Scope, Exclusions, and Accepted Risk

No exclusions, accepted risks, or severity context have been owner-confirmed in the supplied material. None are encoded here. Tests, benchmarks, fixtures, and offline reporting CLIs are not production decision paths; that is a scope observation, not an owner-confirmed exclusion, and must not be used to suppress a finding in a production path.

## Known Limitations and Compensating Controls

- Not a sandbox: allowed commands run with user rights (`src/index.js:439`).
- `[ud-…]`/`[verdacht: …]` marking is a model hint, not a boundary (existing `SECURITY.md` guidance, preserved).
- Oversized/unverifiable MCP arguments (>32000 characters as JSON) produce `deny` with reason `unpruefbar` except proven read intent without secret suspicion; a model-server "input too large" response produces `deny` for that call; an MCP `write`/`destructive` call targeting outside project and temp produces `deny`, inside stays `ask` (existing guidance, preserved).
- Webfetch to non-localhost targets prompts (`ask`) rather than blocking; localhost runs without a prompt (`src/guard.js:2375`).
- Production defaults (owner-confirmed 24.11.2026): `resultShield=annotate` and `gitShadow=shadow`, as set in the versioned runtime config (`src/shell-reviewer.config.json:24`, `src/shell-reviewer.config.json:26`) and the example template (`shell-reviewer.config.example.json:24`, `shell-reviewer.config.example.json:28`). Without any config file the code fallbacks in `src/reviewer.js` are `off`/`off`; the deployed config file is the source of truth.

## Open Decisions (Owner Review Required)

Decided 24.11.2026: this policy covers both runtimes (OpenCode plugin and Codex hook); the audit description follows the implemented HMAC + anchor design (`src/audit.js:11`); production defaults are `resultShield=annotate` and `gitShadow=shadow` with MCP gating mode `active` (`src/guard.js:1545`).

- Supported deployment matrix (OS, OpenCode/Codex versions) and Windows runtime-directory protection — owner decision required.
- Local model server trust and model-weight provenance/updates — owner decision required.
- Security contact/owner beyond GitHub Private Advisory, and supported versions beyond 0.1.x — owner decision required.

## Reporting a Vulnerability

Report via the repository's GitHub **Security → Report a vulnerability** (Private Advisory) function. Please do not open public issues for security questions and do not put addresses in reports or logs. Please include: affected version, operating system, the triggering command or MCP call, and the expected vs. actual verdict. No real credentials.

## Supported Versions

| Version | Status |
| --- | --- |
| 0.1.x | Supported |
