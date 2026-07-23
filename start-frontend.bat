@echo off
echo === Remedium Frontend ===
cd frontend

if not exist node_modules (
    echo Installing npm packages...
    npm install
)

echo Starting Vite dev server on http://localhost:5173
npm run dev
