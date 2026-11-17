#!/usr/bin/env pwsh
# Aktiviert die Projekt-Hooks fuer diese Arbeitskopie.
#
# `core.hooksPath` ist lokale Git-Konfiguration und gilt pro Klon. Ohne diesen
# Schritt sucht Git in .git/hooks und die Hooks unter .githooks/ laufen nicht.
# Das Skript aendert keine Regeldatei und kein Gate; es zeigt nur den Pfad.
# Rueckgaengig: git config --unset core.hooksPath
#
# Das Skript ersetzt keinen Testlauf; die Pruefungen stehen in .githooks/.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -Path $root

git config core.hooksPath .githooks
if ($LASTEXITCODE -ne 0) {
    Write-Error "core.hooksPath konnte nicht gesetzt werden."
    exit 1
}
Write-Output "Hooks aktiviert: core.hooksPath = $(git config core.hooksPath)"
