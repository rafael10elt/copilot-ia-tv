import os
import sys
import json
import time
import re
import threading
import ctypes
from datetime import datetime, timezone
import tkinter as tk
from tkinter import messagebox
from PIL import Image, ImageTk
import mss
import numpy as np
import cv2
from supabase import create_client

# 1. ATIVA SUPORTE DPI DO WINDOWS (100% dos pixels físicos)
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

# 2. DETECÇÃO DE JANELAS WINDOWS
try:
    import win32gui
    HAS_WIN32 = True
except ImportError:
    HAS_WIN32 = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, "roi_config.json")

SUPABASE_URL = "https://wvyllpbqtahxrqsjjzgp.supabase.co"
SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2eWxscGJxdGFoeHJxc2pqemdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMzU3NzEsImV4cCI6MjEwNjgxMTc3MX0.7qIsu2oZermD9uPA8ggSfNZuKDZH-_ifs2jJjeTX6XM"
supabase = create_client(SUPABASE_URL, SUPABASE_ANON)


def detectar_ativo_tradingview():
    """
    Varre as janelas e extrai dinamicamente a primeira palavra (o Ticker)
    Ex: 'USOIL ▼ 89,83...' -> 'USOIL'
    Ex: 'XAUUSD ▲ 4.167...' -> 'XAUUSD'
    Ex: 'MNQ1! 1 • CME...' -> 'MNQ1!'
    """
    if not HAS_WIN32:
        return "XAUUSD"

    simbolo = None

    def enum_cb(hwnd, _):
        nonlocal simbolo
        if win32gui.IsWindowVisible(hwnd):
            tit = win32gui.GetWindowText(hwnd).strip()
            # Identifica a janela de gráfico do TradingView
            if "TradingView" in tit or "Lumitrader" in tit or "Ouro" in tit or "CFDs" in tit:
                # Remove caracteres unicode de setas e separadores
                limpo = tit.replace("▲", " ").replace("▼", " ").replace("—", " ").replace("-", " ")
                partes = limpo.split()
                if partes:
                    candidato = partes[0].replace(",", "").replace(":", "").strip().upper()
                    # Ticker válido (3 a 10 caracteres alfanuméricos com pontuação comum de futuros)
                    if re.match(r"^[A-Z0-9!._]{2,10}$", candidato) and candidato not in ["TRADINGVIEW", "CHROME", "EDGE"]:
                        simbolo = candidato

    try:
        win32gui.EnumWindows(enum_cb, None)
    except Exception:
        pass

    return simbolo if simbolo else "ATIVO ATUAL"


class FullscreenCalibrator:
    """Calibrador de tela cheia DPI-Aware"""
    def __init__(self, parent_gui):
        self.parent = parent_gui
        self.top = tk.Toplevel()
        
        user32 = ctypes.windll.user32
        sw, sh = user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
        self.top.geometry(f"{sw}x{sh}+0+0")
        
        self.top.attributes('-alpha', 0.28)
        self.top.attributes('-fullscreen', True)
        self.top.attributes('-topmost', True)
        self.top.config(cursor="cross")

        self.canvas = tk.Canvas(self.top, cursor="cross", bg="#0284c7")
        self.canvas.pack(fill="both", expand=True)

        self.canvas.bind("<ButtonPress-1>", self.on_press)
        self.canvas.bind("<B1-Motion>", self.on_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_release)
        self.top.bind("<Escape>", lambda e: self.cancelar())

        self.start_x = None
        self.start_y = None
        self.rect = None

    def on_press(self, e):
        self.start_x = e.x_root
        self.start_y = e.y_root
        self.rect = self.canvas.create_rectangle(e.x, e.y, e.x, e.y, outline='#f43f5e', width=3)

    def on_drag(self, e):
        self.canvas.coords(self.rect, self.start_x, self.start_y, e.x, e.y)

    def on_release(self, e):
        x1, x2 = min(self.start_x, e.x_root), max(self.start_x, e.x_root)
        y1, y2 = min(self.start_y, e.y_root), max(self.start_y, e.y_root)

        coords = {"left": int(x1), "top": int(y1), "width": int(x2 - x1), "height": int(y2 - y1)}

        self.top.destroy()
        if coords["width"] > 20 and coords["height"] > 10:
            with open(CONFIG_FILE, "w") as f:
                json.dump(coords, f, indent=4)
            self.parent.on_calibrado(coords)
        else:
            self.parent.root.deiconify()

    def cancelar(self):
        self.top.destroy()
        self.parent.root.deiconify()


class SentinelApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Lumi Sentinel • TradingView Desk")
        self.root.geometry("460x570")
        self.root.configure(bg="#070b14")
        self.root.attributes('-topmost', True)

        self.running = False
        self.sct = mss.mss()
        self.roi = None
        self.ativo = "DETECTANDO..."
        self.carregar_roi()

        # HEADER
        header = tk.Frame(root, bg="#0d1527", pady=12, padx=16)
        header.pack(fill="x")
        tk.Label(header, text="⚡ LUMI SENTINEL", font=("Segoe UI", 12, "bold"), fg="#38bdf8", bg="#0d1527").pack(side="left")
        self.lbl_status = tk.Label(header, text="🔴 PARADO", font=("Segoe UI", 9, "bold"), fg="#f87171", bg="#0d1527")
        self.lbl_status.pack(side="right")

        main = tk.Frame(root, bg="#070b14", padx=16, pady=12)
        main.pack(fill="both", expand=True)

        # PREVIEW BOX AMPLIADO COM ZOOM NÍTIDO
        tk.Label(main, text="IMAGEM DA LEITURA (ZOOM REALÇADO):", font=("Segoe UI", 8, "bold"), fg="#94a3b8", bg="#070b14").pack(anchor="w")
        
        self.box_img = tk.Frame(main, bg="#020617", bd=2, relief="groove")
        self.box_img.pack(fill="x", pady=(5, 12))

        # Altura aumentada para 90px (zoom nítido)
        self.lbl_img = tk.Label(self.box_img, bg="#020617", height=5, text="Clique em CALIBRAR para selecionar a linha", fg="#64748b", font=("Segoe UI", 9))
        self.lbl_img.pack(fill="both", padx=6, pady=6)

        # DADOS EM TEMPO REAL
        info = tk.Frame(main, bg="#0d1527", padx=14, pady=10)
        info.pack(fill="x", pady=(0, 15))

        self.lbl_ativo = tk.Label(info, text="Ativo Detectado: Detectando...", font=("Segoe UI", 10, "bold"), fg="#c084fc", bg="#0d1527")
        self.lbl_ativo.pack(anchor="w")

        self.lbl_estado = tk.Label(info, text="Estado: Aguardando...", font=("Segoe UI", 9), fg="#ffffff", bg="#0d1527")
        self.lbl_estado.pack(anchor="w", pady=(3, 0))

        self.lbl_gatilho = tk.Label(info, text="Último Sinal: Nenhum", font=("Segoe UI", 9), fg="#94a3b8", bg="#0d1527")
        self.lbl_gatilho.pack(anchor="w", pady=(3, 0))

        # BOTÕES DE AÇÃO
        self.btn_calib = tk.Button(main, text="🎯 1. CALIBRAR ÁREA (RECORTE)", font=("Segoe UI", 10, "bold"), bg="#1e293b", fg="#38bdf8", relief="flat", pady=10, command=self.calibrar, cursor="hand2")
        self.btn_calib.pack(fill="x", pady=(0, 8))

        self.btn_run = tk.Button(main, text="▶️ 2. INICIAR SENTINELA", font=("Segoe UI", 10, "bold"), bg="#10b981", fg="#ffffff", relief="flat", pady=10, command=self.toggle_run, cursor="hand2")
        self.btn_run.pack(fill="x")

        # Inicia loop de atualização do preview e do ativo
        self.root.after(300, self.atualizar_preview_loop)

    def carregar_roi(self):
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r") as f:
                    self.roi = json.load(f)
            except Exception:
                self.roi = None

    def calibrar(self):
        self.root.withdraw()
        self.root.after(400, lambda: FullscreenCalibrator(self))

    def on_calibrado(self, coords):
        self.roi = coords
        self.root.deiconify()
        self.render_preview()

    def render_preview(self):
        if not self.roi: return
        try:
            shot = self.sct.grab(self.roi)
            img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
            # Zoom ampliado para 410x90 com excelente nitidez
            img = img.resize((410, 90), Image.Resampling.LANCZOS)
            tk_img = ImageTk.PhotoImage(img)
            self.lbl_img.config(image=tk_img, text="")
            self.lbl_img.image = tk_img
        except Exception:
            pass

    def atualizar_preview_loop(self):
        # Atualiza a detecção do ativo continuamente
        novo_ativo = detectar_ativo_tradingview()
        if novo_ativo != self.ativo:
            self.ativo = novo_ativo
            self.lbl_ativo.config(text=f"Ativo Detectado: {self.ativo}")

        if self.roi and not self.running:
            self.render_preview()
            
        self.root.after(800, self.atualizar_preview_loop)

    def toggle_run(self):
        if not self.running:
            if not self.roi:
                messagebox.showwarning("Aviso", "Calibre a área primeiro!")
                return
            self.running = True
            self.lbl_status.config(text="🟢 VIGIANDO TELA", fg="#34d399")
            self.btn_run.config(text="⏸️ PAUSAR SENTINELA", bg="#eab308")
            threading.Thread(target=self.loop_worker, daemon=True).start()
        else:
            self.running = False
            self.lbl_status.config(text="🔴 PARADO", fg="#f87171")
            self.btn_run.config(text="▶️ INICIAR SENTINELA", bg="#10b981")

    def loop_worker(self):
        last_state = "IDLE"
        last_hb = 0

        while self.running:
            try:
                # Atualiza dinamicamente o ativo durante a execução
                self.ativo = detectar_ativo_tradingview()
                self.lbl_ativo.config(text=f"Ativo Detectado: {self.ativo}")

                shot = self.sct.grab(self.roi)
                frame = np.array(shot)
                frame_bgr = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)

                # Renderiza a imagem ampliada na tela da Sentinela
                img_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
                img_pil = Image.fromarray(img_rgb).resize((410, 90), Image.Resampling.LANCZOS)
                tk_img = ImageTk.PhotoImage(img_pil)
                self.lbl_img.config(image=tk_img, text="")
                self.lbl_img.image = tk_img

                # Análise HSV de cores
                hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
                mask_green = cv2.inRange(hsv, np.array([40, 150, 150]), np.array([80, 255, 255]))
                mask_red = cv2.inRange(hsv, np.array([0, 150, 150]), np.array([10, 255, 255]))

                g_pix = cv2.countNonZero(mask_green)
                r_pix = cv2.countNonZero(mask_red)
                threshold = 35

                if g_pix > threshold and g_pix > r_pix:
                    estado_atual = "BUY"
                elif r_pix > threshold and r_pix > g_pix:
                    estado_atual = "SELL"
                else:
                    estado_atual = "AGUARDANDO FVG"

                self.lbl_estado.config(text=f"Estado: {estado_atual}")

                # Heartbeat de 2 em 2 segundos para o Supabase e PWA
                agora = time.time()
                if agora - last_hb >= 2.0:
                    last_hb = agora
                    try:
                        supabase.table("sentinel_status").update({
                            "is_online": True,
                            "current_state": estado_atual,
                            "last_seen": datetime.now(timezone.utc).isoformat(),
                            "monitored_symbol": self.ativo
                        }).eq("id", 1).execute()
                    except Exception:
                        pass

                # Disparo ao detectar nova oportunidade
                if estado_atual != last_state:
                    if estado_atual in ["BUY", "SELL"]:
                        cor = "#34d399" if estado_atual == "BUY" else "#f87171"
                        hora = datetime.now().strftime("%H:%M:%S")
                        self.lbl_gatilho.config(text=f"Sinal: {estado_atual} em {self.ativo} ({hora})", fg=cor)

                        supabase.table("lumi_signals").insert({
                            "symbol": self.ativo,
                            "direction": estado_atual,
                            "status": "ACTIVE",
                            "info": f"Gatilho confirmado ({self.ativo})"
                        }).execute()

                    last_state = estado_atual

                time.sleep(0.3)
            except Exception:
                time.sleep(1)


if __name__ == "__main__":
    root = tk.Tk()
    app = SentinelApp(root)
    root.mainloop()