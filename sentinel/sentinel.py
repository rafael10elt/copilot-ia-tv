import os
import json
import time
import mss
import numpy as np
import cv2
from supabase import create_client

# Configurações do Supabase (Insira as suas credenciais)
SUPABASE_URL = "https://wvyllpbqtahxrqsjjzgp.supabase.co"
SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2eWxscGJxdGFoeHJxc2pqemdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMzU3NzEsImV4cCI6MjEwNjgxMTc3MX0.7qIsu2oZermD9uPA8ggSfNZuKDZH-_ifs2jJjeTX6XM"
supabase = create_client(SUPABASE_URL, SUPABASE_ANON)

CONFIG_FILE = "roi_config.json"

if not os.path.exists(CONFIG_FILE):
    print(f"[ERRO] Arquivo '{CONFIG_FILE}' não encontrado. Execute 'python calibrator.py' primeiro!")
    exit(1)

with open(CONFIG_FILE, "r") as f:
    roi = json.load(f)

print(f"🎯 Sentinel ativo monitorando ROI: {roi}")
print("Pressione CTRL + C para interromper.")

sct = mss.mss()
last_state = "IDLE"  # "IDLE", "BUY", "SELL"

def analisar_frame(img_bgr):
    """
    Analisa a presença de tons fortes de Verde (Buy) ou Vermelho (Sell) no espaço HSV
    """
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)

    # Máscara para Verde Brilhante (Lime / Bullish FVG)
    lower_green = np.array([35, 120, 120])
    upper_green = np.array([85, 255, 255])
    mask_green = cv2.inRange(hsv, lower_green, upper_green)

    # Máscara para Vermelho (Bearish FVG)
    lower_red1 = np.array([0, 120, 120])
    upper_red1 = np.array([10, 255, 255])
    lower_red2 = np.array([170, 120, 120])
    upper_red2 = np.array([180, 255, 255])
    mask_red = cv2.inRange(hsv, lower_red1, upper_red1) | cv2.inRange(hsv, lower_red2, upper_red2)

    green_pixels = cv2.countNonZero(mask_green)
    red_pixels = cv2.countNonZero(mask_red)

    # Se houver uma quantidade significativa de pixels coloridos (texto/borda ativos)
    threshold = 25  # Quantidade mínima de pixels para acusar sinal
    if green_pixels > threshold and green_pixels > red_pixels:
        return "BUY"
    elif red_pixels > threshold and red_pixels > green_pixels:
        return "SELL"
    return "IDLE"

try:
    while True:
        # Captura apenas os pixels da caixa da tabela
        screenshot = sct.grab(roi)
        frame = np.array(screenshot)
        frame_bgr = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)

        estado_atual = analisar_frame(frame_bgr)

        # Máquina de estados para evitar envios duplicados
        if estado_atual != last_state:
            if estado_atual in ["BUY", "SELL"]:
                print(f"\n🚀 [NOVA OPORTUNIDADE DETECTADA]: {estado_atual}")
                
                # Envia para o Supabase
                try:
                    res = supabase.table("lumi_signals").insert({
                        "symbol": "NASDAQ / MNQ", # Ou dinâmico
                        "direction": estado_atual,
                        "status": "ACTIVE",
                        "info": "Gatilho confirmado pelo indicador no TradingView"
                    }).execute()
                    print(f"📡 Sinal sincronizado no Supabase com sucesso!")
                except Exception as e:
                    print(f"⚠️ Erro ao enviar ao Supabase: {e}")

            elif estado_atual == "IDLE":
                print(".", end="", flush=True)

            last_state = estado_atual

        time.sleep(0.3) # 3 checagens por segundo (CPU < 0.5%)

except KeyboardInterrupt:
    print("\n🛑 Sentinela encerrado.")