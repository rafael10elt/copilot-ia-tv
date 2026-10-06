import os
import json
import time
from datetime import datetime, timezone
import mss
import numpy as np
import cv2
from supabase import create_client

SUPABASE_URL = "https://wvyllpbqtahxrqsjjzgp.supabase.co"
SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2eWxscGJxdGFoeHJxc2pqemdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMzU3NzEsImV4cCI6MjEwNjgxMTc3MX0.7qIsu2oZermD9uPA8ggSfNZuKDZH-_ifs2jJjeTX6XM"
supabase = create_client(SUPABASE_URL, SUPABASE_ANON)

CONFIG_FILE = "roi_config.json"

if not os.path.exists(CONFIG_FILE):
    print(f"[ERRO] Arquivo '{CONFIG_FILE}' não encontrado!")
    print("Execute: python calibrator.py primeiro para marcar a área do indicador.")
    exit(1)

with open(CONFIG_FILE, "r") as f:
    roi = json.load(f)

print("=" * 60)
print(f"🎯 LUMI SENTINEL INICIADO COM SUCESSO!")
print(f"📐 Monitorando ROI: {roi}")
print("📡 Enviando telemetria em tempo real para o Supabase...")
print("=" * 60)

sct = mss.mss()
last_state = "IDLE"
last_heartbeat = 0

def analisar_frame(img_bgr):
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)

    # Verde (Lime / Buy)
    lower_green = np.array([35, 120, 120])
    upper_green = np.array([85, 255, 255])
    mask_green = cv2.inRange(hsv, lower_green, upper_green)

    # Vermelho (Sell)
    lower_red1 = np.array([0, 120, 120])
    upper_red1 = np.array([10, 255, 255])
    lower_red2 = np.array([170, 120, 120])
    upper_red2 = np.array([180, 255, 255])
    mask_red = cv2.inRange(hsv, lower_red1, upper_red1) | cv2.inRange(hsv, lower_red2, upper_red2)

    green_pixels = cv2.countNonZero(mask_green)
    red_pixels = cv2.countNonZero(mask_red)

    threshold = 20
    if green_pixels > threshold and green_pixels > red_pixels:
        return "BUY"
    elif red_pixels > threshold and red_pixels > green_pixels:
        return "SELL"
    return "AGUARDANDO FVG"

try:
    while True:
        screenshot = sct.grab(roi)
        frame = np.array(screenshot)
        frame_bgr = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)

        estado_atual = analisar_frame(frame_bgr)
        agora = time.time()

        # Heartbeat a cada 2 segundos para o PWA saber que a visão computacional está viva
        if agora - last_heartbeat >= 2.0:
            last_heartbeat = agora
            try:
                supabase.table("sentinel_status").update({
                    "is_online": True,
                    "current_state": estado_atual,
                    "last_seen": datetime.now(timezone.utc).isoformat(),
                    "monitored_symbol": "MNQ1! (NASDAQ)"
                }).eq("id", 1).execute()
            except Exception:
                pass

        # Disparo de Nova Oportunidade
        if estado_atual != last_state:
            if estado_atual in ["BUY", "SELL"]:
                print(f"\n🚀 [GATILHO DETECTADO]: {estado_atual} em {datetime.now().strftime('%H:%M:%S')}")
                try:
                    supabase.table("lumi_signals").insert({
                        "symbol": "MNQ1! (NASDAQ)",
                        "direction": estado_atual,
                        "status": "ACTIVE",
                        "info": "Confirmado pelo Lumi FVG PRO na tela"
                    }).execute()
                    print("✅ Sincronizado com o Supabase e disparado para o PWA!")
                except Exception as e:
                    print(f"⚠️ Erro ao inserir sinal: {e}")

            elif estado_atual == "AGUARDANDO FVG":
                print(".", end="", flush=True)

            last_state = estado_atual

        time.sleep(0.3)

except KeyboardInterrupt:
    print("\n🛑 Sentinela pausada pelo usuário.")
    supabase.table("sentinel_status").update({"is_online": False, "current_state": "PAUSADO"}).eq("id", 1).execute()