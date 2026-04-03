param(
  [string]$ExtensionsRoot = "$env:USERPROFILE\.vscode\extensions",
  [string]$KeepVersion = "",
  [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ExtensionsRoot)) {
  Write-Host "Extensions directory not found: $ExtensionsRoot"
  exit 0
}

$targets = Get-ChildItem -LiteralPath $ExtensionsRoot -Directory | Where-Object {
  $_.Name -like "local.nitori-codex-webview-*" -or
  $_.Name -like "kaisei-yasuzaki.nitori-codex-webview-*"
}

if ($KeepVersion) {
  $normalizedKeepVersion = $KeepVersion.Trim()
  $targets = $targets | Where-Object {
    $_.Name -notlike "kaisei-yasuzaki.nitori-codex-webview-$normalizedKeepVersion"
  }
}

if (-not $targets -or $targets.Count -eq 0) {
  Write-Host "No matching installed extensions found."
  exit 0
}

foreach ($target in $targets) {
  if ($WhatIf) {
    Write-Host "[WhatIf] Remove $($target.FullName)"
    continue
  }

  Write-Host "Removing $($target.FullName)"
  Remove-Item -LiteralPath $target.FullName -Recurse -Force
}

Write-Host "Cleanup complete."
