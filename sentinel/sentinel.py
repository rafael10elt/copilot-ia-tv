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

# 1. ATIVA SUPORTE DPI DO WINDOWS (Corrige escala de 125% e tela dividida)
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2) # Per-Monitor DPI Aware
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

# 2. DETECÇÃO DA JANELA
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
    """Varre as janelas para achar o ativo (XAUUSD, MNQ1!, etc)"""
    if not HAS_WIN32:
        return "XAUUSD"

    simbolo = None
    def enum_cb(hwnd, _):
        nonlocal simbolo
        if win32gui.IsWindowVisible(hwnd):
            tit = win32gui.GetWindowText(hwnd)
            if "TradingView" in tit or "Ouro" in tit or "XAU" in tit or "MNQ" in tit:
                # Extrai ticker
                m = re.search(r"\b(XAUUSD|MNQ1!|NQ1!|US30|EURUSD|BTCUSD)\b", tit, re.IGNORECASE)
                if m:
                    simbolo = m.group(1).upper()
                else:
                    primeira = tit.split()[0].replace(",", "").upper()
                    if len(primeira) >= 3 and len(primeira) <= 8:
                        simbolo = primeira
    try:
        win32gui.EnumWindows(enum_cb, None)
    except Exception:
        pass
    return simbolo if simbolo else "XAUUSD"


class FullscreenCalibrator:
    """Calibrador que cobre 100% dos pixels reais do monitor"""
    def __init__(self, parent_gui):
        self.parent = parent_gui
        self.top = tk.Toplevel()
        
        # Pega dimensões reais via Windows
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
        x1 = min(self.start_x, e.x_root)
        x2 = max(self.start_x, e.x_root)
        y1 = min(self.start_y, e.y_root)
        y2 = max(self.start_y, e.y_root)

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
        self.root.title("Lumi Copilot Sentinel")
        self.root.geometry("450x550")
        self.root.configure(bg="#070b14")
        self.root.attributes('-topmost', True)

        self.running = False
        self.sct = mss.mss()
        self.roi = None
        self.carregar_roi()
        self.ativo = "XAUUSD"

        # HEADER
        header = tk.Frame(root, bg="#0d1527", pady=12, padx=16)
        header.pack(fill="x")
        tk.Label(header, text="⚡ LUMI SENTINEL", font=("Segoe UI", 12, "bold"), fg="#38bdf8", bg="#0d1527").pack(side="left")
        self.lbl_status = tk.Label(header, text="🔴 PARADO", font=("Segoe UI", 9, "bold"), fg="#f87171", bg="#0d1527")
        self.lbl_status.pack(side="right")

        main = tk.Frame(root, bg="#070b14", padx=20, pady=15)
        main.pack(fill="both", expand=True)

        # PREVIEW BOX
        tk.Label(main, text="IMAGEM DA LEITURA (VERIFIQUE SE ESTÁ CERTO):", font=("Segoe UI", 8, "bold"), fg="#94a3b8", bg="#070b14").pack(anchor="w")
        
        self.box_img = tk.Frame(main, bg="#020617", bd=2, relief="groove")
        self.box_img.pack(fill="x", pady=(5, 12))

        self.lbl_img = tk.Label(self.box_img, bg="#020617", height=4, text="Clique em CALIBRAR abaixo para marcar a linha", fg="#64748b")
        self.lbl_img.pack(fill="both", padx=4, pady=4)

        # STATUS
        info = tk.Frame(main, bg="#0d1527", padx=14, pady=10)
        info.pack(fill="x", pady=(0, 15))

        self.lbl_ativo = tk.Label(info, text="Ativo: Detectando...", font=("Segoe UI", 9, "bold"), fg="#a855f7", bg="#0d1527")
        self.lbl_ativo.pack(anchor="w")

        self.lbl_estado = tk.Label(info, text="Estado: Aguardando...", font=("Segoe UI", 9), fg="#ffffff", bg="#0d1527")
        self.lbl_estado.pack(anchor="w", pady=(3, 0))

        self.lbl_gatilho = tk.Label(info, text="Último Sinal: Nenhum", font=("Segoe UI", 9), fg="#94a3b8", bg="#0d1527")
        self.lbl_gatilho.pack(anchor="w", pady=(3, 0))

        # BOTÕES
        self.btn_calib = tk.Button(main, text="🎯 1. CALIBRAR ÁREA (COBRE 100% DA TELA)", font=("Segoe UI", 10, "bold"), bg="#1e293b", fg="#38bdf8", relief="flat", pady=10, command=self.calibrar, cursor="hand2")
        self.btn_calib.pack(fill="x", pady=(0, 8))

        self.btn_run = tk.Button(main, text="▶️ 2. INICIAR SENTINELA", font=("Segoe UI", 10, "bold"), bg="#10b981", fg="#ffffff", relief="flat", pady=10, command=self.toggle_run, cursor="hand2")
        self.btn_run.pack(fill="x")

        self.root.after(500, self.atualizar_preview_loop)

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
            img = img.resize((390, 60), Image.Resampling.LANCZOS)
            tk_img = ImageTk.PhotoImage(img)
            self.lbl_img.config(image=tk_img, text="")
            self.lbl_img.image = tk_img
        except Exception:
            pass

    def atualizar_preview_loop(self):
        self.ativo = detectar_ativo_tradingview()
        self.lbl_ativo.config(text=f"Ativo Detectado: {self.ativo}")

        if self.roi and not self.running:
            self.render_preview()
        self.root.after(1000, self.atualizar_preview_loop)

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
                shot = self.sct.grab(self.roi)
                frame = np.array(shot)
                frame_bgr = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)

                # Mostra o print atualizado na caixinha
                img_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
                img_pil = Image.fromarray(img_rgb).resize((390, 60), Image.Resampling.LANCZOS)
                tk_img = ImageTk.PhotoImage(img_pil)
                self.lbl_img.config(image=tk_img, text="")
                self.lbl_img.image = tk_img

                # Análise HSV: Só acusa trade se houver o fundo azul ou texto de trade explícito
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

                # Heartbeat de 2 em 2 segundos
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
                    except Exception as err:
                        print("Erro Heartbeat:", err)

                # Disparo de Novo Trade
                if estado_atual != last_state:
                    if estado_atual in ["BUY", "SELL"]:
                        cor = "#34d399" if estado_atual == "BUY" else "#f87171"
                        hora = datetime.now().strftime("%H:%M:%S")
                        self.lbl_gatilho.config(text=f"Sinal: {estado_atual} ({hora})", fg=cor)

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