@echo off
rem Windows launcher: ensures Node.js >= 20.12 (installs the LTS via winget if missing),
rem then hands over to bin\cli.js (dependencies, build, .env checks).
rem Usage: run.cmd [server|cmd|generate-all|purge-plaintext|check|prepare]
rem All launcher output goes to stderr: stdout is reserved for the MCP JSON-RPC stream.
setlocal
cd /d "%~dp0"
set "NODE_EXE=node"

call :node_ok
if not errorlevel 1 goto run

echo [mcp-pr-companion] Node.js ^>= 20.12 not found. Installing Node.js LTS via winget... 1>&2
where winget >nul 2>nul
if errorlevel 1 (
  echo [mcp-pr-companion] winget is not available. Install Node.js LTS from https://nodejs.org and run again. 1>&2
  exit /b 1
)
winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements 1>&2
rem The current shell does not see the new PATH yet: point to the default install location.
set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
set "PATH=%ProgramFiles%\nodejs;%PATH%"
call :node_ok
if errorlevel 1 (
  echo [mcp-pr-companion] Node.js installation failed. Install Node.js LTS from https://nodejs.org and run again. 1>&2
  exit /b 1
)

:run
"%NODE_EXE%" bin\cli.js %*
exit /b %errorlevel%

:node_ok
"%NODE_EXE%" -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=12)?0:1)" >nul 2>nul
exit /b %errorlevel%
