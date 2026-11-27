[CmdletBinding()]
param([string]$Name = "x")
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-Hinweis {
    param([string]$Text)
    Write-Output $Text
}

Get-ChildItem -Force | Select-Object -First 3
