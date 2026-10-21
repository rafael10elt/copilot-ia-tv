import os
import sys
import json
import time
import re
import threading
import ctypes
import base64
from datetime import datetime, timezone
import tkinter as tk
from tkinter import messagebox
from PIL import Image, ImageTk
import mss
import numpy as np
import cv2
from supabase import create_client

# Dependências da Ponte Tradovate
from flask import Flask, request, jsonify
from flask_cors import CORS
from tradovate_client import TradovateClient, TradovatePenaltyError

# 1. SUPORTE DPI DO WINDOWS (PRECISAO PIXEL-A-PIXEL)
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

# 2. DETECCAO WIN32
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

# Instância do Cliente Tradovate
tradovate = TradovateClient()

# Servidor Flask Local para Comunicação com o Cockpit Web
bridge_app = Flask(__name__)
CORS(bridge_app)

@bridge_app.route("/bridge/status", methods=["GET"])
def bridge_status():
    penalidade = max(0, int(tradovate.penalty_until - time.time()))
    return jsonify({
        "status": "ONLINE",
        "env": tradovate.env,
        "max_sl_cap": tradovate.max_sl_cap,
        "user_logged": tradovate.username if tradovate.username else "NÃO CONFIGURADO",
        "penalty": penalidade,
        "penalty_message": tradovate.penalty_message,
    })

@bridge_app.route("/bridge/accounts", methods=["GET"])
def bridge_accounts():
    try:
        contas = tradovate.listar_contas()
        return jsonify({"ok": True, "accounts": contas})
    except TradovatePenaltyError as e:
        # Rate limit/captcha da Tradovate: devolve 429 com o tempo de espera
        return jsonify({
            "ok": False,
            "error": str(e),
            "retry_after": e.retry_after,
            "captcha": e.captcha,
        }), 429
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

@bridge_app.route("/bridge/execute", methods=["POST"])
def bridge_execute():
    data = request.json or {}
    account_ids = data.get("account_ids", [])
    symbol = data.get("symbol", "MNQ")
    direction = data.get("direction", "BUY")
    qty = data.get("qty", 1)
    sl_points = data.get("sl_points", 15.0)
    tp_points = data.get("tp_points", 30.0)

    if not account_ids:
        return jsonify({"ok": False, "error": "Nenhuma conta selecionada!"}), 400

    try:
        resultados = tradovate.executar_operacao(
            account_ids=account_ids,
            symbol=symbol,
            direction=direction,
            qty=qty,
            sl_points=sl_points,
            tp_points=tp_points
        )
        return jsonify({"ok": True, "results": resultados})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

def iniciar_servidor_bridge():
    port = int(os.getenv("BRIDGE_PORT", 8765))
    bridge_app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)

def listar_monitores():
    try:
        with mss.mss() as sct:
            monitores = []
            for i, m in enumerate(sct.monitors[1:], start=1):
                monitores.append({
                    "index": i,
                    "left": int(m["left"]),
                    "top": int(m["top"]),
                    "width": int(m["width"]),
                    "height": int(m["height"]),
                })
            if monitores:
                return monitores
    except Exception:
        pass
    user32 = ctypes.windll.user32
    return [{
        "index": 1,
        "left": 0,
        "top": 0,
        "width": user32.GetSystemMetrics(0),
        "height": user32.GetSystemMetrics(1),
    }]

def detectar_ativo_tradingview():
    if not HAS_WIN32:
        return "MNQ"

    candidatos = []
    def enum_cb(hwnd, _):
        if win32gui.IsWindowVisible(hwnd):
            tit = win32gui.GetWindowText(hwnd).strip()
            if tit and any(k in tit for k in ["TradingView", "Lumitrader", "Futures", "Index", "Nasdaq", "CME", "Chrome", "Brave", "Edge"]):
                candidatos.append(tit)

    try:
        win32gui.EnumWindows(enum_cb, None)
    except Exception:
        pass

    for tit in candidatos:
        tit_upper = tit.upper()
        if "MICRO E-MINI NASDAQ" in tit_upper or "MNQ" in tit_upper:
            m = re.search(r"\b(MNQ[A-Z0-9!]{1,6})\b", tit_upper)
            return m.group(1) if m else "MNQ"
        if "E-MINI NASDAQ" in tit_upper or "NQ1!" in tit_upper or re.search(r"\bNQ[A-Z0-9!]{1,5}\b", tit_upper):
            m = re.search(r"\b(NQ[A-Z0-9!]{1,6})\b", tit_upper)
            return m.group(1) if m else "NQ"
        if any(alias in tit_upper for alias in ["NAS100", "USTEC", "US100", "QQQ"]):
            for alias in ["NAS100", "USTEC", "US100", "QQQ"]:
                if alias in tit_upper:
                    return alias

    return "MNQ"

