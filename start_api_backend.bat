@echo off
cd /d C:\Users\gomgu\Desktop\betpro
C:\Users\gomgu\AppData\Local\Programs\Python\Python312\python.exe -m uvicorn api.main:app --reload --port 8000 >> C:\Users\gomgu\Desktop\betpro\api_autostart.log 2>&1
