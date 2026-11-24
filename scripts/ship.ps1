#Requires -Version 7
<#
.SYNOPSIS
    Ships the current commit to the default branch via a branch and pull request.

.DESCRIPTION
    Replaces six manual steps: create a branch, reset the default branch,
    push, open a PR, wait for checks, merge, pull the default branch.

    The default branch is read from origin/HEAD (fallback 'main').

    Aborts if the working tree is dirty or a check fails; the branch then
    stays in place and nothing is merged. Without -Branch, a name is
    generated from date and time.

    Before pushing, the script shows 'git status' and waits for Enter;
    anything else aborts without pushing anything.

    Prerequisites: clean working tree, current default branch or a wave
    branch ('welle-*'), at least one commit ahead of
    origin/<default-branch>, gh authenticated.

.PARAMETER Branch
    Name of the working branch. Without a value: welle-<yyyyMMdd-HHmm>.

.PARAMETER DryRun
    Only shows what would happen (no prompt).

.EXAMPLE
    pwsh -NoProfile -File .\scripts\ship.ps1
#>
param(
    [string]$Branch = "",
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    function Invoke-Git([string[]]$Arguments) {
        $out = & git @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed:`n$out" }
        return ($out | Out-String).Trim()
    }

    # Read the default branch from origin/HEAD; fall back to 'main' if
    # origin/HEAD is missing (e.g. a nested-repo clone) or unreadable.
    $defaultBranch = 'main'
    try {
        $head = Invoke-Git @('symbolic-ref', 'refs/remotes/origin/HEAD')
        $candidate = ($head -replace 'refs/remotes/origin/', '').Trim()
        if ($candidate -and $candidate -notmatch '\s') { $defaultBranch = $candidate }
    } catch {
        # origin/HEAD not set - keep fallback 'main'
    }

    # Show status first: the requested 'git status' view before anything
    # happens.
    Write-Host '--- git status ---'
    Invoke-Git @('status', '--short', '--branch') | Write-Host

    # Block only tracked changes. Untracked files (screenshots, review/)
    # are left untouched and merely listed - they are not part of the
    # commit, and the commit is what gets shipped here.
    $dirty = Invoke-Git @('status', '--porcelain', '--untracked-files=no')
    if ($dirty) { throw "Working tree is not clean:`n$dirty" }
    $untracked = Invoke-Git @('ls-files', '--others', '--exclude-standard')
    if ($untracked) {
        Write-Host 'Note: untracked files are left untouched:'
        $untracked -split "`n" | ForEach-Object { Write-Host "  $_" }
    }

    $current = Invoke-Git @('rev-parse', '--abbrev-ref', 'HEAD')
    $resume = $current -ne $defaultBranch
    if ($resume -and $current -notlike 'welle-*') {
        throw "Current branch is '$current', expected '$defaultBranch' or a wave branch ('welle-*')."
    }

    $ahead = [int](Invoke-Git @('rev-list', '--count', "origin/$defaultBranch..HEAD"))
    if ($ahead -lt 1) { throw "No commit ahead of origin/$defaultBranch - nothing to ship." }

    if ($resume) {
        # Resume: an earlier run already created the branch, reset the
        # default branch, and pushed, then failed at the checks or the PR.
        # A second run must neither recreate the branch nor reset the
        # default branch again.
        $Branch = $current
    }
    elseif (-not $Branch) {
        $Branch = 'welle-' + (Get-Date -Format 'yyyyMMdd-HHmm')
    }

    $steps = if ($resume) {
        @(
            "git push -u origin $Branch",
            "gh pr list --head $Branch --state open (reuse PR, create one otherwise)",
            "gh pr checks --watch --required",
            "gh pr checks --json state,name (look for FAILURE)",
            "gh pr merge --merge --delete-branch",
            "git switch $defaultBranch",
            "git pull --ff-only"
        )
    }
    else {
        @(
            "git branch $Branch",
            "git reset --hard origin/$defaultBranch",
            "git switch $Branch",
            "git push -u origin $Branch",
            "gh pr create --base $defaultBranch --head $Branch --fill",
            "gh pr checks --watch --required",
            "gh pr checks --json state,name (look for FAILURE)",
            "gh pr merge --merge --delete-branch",
            "git switch $defaultBranch",
            "git pull --ff-only"
        )
    }
    if ($DryRun) {
        if ($resume) { "Resuming on $Branch ($ahead commit(s) ahead of origin/$defaultBranch)" }
        else { "Branch: $Branch ($ahead commit(s)) onto $defaultBranch" }
        $steps | ForEach-Object { "  $_" }
        return
    }

    # Prompt: proceed only on Enter; anything else aborts without pushing
    # anything.
    $answer = Read-Host "Push and open a pull request on '$Branch'? [Enter = yes, anything else = abort]"
    if ($answer -ne '') { throw 'Aborted by user. Nothing was pushed.' }

    if ($resume) {
        "Resuming on $Branch ($ahead commit(s) ahead of origin/$defaultBranch)."
    }
    else {
        Invoke-Git @('branch', $Branch) | Out-Null
        Invoke-Git @('reset', '--hard', "origin/$defaultBranch") | Out-Null
        Invoke-Git @('switch', $Branch) | Out-Null
        "Branch $Branch created ($ahead commit(s))."
    }

    Invoke-Git @('push', '-u', 'origin', $Branch) | Out-Null
    "Pushed."

    # An existing open PR is reused; only without one is a new PR created.
    # Otherwise the second run would fail with "already exists".
    $existing = (& gh pr list --head $Branch --state open --json number --jq '.[0].number' | Out-String).Trim()
    if ($existing) {
        "Reusing PR #$existing."
    }
    else {
        & gh pr create --base $defaultBranch --head $Branch --fill
        if ($LASTEXITCODE -ne 0) { throw 'Could not create PR.' }
    }

    # Only required checks block. GitHub occasionally leaves a finished
    # job stuck on "in_progress" - status and conclusion contradict each
    # other, and --watch without --required then waits forever (incident
    # 2026-11-21, job "Zeilenenden und BOM"). A failure among the optional
    # checks still counts.
    # Right after the push the checks are not registered yet; gh then
    # reports "no checks reported" (or with --required "no required checks
    # reported") and exits 1. That is not a failure, just too early - so
    # wait and retry (max. 3 minutes). Any other exit code is a real
    # result and aborts immediately.
    # If required-checks resolution is unavailable (plan limit on private
    # repos: rulesets need a paid plan; or token scope), fall back to
    # watching all checks - a superset, never weaker.
    $deadline = (Get-Date).AddMinutes(3)
    $requiredGrace = (Get-Date).AddSeconds(60)
    $useAllChecks = $false
    while ($true) {
        $watchArgs = @('pr', 'checks', '--watch')
        if (-not $useAllChecks) { $watchArgs += '--required' }
        $report = (& gh @watchArgs 2>&1 | Out-String)
        if ($LASTEXITCODE -eq 0) { break }
        $checksUnavailable = $report -match 'Resource not accessible|Upgrade to GitHub Pro'
        if ($checksUnavailable -and -not $useAllChecks) {
            $useAllChecks = $true
            Write-Host 'Required-checks resolution unavailable; watching all checks instead.'
        }
        # Persistently "no required checks reported" past the grace window
        # means the repo has no required checks configured (e.g. a private
        # repo on the free plan, where rulesets are unavailable) - fall
        # back to watching all checks, a superset that is never weaker.
        if (-not $useAllChecks -and ($report -match 'no required checks reported') -and ((Get-Date) -gt $requiredGrace)) {
            $useAllChecks = $true
            Write-Host 'No required checks configured; watching all checks instead.'
        }
        # Transient network errors (connect timeouts, resets, EOF) are not
        # results - retry them within the deadline like 'checks reported'.
        $transient = $report -match 'dial tcp|connection reset|EOF|TLS handshake|timed out|timeout|server misbehaving|no such host'
        if ((($report -notmatch 'checks reported') -and (-not $checksUnavailable) -and (-not $transient)) -or ((Get-Date) -gt $deadline)) {
            throw "Required checks did not pass. Branch $Branch is left in place; $defaultBranch is unchanged.`n$($report.Trim())"
        }
        Start-Sleep -Seconds 5
    }

    $failed = & gh pr checks --json state,name --jq '[.[] | select(.state == "FAILURE") | .name] | join(", ")'
    if ($failed) {
        throw "Check failed: $failed. Branch $Branch is left in place; $defaultBranch is unchanged."
    }

    & gh pr merge --merge --delete-branch
    if ($LASTEXITCODE -ne 0) { throw 'Merge failed.' }

    Invoke-Git @('switch', $defaultBranch) | Out-Null
    Invoke-Git @('pull', '--ff-only') | Out-Null
    "Done: $Branch merged, $defaultBranch pulled."
} finally {
    Pop-Location
}
