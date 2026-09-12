# ============================================================
#  7GIONNY - Mini-application (icone dans la barre systeme)
#  Lance le pont en arriere-plan (aucune fenetre noire).
#  Demarre MINIMISE : seule l'icone apparait en bas a droite.
#  Clic sur l'icone = ouvrir le panneau (petite fenetre).
#  Refermer la fenetre = tout continue, on retourne dans l'icone.
# ============================================================
$ErrorActionPreference = 'SilentlyContinue'

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

# --- une seule instance ---
$mutex = New-Object System.Threading.Mutex($false, '7GIONNY-Overlay-Tray')
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

# --- 4. lancer le pont (cache) ---
$proc = Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $dir -WindowStyle Hidden -PassThru

# --- 5. icone dans la barre systeme ---
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$tray = New-Object System.Windows.Forms.NotifyIcon
$icoPath = "$dir\assets\logo-7g.ico"
if (Test-Path $icoPath) { $tray.Icon = New-Object System.Drawing.Icon($icoPath) }
$tray.Text = '7GIONNY - Overlay'
$tray.Visible = $true

# --- trouver Chrome/Edge pour la petite fenetre ---
$browser = $null
foreach ($b in @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)) { if (Test-Path $b) { $browser = $b; break } }

$openPanel = {
  if ($browser) {
    Start-Process $browser -ArgumentList '--app=http://localhost:8321/panneau', '--window-size=560,820', '--window-position=60,60'
  } else {
    Start-Process 'http://localhost:8321/panneau'
  }
}
$quit = {
  $tray.Visible = $false
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
  [System.Windows.Forms.Application]::Exit()
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$m1 = $menu.Items.Add('Ouvrir le panneau de controle'); $m1.Add_Click($openPanel)
$menu.Items.Add('-') | Out-Null
$m2 = $menu.Items.Add('Quitter'); $m2.Add_Click($quit)
$tray.ContextMenuStrip = $menu
$tray.Add_Click($openPanel)

# --- demarre MINIMISE : pas d'ouverture auto de la fenetre ---
# --- petit rappel discret pour dire que c'est lance ---
$tray.ShowBalloonTip(3000, '7GIONNY', "Pont lance. Clique sur l'icone pour ouvrir le panneau.", [System.Windows.Forms.ToolTipIcon]::Info)

# --- rester en arriere-plan (boucle de messages) ---
[System.Windows.Forms.Application]::Run()
$mutex.ReleaseMutex()
