$ErrorActionPreference = 'Stop'

Write-Host 'Card do Vendedor - compilação do instalador Windows' -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js não encontrado. Instale uma versão LTS do Node.js e tente novamente.'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'npm não encontrado. Reinstale o Node.js incluindo o npm.'
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw 'Rust/Cargo não encontrado. Instale Rust pelo rustup e reabra o PowerShell.'
}

npm install
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar as dependências npm.' }

npm run build:windows
if ($LASTEXITCODE -ne 0) { throw 'A compilação falhou. Confira os pré-requisitos e a mensagem do Tauri/Rust.' }

Write-Host ''
Write-Host 'Compilação concluída. Procure os instaladores em:' -ForegroundColor Green
Write-Host 'src-tauri\target\release\bundle\nsis\'
Write-Host 'src-tauri\target\release\bundle\msi\'
