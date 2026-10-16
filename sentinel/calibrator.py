import json
import tkinter as tk
import mss


def listar_monitores():
    """Lista os monitores com coordenadas GLOBAIS do desktop virtual."""
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
        return monitores


class AreaSelector:
    def __init__(self, monitor):
        self.monitor = monitor
        self.root = tk.Tk()
        self.root.overrideredirect(True)
        w, h = monitor["width"], monitor["height"]
        # Overlay posicionado EXATAMENTE sobre o monitor escolhido
        # ('-fullscreen' cobriria só o monitor principal)
        self.root.geometry(f"{w}x{h}{monitor['left']:+d}{monitor['top']:+d}")
        self.root.attributes('-alpha', 0.3)
        self.root.attributes('-topmost', True)
        self.root.config(cursor="cross")
        self.root.title(f"Calibrar — Monitor {monitor['index']} (ESC cancela)")

        self.canvas = tk.Canvas(self.root, cursor="cross", bg="grey")
        self.canvas.pack(fill="both", expand=True)
        self.canvas.create_text(
            12, 12, anchor="nw",
            text=(f"MONITOR {monitor['index']} • Arraste sobre a célula de "
                  f"status (● AGUARDANDO...) • ESC cancela"),
            fill="white", font=("Segoe UI", 11, "bold"))

        self.canvas.bind("<ButtonPress-1>", self.on_press)
        self.canvas.bind("<B1-Motion>", self.on_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_release)
        self.root.bind("<Escape>", lambda e: self.root.destroy())

        self.start_x = None
        self.start_y = None
        self.rect = None
        self.coords = None

    def on_press(self, event):
        # Coordenadas GLOBAIS (funcionam em qualquer monitor)
        self.start_x = event.x_root
        self.start_y = event.y_root
        x_rel, y_rel = event.x, event.y
        self.rect = self.canvas.create_rectangle(
            x_rel, y_rel, x_rel + 1, y_rel + 1, outline='red', width=2)

    def on_drag(self, event):
        self.canvas.coords(self.rect, *self.rect_start_rel(event))

    def rect_start_rel(self, event):
        # Converte o ponto inicial global para relativo ao canvas
        m = self.monitor
        x0 = self.start_x - m["left"]
        y0 = self.start_y - m["top"]
        return (x0, y0, event.x, event.y)

    def on_release(self, event):
        end_x, end_y = (event.x_root, event.y_root)
        x1 = min(self.start_x, end_x)
        y1 = min(self.start_y, end_y)
        x2 = max(self.start_x, end_x)
        y2 = max(self.start_y, end_y)
        self.coords = {"top": y1, "left": x1, "width": x2 - x1, "height": y2 - y1}
        print(f"\n[OK] Área selecionada (Monitor {self.monitor['index']}): {self.coords}")

        with open("roi_config.json", "w") as f:
            json.dump(self.coords, f, indent=4)
        print("[OK] Coordenadas salvas em 'roi_config.json'!")
        self.root.destroy()

if __name__ == "__main__":
    print("=== CALIBRADOR DE ÁREA DO LUMI FVG ===")
    monitores = listar_monitores()
    print(f"Monitores detectados: {len(monitores)}")
    for m in monitores:
        print(f"  [{m['index']}] {m['width']}x{m['height']} "
              f"(x={m['left']}, y={m['top']})")

    if len(monitores) > 1:
        while True:
            try:
                escolha = int(input("Calibrar em qual monitor? [1/%s]: "
                                    % "/".join(str(m["index"]) for m in monitores))
                              or monitores[0]["index"])
                monitor = next(m for m in monitores if m["index"] == escolha)
                break
            except (ValueError, StopIteration):
                print("Opção inválida, tente de novo.")
    else:
        monitor = monitores[0]

    print(f"Monitor {monitor['index']} selecionado. "
          "Arraste com o botão esquerdo sobre a célula de status "
          "(● AGUARDANDO...) no TradingView.")
    print("Pressione ESC para cancelar.")
    selector = AreaSelector(monitor)
    selector.root.mainloop()