class FullscreenCalibrator:
    def __init__(self, parent_gui, monitor):
        self.parent = parent_gui
        self.monitor = monitor
        self.top = tk.Toplevel()
        w, h = monitor["width"], monitor["height"]
        self.top.overrideredirect(True)
        self.top.geometry(f"{w}x{h}{monitor['left']:+d}{monitor['top']:+d}")
        self.top.attributes('-alpha', 0.28)
        self.top.attributes('-topmost', True)
        self.top.config(cursor="cross")
        self.top.title(f"Calibrar — Monitor {monitor['index']} (ESC cancela)")

        self.canvas = tk.Canvas(self.top, cursor="cross", bg="#0284c7")
        self.canvas.pack(fill="both", expand=True)
        self.canvas.create_text(
            12, 12, anchor="nw",
            text=f"MONITOR {monitor['index']} • Arraste sobre a célula de status • ESC cancela",
            fill="white", font=("Segoe UI", 11, "bold"))
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
        rx, ry = e.x_root - self.monitor["left"], e.y_root - self.monitor["top"]
        self.rel_x, self.rel_y = rx, ry
        self.rect = self.canvas.create_rectangle(rx, ry, rx + 1, ry + 1, outline='#f43f5e', width=3)

    def on_drag(self, e):
        rx = e.x_root - self.monitor["left"]
        ry = e.y_root - self.monitor["top"]
        self.canvas.coords(self.rect, self.rel_x, self.rel_y, rx, ry)

    def on_release(self, e):
        x1, x2 = min(self.start_x, e.x_root), max(self.start_x, e.x_root)
        y1, y2 = min(self.start_y, e.y_root), max(self.start_y, e.y_root)
        coords = {"left": int(x1), "top": int(y1), "width": int(x2 - x1), "height": int(y2 - y1)}
        self.top.destroy()

        if coords["width"] > 15 and coords["height"] > 10:
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
        self.root.title("Lumi Sentinel • Prop Desk Monitor")
        self.root.geometry("460x650")
        self.root.configure(bg="#070b14")
        self.root.attributes('-topmost', True)

        self.running = False
        self.sct = mss.mss()
        self.roi = None
        self.ativo_atual = "MNQ"
        self.auto_detect = True
        self.carregar_roi()

        header = tk.Frame(root, bg="#0d1527", pady=12, padx=16)
        header.pack(fill="x")
        tk.Label(header, text="⚡ LUMI SENTINEL + APEX BRIDGE", font=("Segoe UI", 11, "bold"), fg="#38bdf8", bg="#0d1527").pack(side="left")
        self.lbl_status = tk.Label(header, text="🔴 PARADO", font=("Segoe UI", 9, "bold"), fg="#f87171", bg="#0d1527")
        self.lbl_status.pack(side="right")

        main = tk.Frame(root, bg="#070b14", padx=16, pady=12)
        main.pack(fill="both", expand=True)

        self.lbl_dimensoes = tk.Label(main, text="IMAGEM DA LEITURA (TAMANHO REAL):", font=("Segoe UI", 8, "bold"), fg="#94a3b8", bg="#070b14")
        self.lbl_dimensoes.pack(anchor="w")

        self.box_img = tk.Frame(main, bg="#020617", bd=2, relief="groove", height=100)
        self.box_img.pack(fill="x", pady=(5, 10))
        self.box_img.pack_propagate(False)

        self.lbl_img = tk.Label(self.box_img, bg="#020617", text="Selecione a célula de Status (CALIBRAR)", fg="#64748b", font=("Segoe UI", 9))
        self.lbl_img.pack(fill="both", expand=True)

        info = tk.Frame(main, bg="#0d1527", padx=14, pady=10)
        info.pack(fill="x", pady=(0, 12))

        ativo_frame = tk.Frame(info, bg="#0d1527")
        ativo_frame.pack(fill="x")
        tk.Label(ativo_frame, text="Ativo Monitorado:", font=("Segoe UI", 9, "bold"), fg="#94a3b8", bg="#0d1527").pack(side="left")
        self.lbl_ativo_display = tk.Label(ativo_frame, text=self.ativo_atual, font=("Segoe UI", 11, "bold"), fg="#c084fc", bg="#0d1527")
        self.lbl_ativo_display.pack(side="left", padx=8)

        self.btn_modo_ativo = tk.Button(ativo_frame, text="[MODO AUTO: ATIVO]", font=("Segoe UI", 8, "bold"), bg="#1e293b", fg="#34d399", relief="flat", padx=6, pady=1, command=self.toggle_modo_ativo)
        self.btn_modo_ativo.pack(side="right")

        self.lbl_estado = tk.Label(info, text="Estado: Aguardando...", font=("Segoe UI", 9), fg="#ffffff", bg="#0d1527")
        self.lbl_estado.pack(anchor="w", pady=(6, 0))

        self.lbl_gatilho = tk.Label(info, text="Último Sinal: Nenhum", font=("Segoe UI", 9), fg="#94a3b8", bg="#0d1527")
        self.lbl_gatilho.pack(anchor="w", pady=(2, 0))

        # Indicador da Ponte Tradovate
        self.lbl_bridge = tk.Label(info, text=f"Ponte Apex: 127.0.0.1:{os.getenv('BRIDGE_PORT', 8765)} (PRONTA)", font=("Segoe UI", 8, "bold"), fg="#38bdf8", bg="#0d1527")
        self.lbl_bridge.pack(anchor="w", pady=(4, 0))

        self.btn_calib = tk.Button(main, text="🎯 1. CALIBRAR CÉLULA DE STATUS", font=("Segoe UI", 10, "bold"), bg="#1e293b", fg="#38bdf8", relief="flat", pady=9, command=self.calibrar, cursor="hand2")
        self.btn_calib.pack(fill="x", pady=(0, 8))

        self.btn_run = tk.Button(main, text="▶️ 2. INICIAR SENTINELA", font=("Segoe UI", 10, "bold"), bg="#10b981", fg="#ffffff", relief="flat", pady=9, command=self.toggle_run, cursor="hand2")
        self.btn_run.pack(fill="x")

        self.root.after(300, self.atualizar_preview_loop)

    def toggle_modo_ativo(self):
        self.auto_detect = not self.auto_detect
        self.btn_modo_ativo.config(
            text="[MODO AUTO: ATIVO]" if self.auto_detect else "[MODO AUTO: MANUAL]",
            fg="#34d399" if self.auto_detect else "#f87171"
        )

    def carregar_roi(self):
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r") as f:
                    self.roi = json.load(f)
            except Exception:
                self.roi = None

    def calibrar(self):
        monitores = listar_monitores()
        if len(monitores) == 1:
            self.abrir_overlay(monitores[0])
        else:
            self.escolher_monitor(monitores)

    def escolher_monitor(self, monitores):
        dlg = tk.Toplevel(self.root)
        dlg.title("Calibrar — Escolher monitor")
        dlg.configure(bg="#0d1527")
        dlg.attributes('-topmost', True)
        dlg.resizable(False, False)
        dlg.geometry("+%d+%d" % (
            self.root.winfo_screenwidth() // 2 - 190,
            self.root.winfo_screenheight() // 2 - 110))

        tk.Label(dlg, text="Em qual monitor está o TradingView?", font=("Segoe UI", 10, "bold"), fg="#e2e8f0", bg="#0d1527").pack(padx=20, pady=(16, 10))

        var = tk.IntVar(value=monitores[0]["index"])
        for m in monitores:
            texto = f"Monitor {m['index']} — {m['width']}x{m['height']} (x={m['left']}, y={m['top']})"
            tk.Radiobutton(dlg, text=texto, variable=var, value=m["index"], font=("Segoe UI", 9), fg="#e2e8f0", bg="#0d1527", selectcolor="#1e293b", activebackground="#0d1527", activeforeground="#38bdf8", anchor="w").pack(fill="x", padx=20, pady=2)

        btns = tk.Frame(dlg, bg="#0d1527")
        btns.pack(fill="x", padx=20, pady=14)
        tk.Button(btns, text="Cancelar", font=("Segoe UI", 9), bg="#1e293b", fg="#94a3b8", relief="flat", padx=12, pady=6, command=dlg.destroy).pack(side="left")
        tk.Button(btns, text="Calibrar este monitor ➜", font=("Segoe UI", 9, "bold"), bg="#0284c7", fg="#ffffff", relief="flat", padx=12, pady=6, command=lambda: (dlg.destroy(), self.abrir_overlay(next(m for m in monitores if m["index"] == var.get())))).pack(side="right")

    def abrir_overlay(self, monitor):
        self.root.withdraw()
        self.root.after(400, lambda: FullscreenCalibrator(self, monitor))

    def on_calibrado(self, coords):
        self.roi = coords
        self.root.deiconify()
        self.lbl_dimensoes.config(text=f"IMAGEM DA LEITURA ({coords['width']}x{coords['height']} px):")
        self.render_preview()

    def processar_imagem_preview(self, shot):
        img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
        w_orig, h_orig = img.size
        fator = min(420 / w_orig, 100 / h_orig, 3.0)
        novo_w = max(int(w_orig * fator), 50)
        novo_h = max(int(h_orig * fator), 40)
        return ImageTk.PhotoImage(img.resize((novo_w, novo_h), Image.Resampling.LANCZOS))

    def render_preview(self):
        if not self.roi: return
        try:
            shot = self.sct.grab(self.roi)
            tk_img = self.processar_imagem_preview(shot)
            self.lbl_img.config(image=tk_img, text="")
            self.lbl_img.image = tk_img
        except Exception:
            pass

    def checar_ativo_em_tempo_real(self):
        if self.auto_detect:
            novo = detectar_ativo_tradingview()
            if novo and novo != self.ativo_atual:
                self.ativo_atual = novo
                self.lbl_ativo_display.config(text=self.ativo_atual)

    def atualizar_preview_loop(self):
        self.checar_ativo_em_tempo_real()
        if self.roi and not self.running:
            self.render_preview()
        self.root.after(800, self.atualizar_preview_loop)

    def toggle_run(self):
        if not self.running:
            if not self.roi:
                messagebox.showwarning("Aviso", "Calibre a área de status primeiro!")
                return
            self.running = True
            self.lbl_status.config(text="🟢 VIGIANDO TELA", fg="#34d399")
            self.btn_run.config(text="⏸️ PAUSAR SENTINELA", bg="#eab308")
            threading.Thread(target=self.loop_worker, daemon=True).start()
        else:
            self.running = False
            self.lbl_status.config(text="🔴 PARADO", fg="#f87171")
            self.btn_run.config(text="▶️ INICIAR SENTINELA", bg="#10b981")

    def classificar_estado(self, frame_bgr):
        hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
        total_pixels = frame_bgr.shape[0] * frame_bgr.shape[1]
        if total_pixels == 0:
            return "AGUARDANDO FVG"

        mask_red1 = cv2.inRange(hsv, np.array([0, 110, 70]), np.array([12, 255, 255]))
        mask_red2 = cv2.inRange(hsv, np.array([168, 110, 70]), np.array([180, 255, 255]))
        mask_red = mask_red1 | mask_red2
        mask_green = cv2.inRange(hsv, np.array([35, 110, 70]), np.array([85, 255, 255]))

        red_count = cv2.countNonZero(mask_red)
        green_count = cv2.countNonZero(mask_green)
        pct_red = red_count / total_pixels
        pct_green = green_count / total_pixels

        if pct_red > 0.12 and pct_red > (pct_green * 1.5):
            return "SELL"
        elif pct_green > 0.12 and pct_green > (pct_red * 1.5):
            return "BUY"

        return "AGUARDANDO FVG"

    def loop_worker(self):
        last_state = "IDLE"
        last_hb = 0

        while self.running:
            try:
                self.checar_ativo_em_tempo_real()
                shot = self.sct.grab(self.roi)
                frame = np.array(shot)
                frame_bgr = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)

                tk_img = self.processar_imagem_preview(shot)
                self.lbl_img.config(image=tk_img, text="")
                self.lbl_img.image = tk_img

                estado_atual = self.classificar_estado(frame_bgr)
                self.lbl_estado.config(text=f"Estado: {estado_atual}")

                # Heartbeat + Envio da imagem ao vivo a cada 1.5s
                agora = time.time()
                if agora - last_hb >= 1.5:
                    last_hb = agora
                    try:
                        _, buf = cv2.imencode('.jpg', frame_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 65])
                        b64_img = f"data:image/jpeg;base64,{base64.b64encode(buf).decode('utf-8')}"

                        supabase.table("sentinel_status_cop").update({
                            "is_online": True,
                            "current_state": estado_atual,
                            "last_seen": datetime.now(timezone.utc).isoformat(),
                            "monitored_symbol": self.ativo_atual,
                            "preview_base64": b64_img
                        }).eq("id", 1).execute()
                    except Exception:
                        pass

                # Disparo de Novo Trade na Mudança de Estado
                if estado_atual != last_state:
                    if estado_atual in ["BUY", "SELL"]:
                        cor = "#34d399" if estado_atual == "BUY" else "#f87171"
                        hora = datetime.now().strftime("%H:%M:%S")
                        self.lbl_gatilho.config(text=f"Sinal: {estado_atual} em {self.ativo_atual} ({hora})", fg=cor)

                        supabase.table("lumi_signals_cop").insert({
                            "symbol": self.ativo_atual,
                            "direction": estado_atual,
                            "status": "ACTIVE",
                            "info": f"Gatilho confirmado ({self.ativo_atual})"
                        }).execute()

                    last_state = estado_atual

                time.sleep(0.3)
            except Exception:
                time.sleep(1)

if __name__ == "__main__":
    # Inicia a Ponte HTTP Tradovate em segundo plano
    threading.Thread(target=iniciar_servidor_bridge, daemon=True).start()

    # Inicia a Interface Gráfica da Sentinela
    root = tk.Tk()
    app = SentinelApp(root)
    root.mainloop()