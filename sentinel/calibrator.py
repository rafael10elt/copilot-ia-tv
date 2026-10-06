import json
import tkinter as tk
from PIL import ImageGrab

class AreaSelector:
    def __init__(self):
        self.root = tk.Tk()
        self.root.attributes('-alpha', 0.3)
        self.root.attributes('-fullscreen', True)
        self.root.config(cursor="cross")

        self.canvas = tk.Canvas(self.root, cursor="cross", bg="grey")
        self.canvas.pack(fill="both", expand=True)

        self.canvas.bind("<ButtonPress-1>", self.on_press)
        self.canvas.bind("<B1-Motion>", self.on_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_release)
        self.root.bind("<Escape>", lambda e: self.root.destroy())

        self.start_x = None
        self.start_y = None
        self.rect = None
        self.coords = None

    def on_press(self, event):
        self.start_x = event.x
        self.start_y = event.y
        self.rect = self.canvas.create_rectangle(self.x, self.y, 1, 1, outline='red', width=2)

    @property
    def x(self): return self.start_x
    @property
    def y(self): return self.start_y

    def on_drag(self, event):
        cur_x, cur_y = (event.x, event.y)
        self.canvas.coords(self.rect, self.start_x, self.start_y, cur_x, cur_y)

    def on_release(self, event):
        end_x, end_y = (event.x, event.y)
        x1 = min(self.start_x, end_x)
        y1 = min(self.start_y, end_y)
        x2 = max(self.start_x, end_x)
        y2 = max(self.start_y, end_y)
        self.coords = {"top": y1, "left": x1, "width": x2 - x1, "height": y2 - y1}
        print(f"\n[OK] Área selecionada: {self.coords}")
        
        with open("roi_config.json", "w") as f:
            json.dump(self.coords, f, indent=4)
        print("[OK] Coordenadas salvas em 'roi_config.json'!")
        self.root.destroy()

if __name__ == "__main__":
    print("=== CALIBRADOR DE ÁREA DO LUMI FVG ===")
    print("Arraste com o botão esquerdo sobre a célula de status (● AGUARDANDO...) no TradingView.")
    print("Pressione ESC para cancelar.")
    selector = AreaSelector()
    selector.root.mainloop()