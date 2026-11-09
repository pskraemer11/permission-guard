// Verdrahtungstest: Eine "deny"-Entscheidung darf den Befehl nicht ausfuehren.
//
// Der Test legt einen Fake-`git` in einen temporaeren PATH. Ein echter
// Git-Aufruf findet nicht statt; der Shim protokolliert nur Argumente und
// liefert Exit 0. Fuer destruktive Formen wird `evaluate()` befragt und
// geprueft, dass der Shim nicht aufgerufen wurde. Eine erlaubte Gegenprobe
// (`git status`) beweist, dass der Shim selbst funktioniert.
//
// Ausfuehren mit: node test-wiring.mjs

import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { evaluate } from "./guard.js"

const root = mkdtempSync(join(tmpdir(), "pg-wiring-"))
const bin = join(root, "bin")
const calls = join(root, "calls.log")
mkdirSync(bin)

const isWindows = process.platform === "win32"
if (isWindows) {
  writeFileSync(
    join(bin, "git.cmd"),
    '@echo off\r\n>>"%PG_WIRING_LOG%" echo %*\r\nexit /b 0\r\n',
  )
} else {
  const shim = join(bin, "git")
  writeFileSync(shim, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PG_WIRING_LOG"\n')
  chmodSync(shim, 0o755)
}

const env = {
  ...process.env,
  PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
  PG_WIRING_LOG: calls,
}
const options = { base: root, roots: [root], home: root, temp: root, appData: root }

let passed = 0
let failed = 0
function check(label, ok, detail = "") {
  if (ok) {
    passed += 1
    console.log(`ok    ${label}`)
  } else {
    failed += 1
    console.log(`FAIL  ${label}${detail ? ` (${detail})` : ""}`)
  }
}

function runFakeGit() {
  if (isWindows) {
    return spawnSync("cmd.exe", ["/d", "/s", "/c", "git status"], { env, encoding: "utf8" })
  }
  return spawnSync("git", ["status"], { env, encoding: "utf8" })
}

try {
  console.log("== Deny verhindert Ausfuehrung ==")
  const destructive = [
    ["branch -D", `git -C "${root}" branch -D alt`],
    ["checkout .", `git -C "${root}" checkout .`],
    ["restore .", `git -C "${root}" restore .`],
    ["reset --hard", `git -C "${root}" reset --hard HEAD~1`],
    ["clean -fd", `git -C "${root}" clean -fd`],
  ]
  for (const [label, command] of destructive) {
    if (existsSync(calls)) rmSync(calls, { force: true })
    const verdict = evaluate(command, options)
    check(`${label}: evaluate = deny`, verdict.decision === "deny", verdict.decision)
    check(`${label}: Fake-git nicht aufgerufen`, !existsSync(calls))
  }

  console.log("\n== Erlaubte Gegenprobe ==")
  if (existsSync(calls)) rmSync(calls, { force: true })
  const allowed = evaluate("git status", options)
  check("git status: evaluate = allow", allowed.decision === "allow", allowed.decision)
  const result = runFakeGit()
  check("Fake-git startet mit Exit 0", result.status === 0, String(result.status))
  const logged = existsSync(calls) ? readFileSync(calls, "utf8") : ""
  check("Fake-git protokolliert den Aufruf", logged.includes("status"), logged.trim())
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(`\n${passed}/${passed + failed} bestanden`)
process.exit(failed ? 1 : 0)
