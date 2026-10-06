import os
import sys
import json
import time
import re
import threading
from datetime import datetime, timezone
import tkinter as tk
from tkinter import messagebox
from PIL import Image, ImageTk
import mss
import numpy as np
import cv2
from supabase import create_client

# Tenta importar win32gui para ler o título da janela do TradingView
try:
    import win32gui
    HAS_WIN32 = True
except ImportError:
    HAS_WIN32 = False

# Diretório base
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, "roi_config.json")

# Configurações do Supabase
SUPABASE_URL = "https://wvyllpbqtahxrqsjjzgp.supabase.co"
SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2eWxscGJxdGFoeHJxc2pqemdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMzU3NzEsImV4cCI6MjEwNjgxMTc3MX0.7qIsu2oZermD9uPA8ggSfNZuKDZH-_ifs2jJjeTX6XM"
supabase = create_client(SUPABASE_URL, SUPABASE_ANON)


def detectar_ativo_tradingview():
    """
    Varre as janelas abertas do Windows para extrair o Ticker ativo no TradingView
    Exemplos: 'XAUUSD', 'MNQ1!', 'NQ1!', 'US30'
    """
    if not HAS_WIN32:
        return "MNQ1! (NASDAQ)"

    simbolo_encontrado = None

    def enum_callback(hwnd, extra):
        nonlocal simbolo_encontrado
        if win32gui.IsWindowVisible(hwnd):
            titulo = win32gui.GetWindowText(hwnd)
            # Verifica se é uma janela do TradingView Desktop ou Navegador
            if "TradingView" in titulo:
                # O título costuma iniciar com o ticker: 'XAUUSD 1 • Pepperstone...'
                tokens = titulo.replace("—", " ").replace("-", " ").split()
                for token in tokens:
                    candidato = token.replace(",", "").strip().upper()
                    # Expressão regular para validar formato de Tickers de Mercado
                    if re.match(r"^[A-Z0-9!._]{3,10}$", candidato) and candidato not in ["TRADINGVIEW", "CHROME", "EDGE"]:
                        simbolo_encontrado = candidato
                        break

    try:
        win32gui.EnumWindows(enum_callback, None)
    except Exception:
        pass

    return simbolo_encontrado if simbolo_encontrado else "MNQ1!"


class IntegratedCalibrator:
    """Calibrador com overlay transparente sobre a tela"""
    def __init__(self, parent_gui):
        self.parent_gui = parent_gui
        self.top = tk.Toplevel()
        self.top.attributes('-alpha', 0.25)
        self.top.attributes('-fullscreen', True)
        self.top.attributes('-topmost', True)
        self.top.config(cursor="cross")

        self.canvas = tk.Canvas(self.top, cursor="cross", bg="#38bdf8")
        self.canvas.pack(fill="both", expand=True)

        self.canvas.bind("<ButtonPress-1>", self.on_press)
        self.canvas.bind("<B1-Motion>", self.on_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_release)
        self.top.bind("<Escape>", lambda e: self.cancelar())

        self.start_x = None
        self.start_y = None
        self.rect = None

    def on_press(self, event):
        self.start_x = event.x
        self.start_y = event.y
        self.rect = self.canvas.create_rectangle(self.start_x, self.start_y, self.start_x, self.start_y, outline='#ef4444', width=3)

    def on_drag(self, event):
        self.canvas.coords(self.rect, self.start_x, self.start_y, event.x, event.y)

    def on_release(self, event):
        end_x, end_y = event.x, event.y
        x1, x2 = min(self.start_x, end_x), max(self.start_x, end_x)
        y1, y2 = min(self.start_y, end_y), max(self.start_y, end_y)

        coords = {"top": y1, "left": x1, "width": x2 - x1, "height": y2 - y1}

        if coords["width"] > 10 and coords["height"] > 10:
            with open(CONFIG_FILE, "w") as f:
                json.dump(coords, f, indent=4)
            self.top.destroy()
            self.parent_gui.on_calibrated(coords)
        else:
            self.top.destroy()
            self.parent_gui.root.deiconify()

    def cancelar(self):
        self.top.destroy()
        self.parent_gui.root.deiconify()


class SentinelMasterApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Lumi Copilot • Sentinel Desktop")
        self.root.geometry("440x530")
        self.root.configure(bg="#070b14")
        self.root.resizable(False, False)
        self.root.attributes('-topmost', True)

        self.running = False
        self.sct = mss.mss()
        self.roi = None
        self.ativo_atual = "DETECTANDO..."
        self.carregar_roi()

        # HEADER
        header = tk.Frame(root, bg="#0d1527", pady=12, padx=16)
        header.pack(fill="x")
        tk.Label(header, text="⚡ LUMI SENTINEL", font=("Segoe UI", 12, "bold"), fg="#38bdf8", bg="#0d1527").pack(side="left")
        self.lbl_status = tk.Label(header, text="🔴 DESLIGADO", font=("Segoe UI", 9, "bold"), fg="#f87171", bg="#0d1527")
        self.lbl_status.pack(side="right")

        # CONTAINER PRINCIPAL
        main = tk.Frame(root, bg="#070b14", padx=20, pady=15)
        main.pack(fill="both", expand=True)

        tk.Label(main, text="PRÉVIA DO RECORTE (ÁREA DO STATUS):", font=("Segoe UI", 8, "bold"), fg="#94a3b8", bg="#070b14").pack(anchor="w")

        # Caixa de Preview
        preview_frame = tk.Frame(main, bg="#020617", bd=1, relief="solid")
        preview_frame.pack(fill="x", pady=(6, 12))

        self.preview_lbl = tk.Label(preview_frame, bg="#020617", height=4, text="Nenhuma área calibrada ainda", fg="#64748b", font=("Segoe UI", 9))
        self.preview_lbl.pack(fill="both", padx=4, pady=4)

        # Informações da Operação
        info_box = tk.Frame(main, bg="#0d1527", padx=14, pady=10)
        info_box.pack(fill="x", pady=(0, 15))

        self.lbl_ativo = tk.Label(info_box, text="Ativo: Detectando...", font=("Segoe UI", 9, "bold"), fg="#a855f7", bg="#0d1527")
        self.lbl_ativo.pack(anchor="w")

        self.lbl_leitura = tk.Label(info_box, text="Estado: Aguardando Inicialização", font=("Segoe UI", 9), fg="#ffffff", bg="#0d1527")
        self.lbl_leitura.pack(anchor="w", pady=(2, 0))

        self.lbl_gatilho = tk.Label(info_box, text="Último Gatilho: Nenhum", font=("Segoe UI", 9), fg="#94a3b8", bg="#0d1527")
        self.lbl_gatilho.pack(anchor="w", pady=(2, 0))

        # BOTÕES
        self.btn_calibrar = tk.Button(main, text="🎯 1. CALIBRAR ÁREA DO GRÁFICO", font=("Segoe UI", 10, "bold"), bg="#1e293b", fg="#38bdf8", activebackground="#334155", relief="flat", pady=9, command=self.iniciar_calibracao, cursor="hand2")
        self.btn_calibrar.pack(fill="x", pady=(0, 8))

        self.btn_toggle = tk.Button(main, text="▶️ 2. INICIAR SENTINELA", font=("Segoe UI", 10, "bold"), bg="#10b981", fg="#ffffff", activebackground="#059669", relief="flat", pady=10, command=self.toggle_sentinel, cursor="hand2")
        self.btn_toggle.pack(fill="x")

        # RODAPÉ
        tk.Label(root, text="TradingView Free Sentinel • Suporta MNQ, XAUUSD e outros", font=("Segoe UI", 8), fg="#475569", bg="#070b14", pady=8).pack(side="bottom")

        # Inicia loop de pré-visualização e identificação do ativo
        self.root.after(300, self.atualizar_preview_loop)

    def carregar_roi(self):
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r") as f:
                    self.roi = json.load(f)
            except Exception:
                self.roi = None

    def iniciar_calibracao(self):
        self.root.withdraw()
        self.root.after(400, lambda: IntegratedCalibrator(self))

    def on_calibrated(self, coords):
        self.roi = coords
        self.root.deiconify()
        self.lbl_leitura.config(text="Estado: Área recalibrada com sucesso!", fg="#38bdf8")
        self.atualizar_preview_manual()

    def atualizar_preview_manual(self):
        if not self.roi: return
        try:
            shot = self.sct.grab(self.roi)
            img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
            img = img.resize((380, 55), Image.Resampling.LANCZOS)
            img_tk = ImageTk.PhotoImage(img)
            self.preview_lbl.config(image=img_tk, text="")
            self.preview_lbl.image = img_tk
        except Exception:
            pass

    def atualizar_preview_loop(self):
        # Atualiza o ativo detectado na tela mesmo com o monitor pausado
        self.ativo_atual = detectar_ativo_tradingview()
        self.lbl_ativo.config(text=f"Ativo Detectado: {self.ativo_atual}")

        if self.roi and not self.running:
            self.atualizar_preview_manual()

        self.root.after(1000, self.atualizar_preview_loop)

    def toggle_sentinel(self):
        if not self.running:
            if not self.roi:
                messagebox.showwarning("Calibração Necessária", "Clique primeiro no botão '1. CALIBRAR ÁREA DO GRÁFICO'!")
                return
            self.running = True
            self.lbl_status.config(text="🟢 VIGIANDO GRÁFICO", fg="#34d399")
            self.btn_toggle.config(text="⏸️ PAUSAR SENTINELA", bg="#eab308")
            threading.Thread(target=self.worker_monitoramento, daemon=True).start()
        else:
            self.running = False
            self.lbl_status.config(text="🔴 PAUSADO", fg="#f87171")
            self.btn_toggle.config(text="▶️ INICIAR SENTINELA", bg="#10b981")
            try:
                supabase.table("sentinel_status").update({
                    "is_online": False, 
                    "current_state": "PAUSADO"
                }).eq("id", 1).execute()
            except Exception:
                pass

    def worker_monitoramento(self):
        last_state = "IDLE"
        last_hb = 0

        while self.running:
            try:
                shot = self.sct.grab(self.roi)
                frame = np.array(shot)
                frame_bgr = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)

                # Atualiza a janelinha com o frame atual
                img_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
                img_pil = Image.fromarray(img_rgb).resize((380, 55), Image.Resampling.LANCZOS)
                img_tk = ImageTk.PhotoImage(img_pil)
                self.preview_lbl.config(image=img_tk, text="")
                self.preview_lbl.image = img_tk

                # Análise HSV (Foco nos tons vibrantes de Compra e Venda)
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

                self.lbl_leitura.config(text=f"Estado: {estado_atual}")

                # Heartbeat de telemetria para o Supabase (a cada 2 segundos)
                agora = time.time()
                if agora - last_hb >= 2.0:
                    last_hb = agora
                    supabase.table("sentinel_status").update({
                        "is_online": True,
                        "current_state": estado_atual,
                        "last_seen": datetime.now(timezone.utc).isoformat(),
                        "monitored_symbol": self.ativo_atual
                    }).eq("id", 1).execute()

                # Disparo de Novo Trade
                if estado_atual != last_state:
                    if estado_atual in ["BUY", "SELL"]:
                        cor = "#34d399" if estado_atual == "BUY" else "#f87171"
                        hora = datetime.now().strftime("%H:%M:%S")
                        self.lbl_gatilho.config(text=f"Último Gatilho: {estado_atual} em {self.ativo_atual} ({hora})", fg=cor)

                        # Envia sinal dinâmico para a nuvem
                        supabase.table("lumi_signals").insert({
                            "symbol": self.ativo_atual,
                            "direction": estado_atual,
                            "status": "ACTIVE",
                            "info": f"Gatilho confirmado no indicador Lumi FVG PRO ({self.ativo_atual})"
                        }).execute()

                    last_state = estado_atual

                time.sleep(0.3)

            except Exception:
                time.sleep(1)


if __name__ == "__main__":
    root = tk.Tk()
    app = SentinelMasterApp(root)
    root.mainloop()