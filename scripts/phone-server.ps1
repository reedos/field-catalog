<#
  Field Catalog on the phone: the web server that serves the app to your tailnet.

    scripts\phone-server.ps1 install   start it now, and at every logon (a hidden Startup-folder script)
    scripts\phone-server.ps1 remove    stop it and take it out of the Startup folder
    scripts\phone-server.ps1 start | stop | status

  It binds this PC's Tailscale address only, so nothing on the home network or the
  internet can reach it -- only devices signed in to your tailnet. It runs as you,
  with python.exe rather than pythonw.exe on purpose: Windows Firewall already has
  an allow rule for python.exe, and a second interpreter would need its own.
#>
param(
  [Parameter(Position = 0)][ValidateSet("install", "remove", "start", "stop", "status")][string]$Action = "status",
  [string]$Library = (Join-Path $env:USERPROFILE "FieldCatalog"),
  [int]$Port = 8795
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repo ".venv\Scripts\python.exe"
$ui = Join-Path $repo "ui\dist\index.html"
$log = Join-Path $Library "web.log"
$startup = Join-Path ([Environment]::GetFolderPath("Startup")) "Field Catalog Phone.vbs"
$command = "`"$python`" -m fieldcatalog --library `"$Library`" web --host tailscale --port $Port --log `"$log`""

function Get-ServerPid {
  $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { return $conn.OwningProcess }
  return $null
}

function Get-Address {
  $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { return $conn.LocalAddress }
  return $null
}

function Start-Server {
  if (Get-ServerPid) { Write-Host "already running (pid $(Get-ServerPid))"; return }
  if (-not (Test-Path $python)) { throw "no virtualenv at $python -- see the README's worker setup" }
  if (-not (Test-Path $ui)) { throw "the UI is not built: run 'npm run build' in ui\ first" }
  if (-not (Test-Path (Join-Path $Library "catalog.sqlite"))) { throw "no catalog in $Library" }
  $shell = New-Object -ComObject WScript.Shell
  $shell.CurrentDirectory = $repo
  [void]$shell.Run($command, 0, $false)          # 0 = no window
  foreach ($i in 1..30) {
    Start-Sleep -Milliseconds 500
    if (Get-ServerPid) { break }
  }
  Show-Status
}

function Stop-Server {
  $id = Get-ServerPid
  if (-not $id) { Write-Host "not running"; return }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $id"
  if ($proc.CommandLine -notmatch "fieldcatalog") { throw "port $Port belongs to something else (pid $id): $($proc.Name)" }
  # The venv's python.exe is a launcher; the listener is its child. Stop both.
  Stop-Process -Id $id -Force
  if ($proc.ParentProcessId) {
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($proc.ParentProcessId)"
    if ($parent -and $parent.CommandLine -match "fieldcatalog") { Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue }
  }
  Write-Host "stopped"
}

function Show-Status {
  $id = Get-ServerPid
  if ($id) {
    $addr = Get-Address
    Write-Host "running (pid $id)"
    Write-Host "  on the phone:  http://${addr}:$Port/"
    Write-Host "  log:           $log"
  } else {
    Write-Host "not running -- if it was just started it may be waiting for Tailscale; see $log"
  }
  if (Test-Path $startup) { Write-Host "  starts at logon: yes" } else { Write-Host "  starts at logon: no" }
}

switch ($Action) {
  "install" {
    $q = [string][char]34                          # VBScript writes a quote inside a string as two
    $vbs = @(
      "' Field Catalog on the phone. Written by scripts\phone-server.ps1 install; remove with 'remove'.",
      ('Set shell = CreateObject(' + $q + 'WScript.Shell' + $q + ')'),
      ('shell.CurrentDirectory = ' + $q + $repo + $q),
      ('shell.Run ' + $q + $command.Replace($q, $q + $q) + $q + ', 0, False')
    )
    Set-Content -Path $startup -Value $vbs -Encoding ASCII
    Write-Host "will start at logon: $startup"
    Start-Server
  }
  "remove" {
    Stop-Server
    if (Test-Path $startup) { Remove-Item $startup -Confirm:$false; Write-Host "removed from the Startup folder" }
  }
  "start" { Start-Server }
  "stop" { Stop-Server }
  "status" { Show-Status }
}
