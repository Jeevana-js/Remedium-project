@echo off
echo === Remedium Backend ===
cd /d "%~dp0backend"
call .venv\Scripts\activate.bat
echo Starting FastAPI on http://localhost:8000
.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir app
