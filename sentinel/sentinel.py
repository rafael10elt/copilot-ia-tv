import os
import json
import time
import threading
from datetime import datetime, timezone
import tkinter as tk
from tkinter import messagebox
from PIL import Image, ImageTk
import mss
import numpy as np
import cv2
from supabase import create_client

SUPABASE_URL = "https://wvyllpbqtahxrqsjjzgp.supabase.co"
SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2eWxscGJxdGFoeHJxc2pqemdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMzU3NzEsImV4cCI6MjEwNjgxMTc3MX0.7qIsu2oZermD9uPA8ggSfNZuKDZH-_ifs2jJjeTX6XM"
supabase = create_client(SUPABASE_URL, SUPABASE_ANON)

CONFIG_FILE = "roi_config.json"
running = False

class SentinelGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("⚡ Lumi Sentinel - TradingView Desk")
        self.root.geometry("400x480")
        self.root.configure(bg="#020617")
        self.root.resizable(False, False)

        # Header
        header = tk.Frame(root, bg="#0f172a", pady=10, padx=15)
        header.pack(fill="x")
        tk.Label(header, text="⚡ LUMI SENTINEL", font=("Segoe UI", 12, "bold"), fg="#38bdf8", bg="#0f172a").pack(side="left")
        self.lbl_status = tk.Label(header, text="🔴 DESLIGADO", font=("Segoe UI", 9, "bold"), fg="#f87171", bg="#0f172a")
        self.lbl_status.pack(side="right")

        # Container Central
        main_frame = tk.Frame(root, bg="#020617", padx=20, pady=15)
        main_frame.pack(fill="both", expand=True)

        tk.Label(main_frame, text="PRÉVIA DO RECORTE (ROI ATIVO):", font=("Segoe UI", 8, "bold"), fg="#94a3b8", bg="#020617").pack(anchor="w", pady=(0, 5))
        
        # Canvas de Pré-visualização do recorte
        self.preview_canvas = tk.Label(main_frame, bg="#0f172a", width=45, height=5, text="Sem captura ativa", fg="#64748b", font=("Consolas", 8))
        self.preview_canvas.pack(fill="x", pady=(0, 10))

        # Status de Leitura
        self.lbl_detalhes = tk.Label(main_frame, text="Estado: Aguardando inicialização...", font=("Segoe UI", 9), fg="#e2e8f0", bg="#020617")
        self.lbl_detalhes.pack(pady=5)

        self.lbl_trigger = tk.Label(main_frame, text="Último Gatilho: Nenhum", font=("Segoe UI", 9, "bold"), fg="#94a3b8", bg="#020617")
        self.lbl_trigger.pack(pady=5)

        # Botões
        self.btn_toggle = tk.Button(main_frame, text="▶️ INICIAR MONITORAMENTO", font=("Segoe UI", 10, "bold"), bg="#10b981", fg="#ffffff", activebackground="#059669", relief="flat", pady=8, command=self.toggle_sentinel, cursor="hand2")
        self.btn_toggle.pack(fill="x", pady=(15, 6))

        btn_calib = tk.Button(main_frame, text="🎯 RECALIBRAR ÁREA (ROI)", font=("Segoe UI", 9), bg="#1e293b", fg="#cbd5e1", activebackground="#334155", relief="flat", pady=6, command=self.abrir_calibrador, cursor="hand2")
        btn_calib.pack(fill="x", pady=2)

        # Rodapé
        tk.Label(root, text="TradingView Free Sentinel • Nasdaq MNQ", font=("Segoe UI", 8), fg="#475569", bg="#020617", pady=8).pack(side="bottom")

    def abrir_calibrador(self):
        os.system("python calibrator.py")

    def toggle_sentinel(self):
        global running
        if not running:
            if not os.path.exists(CONFIG_FILE):
                messagebox.showerror("Erro", "Arquivo roi_config.json não encontrado!\nClique em 'RECALIBRAR ÁREA' primeiro.")
                return
            running = True
            self.lbl_status.config(text="🟢 ATIVO (LENDO TELA)", fg="#34d399")
            self.btn_toggle.config(text="⏸️ PAUSAR MONITORAMENTO", bg="#eab308")
            threading.Thread(target=self.loop_monitoramento, daemon=True).start()
        else:
            running = False
            self.lbl_status.config(text="🔴 PAUSADO", fg="#f87171")
            self.btn_toggle.config(text="▶️ INICIAR MONITORAMENTO", bg="#10b981")
            try:
                supabase.table("sentinel_status").update({"is_online": False, "current_state": "PAUSADO"}).eq("id", 1).execute()
            except Exception:
                pass

    def loop_monitoramento(self):
        with open(CONFIG_FILE, "r") as f:
            roi = json.load(f)

        sct = mss.mss()
        last_state = "IDLE"
        last_hb = 0

        while running:
            try:
                screenshot = sct.grab(roi)
                frame = np.array(screenshot)
                frame_bgr = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)

                # Atualiza a pré-visualização na janelinha
                img_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
                img_pil = Image.fromarray(img_rgb).resize((340, 50))
                img_tk = ImageTk.PhotoImage(img_pil)
                self.preview_canvas.config(image=img_tk, text="")
                self.preview_canvas.image = img_tk

                # Análise de Cores HSV
                hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
                mask_green = cv2.inRange(hsv, np.array([35, 120, 120]), np.array([85, 255, 255]))
                mask_red = cv2.inRange(hsv, np.array([0, 120, 120]), np.array([10, 255, 255])) | cv2.inRange(hsv, np.array([170, 120, 120]), np.array([180, 255, 255]))

                g_pix = cv2.countNonZero(mask_green)
                r_pix = cv2.countNonZero(mask_red)
                threshold = 20

                if g_pix > threshold and g_pix > r_pix:
                    estado_atual = "BUY"
                elif r_pix > threshold and r_pix > g_pix:
                    estado_atual = "SELL"
                else:
                    estado_atual = "AGUARDANDO FVG"

                self.lbl_detalhes.config(text=f"Estado: {estado_atual}")

                # Heartbeat de telemetria para a nuvem
                agora = time.time()
                if agora - last_hb >= 2.0:
                    last_hb = agora
                    supabase.table("sentinel_status").update({
                        "is_online": True,
                        "current_state": estado_atual,
                        "last_seen": datetime.now(timezone.utc).isoformat(),
                        "monitored_symbol": "MNQ1! (NASDAQ)"
                    }).eq("id", 1).execute()

                # Disparo de novo trade
                if estado_atual != last_state:
                    if estado_atual in ["BUY", "SELL"]:
                        cor = "#34d399" if estado_atual == "BUY" else "#f87171"
                        hora = datetime.now().strftime("%H:%M:%S")
                        self.lbl_trigger.config(text=f"Último Gatilho: {estado_atual} ({hora})", fg=cor)

                        supabase.table("lumi_signals").insert({
                            "symbol": "MNQ1! (NASDAQ)",
                            "direction": estado_atual,
                            "status": "ACTIVE",
                            "info": "Gatilho confirmado na tela"
                        }).execute()

                    last_state = estado_atual

                time.sleep(0.3)

            except Exception as e:
                time.sleep(1)

if __name__ == "__main__":
    root = tk.Tk()
    app = SentinelGUI(root)
    root.mainloop()