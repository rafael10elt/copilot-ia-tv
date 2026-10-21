import json
import os
import time
import uuid
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# .env sempre a partir da pasta do sentinel (independe de onde o .py for executado)
load_dotenv(os.path.join(BASE_DIR, ".env"))
load_dotenv()

TOKEN_CACHE_FILE = os.path.join(BASE_DIR, ".tradovate_token.json")
PENALTY_COOLDOWN_SECONDS = 3600
ACCOUNTS_CACHE_SECONDS = 15


class TradovatePenaltyError(Exception):
    """Tradovate limitou a aplicacao (rate limit / p-ticket com captcha)."""

    def __init__(self, message, retry_after=0, captcha=False):
        super().__init__(message)
        self.retry_after = retry_after
        self.captcha = captcha


class TradovateClient:
    def __init__(self):
        self.username = os.getenv("TRADOVATE_USER", "").strip()
        self.password = os.getenv("TRADOVATE_PASSWORD", "").strip()
        self.env = os.getenv("TRADOVATE_ENV", "live").lower()
        self.max_sl_cap = float(os.getenv("MAX_SL_POINTS", 25.0))

        # Endpoints oficiais da API Tradovate (sempre com 'tradovateapi.com')
        if self.env == "live":
            self.base_url = "https://live.tradovateapi.com/v1"
        else:
            self.base_url = "https://demo.tradovateapi.com/v1"

        self.access_token = None
        self.token_expiration = 0
        self.cached_accounts = []
        # Identificador estavel de dispositivo exigido pela Tradovate
        self.device_id = "lumi-copilot-desk-" + str(uuid.uuid5(uuid.NAMESPACE_DNS, self.username or "lumi"))[:18]

        # Controle de penalidade (rate limit / captcha) para nao martelar a API
        self.penalty_until = 0.0
        self.penalty_message = ""
        self.penalty_captcha = False
        self.accounts_cached_at = 0.0

    # ------------------------------------------------------------------ #
    # Token em disco: reiniciar o sentinel.py nao deve gastar quota de auth
    # ------------------------------------------------------------------ #
    def _ler_token_cache(self):
        try:
            with open(TOKEN_CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if data.get("token") and data.get("expiration", 0) > time.time() + 60:
                return data
        except Exception:
            pass
        return None

    def _gravar_token_cache(self, token, expiration):
        try:
            with open(TOKEN_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(
                    {"token": token, "expiration": expiration, "username": self.username},
                    f,
                    indent=2,
                )
        except Exception:
            pass

    def _remover_token_cache(self):
        try:
            os.remove(TOKEN_CACHE_FILE)
        except Exception:
            pass

    # ------------------------------------------------------------------ #
    # Autenticacao
    # ------------------------------------------------------------------ #
    def _json(self, res):
        try:
            if res.headers.get("content-type", "").startswith("application/json"):
                return res.json()
        except Exception:
            pass
        return {}

    def _registrar_penalidade(self, data, res):
        p_message = data.get("p-message") or res.text
        p_time = int(data.get("p-time") or 0)
        captcha = bool(data.get("p-captcha"))
        cooldown = PENALTY_COOLDOWN_SECONDS if captcha else max(p_time, 15)
        self.penalty_until = time.time() + cooldown
        self.penalty_message = str(p_message)
        self.penalty_captcha = captcha
        raise TradovatePenaltyError(
            f"Tradovate limitou a aplicacao: {p_message}. Tente novamente em {cooldown}s.",
            retry_after=cooldown,
            captcha=captcha,
        )

    def _checar_penalidade(self):
        if self.penalty_until > time.time():
            restante = int(self.penalty_until - time.time())
            raise TradovatePenaltyError(
                f"Tradovate limitou a aplicacao: {self.penalty_message}. Tente novamente em {restante}s.",
                retry_after=restante,
                captcha=self.penalty_captcha,
            )

    def autenticar(self):
        """Autentica na Tradovate e obtem o Bearer Token"""
        if not self.username or not self.password:
            raise ValueError("Credenciais Tradovate ausentes no arquivo .env!")

        self._checar_penalidade()

        # Se o token ainda for valido (com 60s de folga), reutiliza
        if self.access_token and time.time() < (self.token_expiration - 60):
            return self.access_token

        # Token salvo em disco (evita nova autenticacao a cada restart)
        cached = self._ler_token_cache()
        if cached:
            self.access_token = cached["token"]
            self.token_expiration = float(cached.get("expiration") or 0)
            return self.access_token

        url = f"{self.base_url}/auth/accesstokenrequest"
        payload = {
            "name": self.username,
            "password": self.password,
            "appId": "Sample App",
            "appVersion": "1.0",
            "cid": 0,
            "sec": "",
            "deviceId": self.device_id,
        }
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        try:
            res = requests.post(url, json=payload, headers=headers, timeout=12)
        except requests.RequestException as exc:
            raise Exception(f"Falha de rede ao autenticar na Tradovate: {exc}") from exc

        data = self._json(res)

        if not res.ok:
            err_msg = data.get("errorText") or res.text
            raise Exception(f"Falha de autenticacao Tradovate: HTTP {res.status_code} - {err_msg}")

        # Resposta 200 sem accessToken = penalty ticket (rate limit / captcha)
        if not data.get("accessToken"):
            self._registrar_penalidade(data, res)

        self.access_token = data["accessToken"]

        exp_time = data.get("expirationTime")
        if exp_time:
            dt = datetime.fromisoformat(exp_time.replace("Z", "+00:00"))
            self.token_expiration = dt.timestamp()
        else:
            self.token_expiration = time.time() + 4800

        self._gravar_token_cache(self.access_token, self.token_expiration)

        return self.access_token

    def _headers(self):
        token = self.autenticar()
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def listar_contas(self):
        """Retorna todas as contas da Apex associadas a este login"""
        self._checar_penalidade()

        if self.cached_accounts and (time.time() - self.accounts_cached_at) < ACCOUNTS_CACHE_SECONDS:
            return self.cached_accounts

        url = f"{self.base_url}/account/list"
        res = requests.get(url, headers=self._headers(), timeout=10)
        if not res.ok:
            data = self._json(res)
            err_msg = data.get("errorText") or res.text
            if res.status_code in (401, 403):
                # Token invalido/expirado: limpa o cache para forcar nova autenticacao
                self.access_token = None
                self.token_expiration = 0
                self._remover_token_cache()
            raise Exception(f"Erro ao listar contas: {err_msg}")

        contas = res.json()
        self.cached_accounts = [
            {
                "id": acc.get("id"),
                "name": acc.get("name"),
                "account_type": acc.get("accountType", "Simulation"),
                "is_active": acc.get("active", True),
            }
            for acc in contas
        ]
        self.accounts_cached_at = time.time()
        return self.cached_accounts

    def executar_operacao(self, account_ids, symbol, direction, qty=1, sl_points=15.0, tp_points=30.0):
        """Dispara a ordem de entrada a mercado + Stop Loss de seguranca"""
        sl_seguro = min(float(sl_points), self.max_sl_cap)
        if sl_seguro <= 0:
            sl_seguro = 15.0

        action_entry = "Buy" if direction.upper() == "BUY" else "Sell"
        action_sl = "Sell" if action_entry == "Buy" else "Buy"

        headers = self._headers()
        resultados = []

        if not self.cached_accounts:
            self.listar_contas()

        for acc_id in account_ids:
            acc_info = next((a for a in self.cached_accounts if str(a["id"]) == str(acc_id)), None)
            acc_name = acc_info["name"] if acc_info else str(acc_id)

            try:
                # 1. Ordem a Mercado de Entrada
                order_payload = {
                    "accountSpec": self.username,
                    "accountId": int(acc_id),
                    "action": action_entry,
                    "symbol": symbol,
                    "orderQty": int(qty),
                    "orderType": "Market",
                    "isAutomated": False,
                }

                res_entry = requests.post(f"{self.base_url}/order/placeorder", json=order_payload, headers=headers, timeout=8)
                data_entry = self._json(res_entry)

                if not res_entry.ok:
                    resultados.append({
                        "account_id": acc_id,
                        "account_name": acc_name,
                        "status": "ERRO",
                        "message": data_entry.get("errorText", res_entry.text),
                    })
                    continue

                order_id = data_entry.get("orderId")

                # 2. Ordem de Protecao Stop Loss
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
                            "stopLoss": -sl_seguro if action_entry == "Buy" else sl_seguro,
                        }
                    },
                }

                requests.post(f"{self.base_url}/order/placeorder", json=sl_payload, headers=headers, timeout=5)

                resultados.append({
                    "account_id": acc_id,
                    "account_name": acc_name,
                    "status": "SUCESSO",
                    "order_id": order_id,
                    "sl_points": sl_seguro,
                    "tp_points": tp_points,
                    "qty": qty,
                })

            except Exception as e:
                resultados.append({
                    "account_id": acc_id,
                    "account_name": acc_name,
                    "status": "ERRO",
                    "message": str(e),
                })

        return resultados
