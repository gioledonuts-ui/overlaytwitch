# ============================================================
#  7GIONNY - Mini-application
#  Lance le pont en arriere-plan + ouvre le panneau dans une
#  PETITE fenetre (pas de navigateur plein ecran).
# ============================================================
$ErrorActionPreference = 'SilentlyContinue'

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

# --- une seule instance a la fois ---
$mutex = New-Object System.Threading.Mutex($false, '7GIONNY-Overlay-App')
if (-not $mutex.WaitOne(0, $false)) { exit 0 }

# --- 1. trouver node.exe ---
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  foreach ($c in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
    if (Test-Path $c) { $node = $c; break }
  }
}
if (-not $node) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show('Node.js introuvable. Installe-le depuis https://nodejs.org puis relance.', '7GIONNY') | Out-Null
  exit 1
}

# --- 2. fermer tout ancien pont (port 8321) ---
Get-NetTCPConnection -LocalPort 8321 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }

# --- 3. dependances (une seule fois, en silence) ---
if (-not (Test-Path "$dir\node_modules")) {
  $npm = Join-Path (Split-Path -Parent $node) 'npm.cmd'
  if (Test-Path $npm) {
    Start-Process -FilePath $npm -ArgumentList 'install --omit=dev --no-audit --no-fund' -WorkingDirectory $dir -WindowStyle Hidden -Wait
  }
}

# --- 4. lancer le pont (node server.js) en arriere-plan ---
Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $dir -WindowStyle Hidden

# --- 5. ouvrir le panneau dans une PETITE fenetre app ---
Start-Sleep -Milliseconds 900
$browser = $null
foreach ($b in @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)) {
  if (Test-Path $b) { $browser = $b; break }
}

if ($browser) {
  # fenetre app propre : pas d'onglets, pas de barre d'adresse, petite taille
  Start-Process $browser -ArgumentList '--app=http://localhost:8321/panneau', '--window-size=560,820', '--window-position=60,60'
} else {
  Start-Process 'http://localhost:8321/panneau'
}
