@echo off
REM Optional natural voice. Needs Python 3.10+ and ~6 GB free disk for the first model download.
cd /d "%~dp0"
where python >nul 2>nul || (echo Python 3.10 or newer is required: https://python.org & pause & exit /b 1)
if not exist .venv-omnivoice (
  python -m venv .venv-omnivoice
  call .venv-omnivoice\Scripts\activate
  pip install torch torchaudio
  pip install -r voice\omnivoice-server\requirements.txt
) else (
  call .venv-omnivoice\Scripts\activate
)
python voice\omnivoice-server\server.py
pause
