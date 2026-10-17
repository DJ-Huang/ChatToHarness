# Windows source launcher. Run installers from Releases for regular use.
param([switch]$Dev)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$projectRoot = $PSScriptRoot
$appPath = Join-Path $projectRoot 'dist\win-unpacked\ChatToHarness.exe'
$buildStamp = Join-Path $projectRoot '.cache\build-stamp'
$nodeVersion = '24.22.0'
$nodeSha = 'f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3'
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
  throw 'ChatToHarness requires Windows x64.'
}
if ([Environment]::OSVersion.Version.Build -lt 22000) { throw 'ChatToHarness requires Windows 11 or newer.' }
Set-Location -LiteralPath $projectRoot
$sourcePaths = @('app','scripts','vendor','assets','native','package.json','package-lock.json','electron-builder.config.cjs','Start.ps1','Start.cmd','README.md','ARCHITECTURE.md','LICENSE','THIRD_PARTY_NOTICES.md')
$needsBuild = -not ((Test-Path -LiteralPath $appPath) -and (Test-Path -LiteralPath $buildStamp))
if (-not $needsBuild) {
  $stampTime = (Get-Item -LiteralPath $buildStamp).LastWriteTimeUtc
  foreach ($entry in $sourcePaths) {
    $source = Join-Path $projectRoot $entry
    if ((Test-Path -LiteralPath $source) -and (Get-ChildItem -LiteralPath $source -Recurse -File | Where-Object LastWriteTimeUtc -gt $stampTime | Select-Object -First 1)) { $needsBuild = $true; break }
  }
}
if (-not $Dev -and -not $needsBuild) { Start-Process -FilePath $appPath; exit 0 }
$cache = Join-Path $projectRoot '.cache'
New-Item -ItemType Directory -Path $cache -Force | Out-Null
$lockPath = Join-Path $cache 'windows-start.lock'
try { $startLock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
catch { Write-Host 'Another ChatToHarness launcher is preparing the application. Please wait.'; exit 0 }
try {
  $nodeRoot = Join-Path $projectRoot 'resources\node'
  $nodeExe = Join-Path $nodeRoot 'node.exe'
  $nodeReceipt = Join-Path $nodeRoot '.chatharness-node.json'
  $nodeReady = $false
  if ((Test-Path -LiteralPath $nodeExe) -and (Test-Path -LiteralPath $nodeReceipt)) {
    try {
      if ((Get-Item -LiteralPath $nodeReceipt).Length -le 1024) {
        $savedNode = Get-Content -LiteralPath $nodeReceipt -Raw | ConvertFrom-Json
        $nodeReady = $savedNode.platform -eq 'win32-x64' -and $savedNode.archiveSha256 -eq $nodeSha -and $savedNode.binarySha256 -eq (Get-FileHash -LiteralPath $nodeExe -Algorithm SHA256).Hash.ToLowerInvariant()
      }
    } catch { $nodeReady = $false }
  }
  if (-not $nodeReady) {
    Write-Host 'First launch: preparing the verified runtime...'
    $downloadRoot = Join-Path $cache 'downloads'
    New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null
    $archiveName = "node-v$nodeVersion-win-x64.zip"
    $archive = Join-Path $downloadRoot $archiveName
    if (-not (Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $nodeSha) {
      $part = "$archive.part"
      Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$nodeVersion/$archiveName" -OutFile $part
      if ((Get-FileHash -LiteralPath $part -Algorithm SHA256).Hash.ToLowerInvariant() -ne $nodeSha) { Remove-Item -LiteralPath $part -Force; throw 'Runtime download checksum mismatch. Please retry.' }
      Move-Item -LiteralPath $part -Destination $archive -Force
    }
    $extract = "$nodeRoot.prepare"
    if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
    Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
    if (Test-Path -LiteralPath $nodeRoot) { Remove-Item -LiteralPath $nodeRoot -Recurse -Force }
    Move-Item -LiteralPath (Join-Path $extract "node-v$nodeVersion-win-x64") -Destination $nodeRoot
    Remove-Item -LiteralPath $extract -Recurse -Force
    # prepareNode must recognize this verified bootstrap, rather than trying
    # to replace the node.exe that is running preparation on Windows.
    $installedNode = @{ platform = 'win32-x64'; archiveSha256 = $nodeSha; binarySha256 = (Get-FileHash -LiteralPath $nodeExe -Algorithm SHA256).Hash.ToLowerInvariant() }
    [IO.File]::WriteAllText($nodeReceipt, ($installedNode | ConvertTo-Json -Compress))
  }
  $env:PATH = "$nodeRoot;$env:PATH"
  $npmCli = Join-Path $nodeRoot 'node_modules\npm\bin\npm-cli.js'
  $dependencyStamp = Join-Path $projectRoot 'node_modules\.chatharness-lock'
  $lockHash = (Get-FileHash -LiteralPath (Join-Path $projectRoot 'package-lock.json') -Algorithm SHA256).Hash
  $stampedHash = if (Test-Path -LiteralPath $dependencyStamp) { (Get-Content -LiteralPath $dependencyStamp -Raw).Trim() } else { '' }
  if ($stampedHash -ne $lockHash -or -not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'))) {
    & $nodeExe $npmCli ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency setup failed.' }
    [IO.File]::WriteAllText($dependencyStamp, $lockHash)
  }
  if ($Dev) {
    & $nodeExe (Join-Path $projectRoot 'scripts\dev.cjs') --prepare-only
    if ($LASTEXITCODE -ne 0) { throw 'Development components could not be prepared.' }
  } else {
    & $nodeExe (Join-Path $projectRoot 'scripts\build.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }
    Start-Process -FilePath $appPath
  }
} finally { $startLock.Dispose() }
if ($Dev) {
  & $nodeExe (Join-Path $projectRoot 'scripts\dev.cjs')
  exit $LASTEXITCODE
}
