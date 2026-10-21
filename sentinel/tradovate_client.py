import os
import requests
import time
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

class TradovateClient:
    def __init__(self):
        self.username = os.getenv("TRADOVATE_USER", "").strip()
        self.password = os.getenv("TRADOVATE_PASSWORD", "").strip()
        self.env = os.getenv("TRADOVATE_ENV", "live").lower()
        self.max_sl_cap = float(os.getenv("MAX_SL_POINTS", 25.0))
        
        # Endpoints oficiais da API Tradovate
        if self.env == "live":
            self.base_url = "https://live.tradovate.com/v1"
        else:
            self.base_url = "https://demo.tradovate.com/v1"
            
        self.access_token = None
        self.token_expiration = 0
        self.cached_accounts = []

    def autenticar(self):
        """Autentica na Tradovate e obtém o Bearer Token"""
        if not self.username or not self.password:
            raise ValueError("Credenciais Tradovate ausentes no arquivo .env!")

        # Se o token ainda for válido (com 60s de folga), reutiliza
        if self.access_token and time.time() < (self.token_expiration - 60):
            return self.access_token

        url = f"{self.base_url}/auth/accesstokenrequest"
        payload = {
            "name": self.username,
            "password": self.password,
            "appId": "Tradovate Web",
            "appVersion": "1.0",
            "cid": 0,
            "sec": ""
        }
        headers = {"Content-Type": "application/json"}

        res = requests.post(url, json=payload, headers=headers, timeout=10)
        if not res.ok:
            raise Exception(f"Falha de autenticação Tradovate: HTTP {res.status_code} - {res.text}")

        data = res.json()
        self.access_token = data.get("accessToken")
        
        # Tempo padrão de expiração ou 2 horas
        exp_time = data.get("expirationTime")
        if exp_time:
            # Converte ISO para timestamp
            dt = datetime.fromisoformat(exp_time.replace("Z", "+00:00"))
            self.token_expiration = dt.timestamp()
        else:
            self.token_expiration = time.time() + 7200

        return self.access_token

    def _headers(self):
        token = self.autenticar()
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

    def listar_contas(self):
        """Retorna todas as contas da Apex associadas a este login"""
        url = f"{self.base_url}/account/list"
        res = requests.get(url, headers=self._headers(), timeout=10)
        if not res.ok:
            raise Exception(f"Erro ao listar contas: {res.text}")

        contas = res.json()
        self.cached_accounts = [
            {
                "id": acc.get("id"),
                "name": acc.get("name"),
                "account_type": acc.get("accountType", "Simulation"),
                "is_active": acc.get("active", True)
            }
            for acc in contas
        ]
        return self.cached_accounts

    def resolver_simbolo_ativo(self, raw_symbol="MNQ"):
        """Converte 'MNQ' ou 'NQ' para o contrato futuro vigente se necessário"""
        sym = raw_symbol.upper().strip()
        # Se vier algo como MNQ1! do TradingView, remove sufixos para buscar contrato
        if sym.startswith("MNQ"):
            return "MNQ"
        if sym.startswith("NQ"):
            return "NQ"
        return sym

    def executar_operacao(self, account_ids, symbol, direction, qty=1, sl_points=15.0, tp_points=30.0):
        """
        Dispara a ordem de entrada a mercado + Stop Loss de segurança
        para cada conta selecionada.
        """
        # Trava de Segurança Institucional: Aplica o Hard Cap de SL
        sl_seguro = min(float(sl_points), self.max_sl_cap)
        if sl_seguro <= 0:
            sl_seguro = 15.0

        action_entry = "Buy" if direction.upper() == "BUY" else "Sell"
        action_sl = "Sell" if action_entry == "Buy" else "Buy"

        headers = self._headers()
        resultados = []

        # Certifica que a lista de contas está atualizada
        if not self.cached_accounts:
            self.listar_contas()

        for acc_id in account_ids:
            acc_info = next((a for a in self.cached_accounts if str(a["id"]) == str(acc_id)), None)
            acc_name = acc_info["name"] if acc_info else str(acc_id)

            try:
                # 1. Envio da Ordem a Mercado de Entrada
                order_payload = {
                    "accountSpec": self.username,
                    "accountId": int(acc_id),
                    "action": action_entry,
                    "symbol": symbol,
                    "orderQty": int(qty),
                    "orderType": "Market",
                    "isAutomated": False
                }

                res_entry = requests.post(f"{self.base_url}/order/placeorder", json=order_payload, headers=headers, timeout=8)
                data_entry = res_entry.json()

                if not res_entry.ok:
                    resultados.append({
                        "account_id": acc_id,
                        "account_name": acc_name,
                        "status": "ERRO",
                        "message": data_entry.get("errorText", res_entry.text)
                    })
                    continue

                order_id = data_entry.get("orderId")

                # 2. Ordem de Proteção (Stop Loss vinculado em pontos)
                # No Tradovate, ordens Stop aceitam offset de pontos ou colocação imediata
                sl_payload = {
                    "accountSpec": self.username,
                    "accountId": int(acc_id),
                    "action": action_sl,
                    "symbol": symbol,
                    "orderQty": int(qty),
                    "orderType": "Stop",
                    "isAutomated": False,
                    "other": {
                        "bracket": {
                            "stopLoss": -sl_seguro if action_entry == "Buy" else sl_seguro
                        }
                    }
                }
                
                # Dispara proteção
                requests.post(f"{self.base_url}/order/placeorder", json=sl_payload, headers=headers, timeout=5)

                resultados.append({
                    "account_id": acc_id,
                    "account_name": acc_name,
                    "status": "SUCESSO",
                    "order_id": order_id,
                    "sl_points": sl_seguro,
                    "tp_points": tp_points,
                    "qty": qty
                })

            except Exception as e:
                resultados.append({
                    "account_id": acc_id,
                    "account_name": acc_name,
                    "status": "ERRO",
                    "message": str(e)
                })

        return resultados