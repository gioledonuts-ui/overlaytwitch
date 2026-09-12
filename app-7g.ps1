# ============================================================
#  7GIONNY - Mini-application (icone dans la barre systeme)
#  Lance le pont en arriere-plan (aucune fenetre noire).
#  Demarre MINIMISE. Clic sur l'icone = ouvrir/revenir au panneau
#  (une seule fenetre : si elle est deja ouverte, on la remet devant).
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

# --- petit helper pour retrouver/remettre devant la fenetre du panneau ---
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win7g {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  public static IntPtr found = IntPtr.Zero;
  public static bool Find(string part) {
    found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      StringBuilder sb = new StringBuilder(256);
      GetWindowText(h, sb, 256);
      if (sb.ToString().IndexOf(part, StringComparison.OrdinalIgnoreCase) >= 0) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found != IntPtr.Zero;
  }
}
"@

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
  # une seule fenetre : si elle est deja ouverte, on la remet devant
  if ([Win7g]::Find('Panneau')) {
    [Win7g]::ShowWindow([Win7g]::found, 9) | Out-Null   # SW_RESTORE
    [Win7g]::SetForegroundWindow([Win7g]::found) | Out-Null
  } elseif ($browser) {
    Start-Process $browser -ArgumentList '--app=http://localhost:8321/panneau', '--window-size=560,820', '--window-position=60,60'
  } else {
    Start-Process 'http://localhost:8321/panneau'
  }
}
$quit = {
  $tray.Visible = $false
  # ferme le pont (port 8321) ET la fenetre du panneau
  Get-NetTCPConnection -LocalPort 8321 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
  # ferme la fenetre du panneau si elle est encore ouverte
  if ([Win7g]::Find('Panneau')) {
    [Win7g]::PostMessage([Win7g]::found, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null   # WM_CLOSE
  }
  [System.Windows.Forms.Application]::Exit()
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$m1 = $menu.Items.Add('Ouvrir le panneau de controle'); $m1.Add_Click($openPanel)
$menu.Items.Add('-') | Out-Null
$m2 = $menu.Items.Add('Quitter'); $m2.Add_Click($quit)
$tray.ContextMenuStrip = $menu

# le panneau s'ouvre uniquement au CLIC GAUCHE ; le clic droit = menu
$tray.Add_MouseClick({
  param($sender, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { & $openPanel }
})

# --- demarre MINIMISE : pas d'ouverture auto ni notification ---

[System.Windows.Forms.Application]::Run()
$mutex.ReleaseMutex()
