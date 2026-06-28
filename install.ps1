# AbleJam installer (Windows).
#   1) loopMIDI  - virtual MIDI port the Panic note travels through into Ableton.
#   2) "AbleJam" loopMIDI port + autostart at login.
#   3) AbleJam control surface into Ableton Live's User Library (via bridge/install.ps1).
#
# Run from PowerShell (a UAC prompt appears for the loopMIDI driver):
#   ./install.ps1
#   ./install.ps1 -SkipLoopMidi      # only (re)install the Ableton control surface
#   ./install.ps1 -PortName AbleJam  # change the virtual port name
param(
  [string]$PortName = "AbleJam",
  [switch]$SkipLoopMidi
)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Find-LoopMidiExe {
  $dirs = @(
    [Environment]::GetFolderPath('ProgramFiles'),
    [Environment]::GetFolderPath('ProgramFilesX86')
  )
  foreach ($d in $dirs) {
    if (-not $d) { continue }
    $p = Join-Path $d "Tobias Erichsen\loopMIDI\loopMIDI.exe"
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Install-LoopMidi {
  param([string]$PortName)

  # 1) Install loopMIDI (WiX Burn bundle) silently, unless it is already present.
  $loopExe = Find-LoopMidiExe
  if ($loopExe) {
    Write-Host "loopMIDI already installed." -ForegroundColor DarkGray
  } else {
    $setup = Join-Path $root "installer\loopMIDISetup.exe"
    if (-not (Test-Path $setup)) { Write-Warning "loopMIDI setup not found: $setup - skipping."; return }
    Write-Host "Installing loopMIDI (silent; approve the UAC prompt)..." -ForegroundColor Cyan
    Start-Process -FilePath $setup -ArgumentList "/install","/quiet","/norestart" -Wait
    $loopExe = Find-LoopMidiExe
  }

  # 2) Create the virtual port: loopMIDI persists ports in the registry and recreates
  #    them on launch, so we seed the value, then (re)start loopMIDI.
  $portsKey = "HKCU:\Software\Tobias Erichsen\loopMIDI\Ports"
  New-Item -Path $portsKey -Force | Out-Null
  New-ItemProperty -Path $portsKey -Name $PortName -Value 1 -PropertyType DWord -Force | Out-Null
  Write-Host "loopMIDI port '$PortName' registered." -ForegroundColor Green

  # 3) Run loopMIDI now (so the port goes live) and at login (the port must stay up
  #    for the Panic note to reach Ableton). Restart it to pick up the new port.
  if ($loopExe) {
    Get-Process loopMIDI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Process $loopExe
    Set-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "loopMIDI" -Value "`"$loopExe`"" -ErrorAction SilentlyContinue
    Write-Host "loopMIDI started and set to run at login." -ForegroundColor Green
  } else {
    Write-Warning "loopMIDI.exe not found after install - start it once manually."
  }
}

if (-not $SkipLoopMidi) { Install-LoopMidi -PortName $PortName }

# Install the Ableton control surface (reuse the existing bridge installer).
& (Join-Path $root "bridge\install.ps1")

Write-Host ""
Write-Host "One-time MIDI routing in Ableton (for the Panic note):" -ForegroundColor Cyan
Write-Host "  - Preferences > Link/Tempo/MIDI > MIDI Ports: INPUT row '$PortName' -> Track = On, Remote = Off."
Write-Host "  - Drum-rack track: MIDI From = $PortName, Monitor = In (armed/listening)."
Write-Host "  - AbleJam app > Settings > Panic: Output = $PortName (or Automatic), Note = D#2 (51)."
