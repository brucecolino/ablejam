# Installs the AbleJam control surface into Ableton Live's User Library.
# OneDrive-aware: handles redirected Documents folders (e.g. OneDrive\Documenti).
# Run from PowerShell:  ./bridge/install.ps1
$ErrorActionPreference = "Stop"

$src = Join-Path $PSScriptRoot "AbleJam"
if (-not (Test-Path $src)) { throw "Source not found: $src" }

# Candidate "Documents" bases, most reliable first.
$bases = @()
$bases += [Environment]::GetFolderPath('MyDocuments')   # respects OneDrive redirection
if ($env:OneDrive) {
  $bases += (Join-Path $env:OneDrive "Documenti")
  $bases += (Join-Path $env:OneDrive "Documents")
}
$bases += (Join-Path $env:USERPROFILE "Documents")
$bases = $bases | Where-Object { $_ } | Select-Object -Unique

# Install into every base that already has an Ableton User Library.
$installed = @()
foreach ($b in $bases) {
  $userLib = Join-Path $b "Ableton\User Library"
  if (Test-Path $userLib) {
    $dest = Join-Path $userLib "Remote Scripts\AbleJam"
    New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    Copy-Item -Recurse -Force $src $dest
    $installed += $dest
  }
}

if ($installed.Count -eq 0) {
  # Fallback: create under the redirected Documents.
  $dest = Join-Path ([Environment]::GetFolderPath('MyDocuments')) "Ableton\User Library\Remote Scripts\AbleJam"
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  Copy-Item -Recurse -Force $src $dest
  $installed += $dest
}

Write-Host "Installed AbleJam control surface to:" -ForegroundColor Green
$installed | ForEach-Object { Write-Host "  $_" }
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. FULLY QUIT and reopen Ableton Live 12 (control surfaces are scanned at startup)."
Write-Host "  2. Live > Settings > Link, Tempo & MIDI."
Write-Host "  3. Under 'Superficie Controllo', select 'AbleJam' (it sorts just above AbleSet)."
Write-Host "  4. You should see 'AbleJam connected' in Live's status bar."
