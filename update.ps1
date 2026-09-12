# ============================================================
#  Mise a jour de l'overlay (sans fenetre, appelee par le panneau)
#  Telecharge la derniere version depuis GitHub, remplace les
#  fichiers, puis affiche la nouvelle VERSION.
# ============================================================
$ErrorActionPreference = 'Stop'

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = 'https://github.com/gioledonuts-ui/overlaytwitch/archive/refs/heads/main.zip'
$zip = Join-Path $env:TEMP 'overlaytwitch-update.zip'
$extract = Join-Path $env:TEMP 'overlaytwitch-update'

try {
  # 1. telechargement
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

  # 2. extraction
  if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $extract -Force

  $src = Join-Path $extract 'overlaytwitch-main'
  if (-not (Test-Path (Join-Path $src 'widget.html'))) { throw 'extraction impossible' }

  # 3. sauvegarde de tes cles (secrets.json)
  $secretsPath = Join-Path $dir 'secrets.json'
  $secretsBackup = Join-Path $env:TEMP 'secrets.backup.json'
  if (Test-Path $secretsPath) { Copy-Item $secretsPath $secretsBackup -Force }

  # 4. copie des fichiers
  Copy-Item (Join-Path $src '*') -Destination $dir -Recurse -Force

  # 5. restaure tes cles
  if (Test-Path $secretsBackup) { Copy-Item $secretsBackup $secretsPath -Force }

  # 6. affiche la version
  if (Test-Path (Join-Path $dir 'VERSION.txt')) {
    (Get-Content (Join-Path $dir 'VERSION.txt') -Raw).Trim()
  } else {
    'OK'
  }
} catch {
  'ERREUR: ' + $_.Exception.Message
}
