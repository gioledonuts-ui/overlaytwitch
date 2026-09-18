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

  # 3. sauvegarde de tes cles, reglages et photos custom (secrets.json + config-perso.json + alertes)
  $secretsPath = Join-Path $dir 'secrets.json'
  $secretsBackup = Join-Path $env:TEMP 'secrets.backup.json'
  if (Test-Path $secretsPath) { Copy-Item $secretsPath $secretsBackup -Force }

  $configPath = Join-Path $dir 'config-perso.json'
  $configBackup = Join-Path $env:TEMP 'config-perso.backup.json'
  if (Test-Path $configPath) { Copy-Item $configPath $configBackup -Force }

  # photos custom alertes + sons custom
  $assetsBackup = Join-Path $env:TEMP 'assets-alert-backup'
  if (Test-Path $assetsBackup) { Remove-Item $assetsBackup -Recurse -Force }
  New-Item -ItemType Directory -Path $assetsBackup -Force | Out-Null
  $assetsDir = Join-Path $dir 'assets'
  if (Test-Path $assetsDir) {
    Get-ChildItem $assetsDir -File | Where-Object { $_.Name -match '^(IMG_0607|alert-photo|alert-.*-custom)\.(jpg|jpeg|png|gif|webp)$' } | ForEach-Object {
      Copy-Item $_.FullName (Join-Path $assetsBackup $_.Name) -Force
    }
  }
  $soundsBackup = Join-Path $env:TEMP 'sounds-backup'
  if (Test-Path $soundsBackup) { Remove-Item $soundsBackup -Recurse -Force }
  New-Item -ItemType Directory -Path $soundsBackup -Force | Out-Null
  $soundsDir = Join-Path $dir 'sounds'
  if (Test-Path $soundsDir) {
    Get-ChildItem $soundsDir -File | Where-Object { $_.Name -like 'alert-*.*' } | ForEach-Object {
      Copy-Item $_.FullName (Join-Path $soundsBackup $_.Name) -Force
    }
  }

  # 4. copie des fichiers
  Copy-Item (Join-Path $src '*') -Destination $dir -Recurse -Force

  # 5. restaure tes cles, reglages, photos et sons custom
  if (Test-Path $secretsBackup) { Copy-Item $secretsBackup $secretsPath -Force }
  if (Test-Path $configBackup) { Copy-Item $configBackup $configPath -Force }
  if (Test-Path $assetsBackup) {
    if (-not (Test-Path $assetsDir)) { New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null }
    Get-ChildItem $assetsBackup -File | ForEach-Object {
      Copy-Item $_.FullName (Join-Path $assetsDir $_.Name) -Force
    }
  }
  if (Test-Path $soundsBackup) {
    if (-not (Test-Path $soundsDir)) { New-Item -ItemType Directory -Path $soundsDir -Force | Out-Null }
    Get-ChildItem $soundsBackup -File | ForEach-Object {
      Copy-Item $_.FullName (Join-Path $soundsDir $_.Name) -Force
    }
  }

  # 6. affiche la version
  if (Test-Path (Join-Path $dir 'VERSION.txt')) {
    (Get-Content (Join-Path $dir 'VERSION.txt') -Raw).Trim()
  } else {
    'OK'
  }
} catch {
  'ERREUR: ' + $_.Exception.Message
}
