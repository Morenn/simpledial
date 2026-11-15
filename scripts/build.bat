@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "NODE_CMD="

if defined NODE_BIN (
  if exist "%NODE_BIN%" set "NODE_CMD=%NODE_BIN%"
)

if not defined NODE_CMD (
  for /f "delims=" %%I in ('where node 2^>nul') do (
    if not defined NODE_CMD set "NODE_CMD=%%I"
  )
)

if not defined NODE_CMD (
  if exist "C:\Program Files\nodejs\node.exe" set "NODE_CMD=C:\Program Files\nodejs\node.exe"
)

if not defined NODE_CMD (
  if exist "C:\Program Files\AMD\AI_Bundle\LMStudio\resources\app\.webpack\bin\node.exe" (
    set "NODE_CMD=C:\Program Files\AMD\AI_Bundle\LMStudio\resources\app\.webpack\bin\node.exe"
  )
)

if not defined NODE_CMD (
  echo Error: node.exe not found in PATH. Install Node.js or set NODE_BIN. 1>&2
  exit /b 1
)

"%NODE_CMD%" "%SCRIPT_DIR%build.mjs" %*
exit /b %ERRORLEVEL%
