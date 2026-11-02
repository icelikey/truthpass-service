param(
  [int]$LocalPort = 5180
)

$key = if ($env:TRUTHPASS_SSH_KEY) { $env:TRUTHPASS_SSH_KEY } else { Join-Path $HOME '.ssh\truthpass-csmy.pem' }
if (-not (Test-Path -LiteralPath $key)) {
  throw "SSH key not found: $key"
}
$sshArgs = @(
  '-i', $key,
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'ServerAliveInterval=30',
  '-o', 'ServerAliveCountMax=3',
  '-o', 'ExitOnForwardFailure=yes',
  '-N',
  '-L', "$LocalPort`:127.0.0.1:80",
  'ubuntu@106.52.107.169'
)

while ($true) {
  $process = Start-Process -FilePath 'ssh.exe' -ArgumentList $sshArgs -PassThru -Wait
  Start-Sleep -Seconds 3
}
