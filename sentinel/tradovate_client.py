import json
import os
import re
import time
import uuid
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv
import windows_credentials

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# .env sempre a partir da pasta do sentinel (independe de onde o .py for executado)
load_dotenv(os.path.join(BASE_DIR, ".env"))
load_dotenv()

TOKEN_CACHE_FILE = os.path.join(BASE_DIR, ".tradovate_token.json")
DEVICE_ID_FILE = os.path.join(BASE_DIR, ".tradovate_device_id")
PENALTY_COOLDOWN_SECONDS = 3600
ACCOUNTS_CACHE_SECONDS = 15
CONTRACT_CACHE_SECONDS = 1800
FILL_TIMEOUT_SECONDS = 8

# Tick size usado apenas como fallback quando o produto nao devolve tickSize
TICK_FALLBACK = {
    "MNQ": 0.25, "NQ": 0.25, "MES": 0.25, "ES": 0.25, "YM": 0.25, "MYM": 0.25,
    "M2K": 0.1, "RTY": 0.1, "FDAX": 0.5, "M6E": 0.00005, "6E": 0.00005,
}

# Aliases de simbolo TradingView -> produto Tradovate
ALIASES_PRODUTO = {
    "NAS100": "NQ", "USTEC": "NQ", "US100": "NQ", "QQQ": "NQ", "TECH100": "NQ",
    "SPX": "ES", "SPX500": "ES", "US500": "ES", "US30": "ES",
    "DJ30": "YM", "DOW30": "YM",
    "GER40": "FDAX", "DAX": "FDAX",
    "UK100": "FESX",
    "BTCUSD": "BTC", "ETHUSD": "ETH",
}


class TradovatePenaltyError(Exception):
    """Tradovate limitou a aplicacao (rate limit / p-ticket com captcha)."""

    def __init__(self, message, retry_after=0, captcha=False):
        super().__init__(message)
        self.retry_after = retry_after
        self.captcha = captcha


class TradovateClient:
    def __init__(self):
        self.credentials = windows_credentials.read_secret(windows_credentials.SERVICE) or {}
        self._load_credentials()
        self.max_sl_cap = float(os.getenv("MAX_SL_POINTS", 25.0))
        self.dry_run_enabled = os.getenv("DRY_RUN", "false").strip().lower() in ("1", "true", "yes")

        # Endpoints oficiais da API Tradovate (sempre com 'tradovateapi.com')
        if self.env == "live":
            self.base_url = "https://live.tradovateapi.com/v1"
        else:
            self.base_url = "https://demo.tradovateapi.com/v1"

        self.access_token = None
        self.token_expiration = 0
        self.cached_accounts = []
        # deviceId: a Tradovate espera um UUID valido e estavel por instalacao
        self.device_id = self._carregar_device_id()

        # Controle de penalidade (rate limit / captcha) para nao martelar a API
        self.penalty_until = 0.0
        self.penalty_message = ""
        self.penalty_captcha = False
        self.penalty_ticket = None
        self.penalty_is_rate_limit = False
        self.auth_failures = 0
        self.accounts_cached_at = 0.0

        # Cache de resolucao de contrato (simbolo TradingView -> contrato Tradovate)
        self.contract_cache = {}

        # Apaga o antigo token em texto simples; novos tokens ficam no Credential Manager.
        try:
            if os.path.exists(TOKEN_CACHE_FILE):
                os.remove(TOKEN_CACHE_FILE)
        except OSError:
            pass

    def _load_credentials(self):
        """Carrega segredos somente do Gerenciador de Credenciais do Windows."""
        self.username = str(self.credentials.get("username", "")).strip()
        self.password = str(self.credentials.get("password", ""))
        self.env = str(self.credentials.get("env", "demo")).strip().lower()
        if self.env not in ("demo", "live"):
            self.env = "demo"
        self.app_id = str(self.credentials.get("app_id", "")).strip()
        self.app_version = str(self.credentials.get("app_version", "1.0")).strip() or "1.0"
        self.cid = str(self.credentials.get("cid", "")).strip()
        self.sec = str(self.credentials.get("sec", ""))
        self.base_url = (
            "https://live.tradovateapi.com/v1"
            if self.env == "live"
            else "https://demo.tradovateapi.com/v1"
        )

    def salvar_credenciais(self, credentials):
        """Persiste a configuração protegida pelo perfil Windows e limpa estado antigo."""
        normalized = {
            "username": str(credentials.get("username", "")).strip(),
            "password": str(credentials.get("password", "")),
            "env": str(credentials.get("env", "demo")).strip().lower(),
            "app_id": str(credentials.get("app_id", "")).strip(),
            "app_version": str(credentials.get("app_version", "1.0")).strip() or "1.0",
            "cid": str(credentials.get("cid", "")).strip(),
            "sec": str(credentials.get("sec", "")),
        }
        if not all(normalized[k] for k in ("username", "password", "app_id", "cid", "sec")):
            raise ValueError("Preencha login, senha, nome da API Key, CID e SEC.")
        if normalized["env"] not in ("demo", "live"):
            raise ValueError("Selecione Demo ou Live.")
        windows_credentials.write_secret(windows_credentials.SERVICE, normalized)
        windows_credentials.remove_tradovate_env_entries(os.path.join(BASE_DIR, ".env"))
        for key in (
            "TRADOVATE_USER", "TRADOVATE_PASSWORD", "TRADOVATE_ENV",
            "TRADOVATE_APP_ID", "TRADOVATE_APP_VERSION", "TRADOVATE_CID", "TRADOVATE_SEC",
        ):
            os.environ.pop(key, None)
        self.credentials = normalized
        self._load_credentials()
        self._invalidar_token()
        windows_credentials.delete_secret(windows_credentials.TOKEN_SERVICE)
        self.cached_accounts = []
        self.accounts_cached_at = 0
        self.contract_cache.clear()

    # ------------------------------------------------------------------ #
    # Token em disco: reiniciar o sentinel.py nao deve gastar quota de auth
    # ------------------------------------------------------------------ #
    def _carregar_device_id(self):
        """UUID estavel da instalacao (a Tradovate exige deviceId valido)."""
        try:
            with open(DEVICE_ID_FILE, "r", encoding="utf-8") as f:
                valor = f.read().strip()
            if valor:
                uuid.UUID(valor)
                return valor
        except Exception:
            pass
        valor = str(uuid.uuid4())
        try:
            with open(DEVICE_ID_FILE, "w", encoding="utf-8") as f:
                f.write(valor)
        except Exception:
            pass
        return valor

    def _ler_token_cache(self):
        try:
            data = windows_credentials.read_secret(windows_credentials.TOKEN_SERVICE)
            if not isinstance(data, dict):
                return None
            # Tokens estao vinculados ao usuario, ambiente e chave de API.
            if (
                data.get("username") != self.username
                or data.get("env") != self.env
                or data.get("app_id") != self.app_id
                or str(data.get("cid") or "") != self.cid
            ):
                return None
            if data.get("token") and data.get("expiration", 0) > time.time() + 60:
                return data
        except Exception:
            pass
        return None

    def _gravar_token_cache(self, token, expiration):
        windows_credentials.write_secret(
            windows_credentials.TOKEN_SERVICE,
            {
                "token": token,
                "expiration": expiration,
                "username": self.username,
                "env": self.env,
                "app_id": self.app_id,
                "cid": self.cid,
            },
        )

    def _remover_token_cache(self):
        windows_credentials.delete_secret(windows_credentials.TOKEN_SERVICE)
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

    def _erro_api(self, res):
        data = self._json(res)
        return (
            data.get("errorText")
            or data.get("failureText")
            or data.get("rejectReason")
            or res.text
            or f"HTTP {res.status_code}"
        )

    def _registrar_penalidade(self, data, res):
        p_message = data.get("p-message") or res.text
        p_time = int(data.get("p-time") or 0)
        captcha = bool(data.get("p-captcha"))
        cooldown = PENALTY_COOLDOWN_SECONDS if captcha else max(p_time, 15)
        self.penalty_until = time.time() + cooldown
        self.penalty_message = str(p_message)
        self.penalty_captcha = captcha
        self.penalty_is_rate_limit = True
        # Ticket de penalidade: permite retry liberado pela propria Tradovate
        self.penalty_ticket = data.get("p-ticket")
        raise TradovatePenaltyError(
            f"Tradovate limitou a aplicacao: {p_message}. Tente novamente em {cooldown}s.",
            retry_after=cooldown,
            captcha=captcha,
        )

    def _registrar_falha_auth(self, mensagem):
        """Falha de autenticacao (senha/appId): escala o cooldown para nao
        queimar as 5 tentativas/hora da Tradovate."""
        self.auth_failures += 1
        if self.auth_failures >= 2:
            cooldown = PENALTY_COOLDOWN_SECONDS
        else:
            cooldown = 300
        self.penalty_until = time.time() + cooldown
        self.penalty_message = str(mensagem)
        self.penalty_captcha = False
        self.penalty_is_rate_limit = False
        raise TradovatePenaltyError(
            f"{mensagem}. Tente novamente em {cooldown}s.",
            retry_after=cooldown,
            captcha=False,
        )

    def _checar_penalidade(self):
        if self.penalty_until > time.time():
            restante = int(self.penalty_until - time.time())
            prefixo = "Tradovate limitou a aplicacao: " if self.penalty_is_rate_limit else ""
            raise TradovatePenaltyError(
                f"{prefixo}{self.penalty_message}. Tente novamente em {restante}s.",
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
            # Renova a sessao em vez de abrir outra (limite de 2 sessoes simultaneas)
            if self.access_token and time.time() < (self.token_expiration - 60):
                if time.time() > (self.token_expiration - 900):
                    token_novo = self._renovar_token(self.access_token)
                    if token_novo:
                        self.access_token = token_novo
                return self.access_token
            self._invalidar_token()

        url = f"{self.base_url}/auth/accesstokenrequest"
        payload = {
            "name": self.username,
            "password": self.password,
            "appId": self.app_id,
            "appVersion": self.app_version,
            "deviceId": self.device_id,
        }
        # API Key (cid/sec): obrigatorio nas contas novas - sem isso a Tradovate
        # responde "The app is not registered" (o appId "Sample App" nao existe).
        if self.cid and self.sec:
            payload["cid"] = self.cid
            payload["sec"] = self.sec
        # Retry liberado pela Tradovate: o p-ticket precisa voltar no corpo
        if self.penalty_ticket and not self.penalty_captcha:
            payload["p-ticket"] = self.penalty_ticket
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
            if "username or password" in str(err_msg).lower():
                err_msg = (
                    f"{err_msg} | Abra CONFIGURAR TRADOVATE no Sentinel e confira o login e a senha "
                    "(use o LOGIN do Tradovate/Trader - nao o nome da conta)."
                )
            self._registrar_falha_auth(f"Falha de autenticacao Tradovate: HTTP {res.status_code} - {err_msg}")

        # Resposta 200 sem accessToken:
        #  - com p-message/p-ticket => penalty de rate limit (o ticket libera o retry)
        #  - com errorText           => recusa de credencial (a Tradovate devolve 200!)
        if not data.get("accessToken"):
            if data.get("errorText"):
                err_msg = data["errorText"]
                if data.get("hibpHint"):
                    err_msg = f"{err_msg} (hibpHint: {data['hibpHint']})"
                baixo = str(err_msg).lower()
                if "app is not registered" in baixo:
                    err_msg = (
                        f"{err_msg} | A Tradovate nao reconhece o appId '{self.app_id}' para esta conta. "
                        "Gere/solicite uma API Key autorizada e informe appId, CID e SEC em CONFIGURAR TRADOVATE no Sentinel."
                    )
                elif "username or password" in baixo:
                    err_msg = (
                        f"{err_msg} | Abra CONFIGURAR TRADOVATE no Sentinel e confira o login e a senha "
                        "(use o LOGIN do Tradovate/Trader - nao o nome da conta)."
                    )
                self._registrar_falha_auth(f"Falha de autenticacao Tradovate: {err_msg}")
            if not (data.get("p-message") or data.get("p-ticket") or data.get("p-captcha")):
                self._registrar_falha_auth(
                    "Resposta de autenticacao invalida da Tradovate (sem token): " + str(data)[:200]
                )
            self._registrar_penalidade(data, res)

        self.access_token = data["accessToken"]
        self.auth_failures = 0
        self.penalty_ticket = None
        self.penalty_captcha = False
        self.penalty_until = 0.0
        self.penalty_message = ""

        exp_time = data.get("expirationTime")
        if exp_time:
            dt = datetime.fromisoformat(exp_time.replace("Z", "+00:00"))
            self.token_expiration = dt.timestamp()
        else:
            self.token_expiration = time.time() + 4800

        self._gravar_token_cache(self.access_token, self.token_expiration)

        return self.access_token

    def _renovar_token(self, token):
        """POST /auth/renewaccesstoken - mantem a sessao viva (evita abrir sessao nova)."""
        try:
            res = requests.post(
                f"{self.base_url}/auth/renewaccesstoken",
                json={"accessToken": token},
                headers={"Content-Type": "application/json", "Accept": "application/json"},
                timeout=12,
            )
            data = self._json(res)
            novo = data.get("accessToken")
            if novo:
                exp = data.get("expirationTime")
                if exp:
                    self.token_expiration = datetime.fromisoformat(exp.replace("Z", "+00:00")).timestamp()
                else:
                    self.token_expiration = time.time() + 4800
                self._gravar_token_cache(novo, self.token_expiration)
                return novo
        except Exception:
            pass
        return None

    def _headers(self):
        token = self.autenticar()
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    # ------------------------------------------------------------------ #
    # HTTP helpers (retry unico em 401/403, limpando o token)
    # ------------------------------------------------------------------ #
    def _invalidar_token(self):
        self.access_token = None
        self.token_expiration = 0
        self._remover_token_cache()

    def _get(self, path, params=None, timeout=12, retry=True):
        url = f"{self.base_url}{path}"
        res = requests.get(url, params=params, headers=self._headers(), timeout=timeout)
        if res.status_code in (401, 403):
            self._invalidar_token()
            if retry:
                return self._get(path, params=params, timeout=timeout, retry=False)
        if not res.ok:
            raise Exception(f"Erro GET {path}: HTTP {res.status_code} - {self._erro_api(res)}")
        try:
            return res.json()
        except Exception:
            return {}

    def _post(self, path, payload, timeout=12, retry=True):
        url = f"{self.base_url}{path}"
        res = requests.post(url, json=payload, headers=self._headers(), timeout=timeout)
        if res.status_code in (401, 403):
            self._invalidar_token()
            if retry:
                return self._post(path, payload, timeout=timeout, retry=False)
        if not res.ok:
            raise Exception(f"Erro POST {path}: HTTP {res.status_code} - {self._erro_api(res)}")
        return self._json(res)

    # ------------------------------------------------------------------ #
    # Contas
    # ------------------------------------------------------------------ #
    def listar_contas(self):
        """Retorna todas as contas da Apex associadas a este login"""
        self._checar_penalidade()

        if self.cached_accounts and (time.time() - self.accounts_cached_at) < ACCOUNTS_CACHE_SECONDS:
            return self.cached_accounts

        contas = self._get("/account/list", timeout=12)
        if not isinstance(contas, list):
            raise Exception(f"Resposta inesperada ao listar contas: {contas}")

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

    # ------------------------------------------------------------------ #
    # Resolucao de simbolo: TradingView (MNQ1!) -> contrato Tradovate (MNQM6)
    # ------------------------------------------------------------------ #
    @staticmethod
    def _parse_dt(valor):
        if not valor:
            return None
        try:
            return datetime.fromisoformat(str(valor).replace("Z", "+00:00"))
        except Exception:
            return None

    def _raiz_produto(self, simbolo):
        """'MNQ1!' / 'MNQ1' / 'MNQM6' -> raiz de produto ou contrato exato."""
        s = (simbolo or "").strip().upper()
        if not s:
            raise Exception("Simbolo vazio: informe o ativo monitorado.")
        s = s.split(" ")[0].replace(" ", "")
        s = s.replace("!", "")
        # Contratos da corretora (MNQ1 / NQ1 / M2K1) -> produto
        m = re.fullmatch(r"([A-Z0-9]{1,5})1", s)
        if m:
            s = m.group(1)
        return ALIASES_PRODUTO.get(s, s)

    def _contrato_exato(self, nome):
        """Busca um contrato pelo nome exato (ex.: MNQM6). Retorna None se nao existir."""
        try:
            contrato = self._get("/contract/find", {"name": nome}, timeout=10)
        except Exception:
            return None
        if not isinstance(contrato, dict) or not contrato.get("name"):
            return None
        exp = self._parse_dt(contrato.get("expirationDate"))
        # Contrato continuo (sem vencimento) nao serve para operar
        if exp is None:
            return None
        if exp <= datetime.now(timezone.utc):
            return None
        return contrato
    def _contrato_front(self, raiz, produto):
        """Contrato de vencimento mais proximo (front month) via ContractMaturity."""
        pid = produto.get("id")
        if not pid:
            return None
        try:
            vencimentos = self._get("/contractMaturity/ldeps", {"masterids": pid}, timeout=12)
        except Exception:
            return None
        if not isinstance(vencimentos, list):
            return None

        agora = datetime.now(timezone.utc)
        validos = []
        for v in vencimentos:
            exp = self._parse_dt(v.get("expirationDate"))
            if exp and exp > agora:
                validos.append((v, exp))
        if not validos:
            return None

        escolhido = None
        for v, _ in validos:
            if v.get("isFront"):
                escolhido = v
                break
        if escolhido is None:
            escolhido = min(validos, key=lambda item: item[1])[0]

        try:
            contratos = self._get("/contract/deps", {"masterid": escolhido["id"]}, timeout=12)
        except Exception:
            return None
        if not isinstance(contratos, list) or not contratos:
            return None

        for contrato in contratos:
            nome = str(contrato.get("name") or "").upper()
            if nome.startswith(raiz):
                return contrato
        return contratos[0]

    def _contrato_suggest(self, raiz):
        """Fallback: procura o contrato mais proximo do vencimento via /contract/suggest."""
        try:
            lista = self._get("/contract/suggest", {"t": raiz, "l": 100}, timeout=12)
        except Exception:
            return None
        if not isinstance(lista, list):
            return None

        agora = datetime.now(timezone.utc)
        validos = []
        for contrato in lista:
            nome = str(contrato.get("name") or "").upper()
            if not nome.startswith(raiz):
                continue
            exp = self._parse_dt(contrato.get("expirationDate"))
            if exp and exp > agora:
                validos.append((contrato, exp))
        if not validos:
            return None
        return min(validos, key=lambda item: item[1])[0]

    def resolver_contrato(self, simbolo):
        """Resolve o simbolo monitorado para um contrato operavel na Tradovate.

        Retorna dict com symbol (ex.: 'MNQM6'), product, contractId, tickSize e valuePerPoint.
        """
        raiz = self._raiz_produto(simbolo)

        cache = self.contract_cache.get(raiz)
        if cache and (time.time() - cache[1]) < CONTRACT_CACHE_SECONDS:
            return cache[0]

        produto = {}
        try:
            produto = self._get("/product/find", {"name": raiz}, timeout=10) or {}
        except Exception:
            produto = {}

        if produto and produto.get("productType") not in (None, "", "Futures"):
            raise Exception(
                f"Produto '{raiz}' nao e um futuro operavel (tipo: {produto.get('productType')})."
            )

        contrato = None
        # 1) simbolo exato (ex.: MNQM6)
        candidato = (simbolo or "").strip().upper().replace(" ", "").replace("!", "")
        if candidato and candidato != raiz:
            contrato = self._contrato_exato(candidato)
        # 2) contrato ativo (front month)
        if not contrato:
            contrato = self._contrato_front(raiz, produto)
        # 3) fallback por busca textual
        if not contrato:
            contrato = self._contrato_suggest(raiz)

        if not contrato:
            raise Exception(
                f"Contrato nao encontrado para '{simbolo}' (produto '{raiz}'). "
                "Verifique o simbolo do grafico no TradingView."
            )

        # Contrato exato: usa o produto real do contrato (ex.: MNQM6 -> MNQ)
        produto_real = contrato.get("productName") or raiz
        if produto_real != raiz and not produto:
            try:
                produto = self._get("/product/find", {"name": produto_real}, timeout=10) or {}
            except Exception:
                produto = {}

        tick = produto.get("tickSize") or TICK_FALLBACK.get(produto_real) or TICK_FALLBACK.get(raiz) or 0.25
        info = {
            "symbol": contrato.get("name"),
            "product": produto_real,
            "contractId": contrato.get("id"),
            "expirationDate": contrato.get("expirationDate"),
            "tickSize": float(tick),
            "valuePerPoint": float(produto.get("valuePerPoint") or 0),
            "productStatus": produto.get("status"),
        }
        self.contract_cache[raiz] = (info, time.time())
        return info

    # ------------------------------------------------------------------ #
    # Preenchimento e preco de referencia
    # ------------------------------------------------------------------ #
    def _preco_posicao(self, account_id, contract_id):
        """Preco medio da posicao (fallback quando o fill nao aparece na API)."""
        posicoes = []
        try:
            posicoes = self._get("/position/deps", {"masterid": account_id}, timeout=10) or []
        except Exception:
            try:
                posicoes = self._get("/position/list", timeout=10) or []
            except Exception:
                return None
        if not isinstance(posicoes, list):
            return None

        for pos in posicoes:
            if contract_id and pos.get("contractId") and int(pos["contractId"]) != int(contract_id):
                continue
            qty = int(pos.get("netQuantity") or 0)
            if qty == 0:
                continue
            preco = pos.get("averagePrice") or pos.get("avgPrice")
            if preco:
                return {"price": float(preco), "qty": abs(qty)}
        return None

    def _aguardar_preenchimento(self, order_id, account_id, contract_id):
        """Aguarda o fill da ordem a mercado e devolve {price, qty}."""
        limite = time.time() + FILL_TIMEOUT_SECONDS
        while time.time() < limite:
            try:
                fills = self._get("/fill/ldeps", {"masterids": order_id}, timeout=8) or []
            except Exception:
                fills = []
            if isinstance(fills, list) and fills:
                ativos = [f for f in fills if f.get("active", True)] or fills
                qty = sum(int(f.get("qty") or 0) for f in ativos)
                total = sum(float(f.get("price") or 0) * int(f.get("qty") or 0) for f in ativos)
                if qty:
                    return {"price": total / qty, "qty": qty}
                return {"price": float(ativos[-1].get("price") or 0), "qty": 1}
            time.sleep(0.25)
        return self._preco_posicao(account_id, contract_id)

    @staticmethod
    def _alinhar_tick(preco, tick):
        if not tick:
            return round(float(preco), 6)
        return round(round(float(preco) / tick) * tick, 6)

    # ------------------------------------------------------------------ #
    # Pre-check (dry run): valida contrato/preco/limites sem enviar ordem
    # ------------------------------------------------------------------ #
    def dry_run(self, account_id, info, action, qty, sl_preco=None, tp_preco=None):
        """Valida a ordem (e o bracket) na Tradovate sem executar."""
        contract_id = info.get("contractId")
        if not contract_id:
            return {"ok": True, "skipped": "Contrato sem id: dry run indisponivel"}

        orders = [
            {
                "contractId": int(contract_id),
                "action": action,
                "orderQty": int(qty),
                "orderType": "Market",
            }
        ]
        if sl_preco is not None:
            orders.append({
                "contractId": int(contract_id),
                "action": "Sell" if action == "Buy" else "Buy",
                "orderQty": int(qty),
                "orderType": "Stop",
                "stopPrice": float(sl_preco),
            })
        if tp_preco is not None:
            orders.append({
                "contractId": int(contract_id),
                "action": "Sell" if action == "Buy" else "Buy",
                "orderQty": int(qty),
                "orderType": "Limit",
                "price": float(tp_preco),
            })

        resposta = self._post("/order/dryrun", {"accountId": int(account_id), "orders": orders}, timeout=12)
        erro = resposta.get("errorText") or resposta.get("rejectReason")
        return {
            "ok": not erro,
            "error": erro,
            "rejectReason": resposta.get("rejectReason"),
            "raw": resposta,
        }

    # ------------------------------------------------------------------ #
    # Execucao: entrada a mercado + bracket OCO (Stop Loss + Take Profit)
    # ------------------------------------------------------------------ #
    def executar_operacao(self, account_ids, symbol, direction, qty=1, sl_points=15.0, tp_points=30.0, dry_run=None):
        """Entrada a mercado com bracket OCO (Stop Loss + Take Profit) por conta."""
        usar_dry_run = self.dry_run_enabled if dry_run is None else bool(dry_run)
        sl_seguro = min(float(sl_points), self.max_sl_cap)
        if sl_seguro <= 0:
            sl_seguro = 15.0
        tp_seguro = float(tp_points or 0)
        if tp_seguro <= 0:
            tp_seguro = sl_seguro * 2

        info = self.resolver_contrato(symbol)
        sym = info["symbol"]
        tick = info["tickSize"]
        vpp = info.get("valuePerPoint") or 0

        is_buy = str(direction).upper().startswith("BUY")
        action_entry = "Buy" if is_buy else "Sell"
        action_exit = "Sell" if is_buy else "Buy"

        if not self.cached_accounts:
            self.listar_contas()

        resultados = []
        for acc_id in account_ids:
            acc_info = next((a for a in self.cached_accounts if str(a["id"]) == str(acc_id)), None)
            acc_name = (acc_info or {}).get("name") or str(acc_id)
            # Tradovate espera accountSpec com o login, e accountId com a conta.
            account_spec = self.username
            base = {
                "account_id": acc_id,
                "account_name": acc_name,
                "symbol": sym,
                "product": info["product"],
                "sl_points": sl_seguro,
                "tp_points": tp_seguro,
                "qty": int(qty),
            }

            entry_filled = False
            preco = None
            sl_preco = None
            tp_preco = None
            qty_filled = int(qty)

            try:
                # 0) Pre-check opcional (dry run): valida contrato/preco/limites
                if usar_dry_run:
                    check = self.dry_run(acc_id, info, action_entry, int(qty))
                    if not check.get("ok"):
                        raise Exception(f"Dry run rejeitou a ordem: {check.get('error')}")

                # 1) Entrada a mercado
                entry = self._post(
                    "/order/placeorder",
                    {
                        "accountSpec": account_spec,
                        "accountId": int(acc_id),
                        "action": action_entry,
                        "symbol": sym,
                        "orderQty": int(qty),
                        "orderType": "Market",
                        "isAutomated": True,
                    },
                    timeout=12,
                )
                order_id = entry.get("orderId")
                if entry.get("failureReason") not in (None, "", "Success"):
                    raise Exception(entry.get("failureText") or entry["failureReason"])
                if not order_id:
                    raise Exception(entry.get("failureText") or "Resposta da Tradovate sem orderId")

                # 2) Espera o preenchimento para calcular os preco absolutos
                fill = self._aguardar_preenchimento(order_id, acc_id, info.get("contractId"))
                if not fill:
                    try:
                        self._post(
                            "/order/cancelorder",
                            {"accountId": int(acc_id), "orderId": int(order_id)},
                            timeout=6,
                        )
                    except Exception:
                        pass
                    raise Exception(f"Entrada {order_id} nao confirmada (ordem cancelada)")

                entry_filled = True
                preco = self._alinhar_tick(fill["price"], tick)
                qty_filled = int(fill.get("qty") or qty)
                sl_preco = self._alinhar_tick(preco - sl_seguro if is_buy else preco + sl_seguro, tick)
                tp_preco = self._alinhar_tick(preco + tp_seguro if is_buy else preco - tp_seguro, tick)

                # 3) Bracket OCO: Stop (SL) + Limit (TP) - um cancela o outro
                oco_payload = {
                    "accountSpec": account_spec,
                    "accountId": int(acc_id),
                    "action": action_exit,
                    "symbol": sym,
                    "orderQty": qty_filled,
                    "orderType": "Stop",
                    "price": sl_preco,
                    "isAutomated": True,
                    "timeInForce": "GTC",
                    "other": {
                        "action": action_exit,
                        "orderType": "Limit",
                        "price": tp_preco,
                        "timeInForce": "GTC",
                    },
                }
                oco = self._post("/order/placeoco", oco_payload, timeout=12)
                if oco.get("failureReason") not in (None, "", "Success"):
                    # Nao repetir a mesma OCO com outro TIF depois da rejeicao: evita duplicacao.
                    raise Exception(oco.get("failureText") or oco["failureReason"])
                if not oco.get("orderId"):
                    # Retry sem GTC (algumas contas so aceitam Day)
                    oco_payload.pop("timeInForce", None)
                    oco_payload["other"].pop("timeInForce", None)
                    oco = self._post("/order/placeoco", oco_payload, timeout=12)
                if oco.get("failureReason") not in (None, "", "Success"):
                    raise Exception(oco.get("failureText") or oco["failureReason"])
                if not oco.get("orderId"):
                    raise Exception(oco.get("failureText") or "OCO rejeitado pela Tradovate")

                resultados.append({
                    **base,
                    "status": "SUCESSO",
                    "order_id": order_id,
                    "oco_id": oco.get("ocoId"),
                    "fill_price": preco,
                    "sl_price": sl_preco,
                    "tp_price": tp_preco,
                    "risk_usd": round(sl_seguro * vpp * qty_filled, 2) if vpp else None,
                })

            except Exception as e:
                # Se a entrada foi preenchida e o bracket falhou, protege a posicao
                if entry_filled and preco is not None and sl_preco is not None:
                    try:
                        stop = self._post(
                            "/order/placeorder",
                            {
                                "accountSpec": account_spec,
                                "accountId": int(acc_id),
                                "action": action_exit,
                                "symbol": sym,
                                "orderQty": qty_filled,
                                "orderType": "Stop",
                                "price": sl_preco,
                                "isAutomated": True,
                            },
                            timeout=10,
                        )
                        resultados.append({
                            **base,
                            "status": "PARCIAL",
                            "order_id": order_id,
                            "fill_price": preco,
                            "sl_price": sl_preco,
                            "tp_price": tp_preco,
                            "risk_usd": round(sl_seguro * vpp * qty_filled, 2) if vpp else None,
                            "message": (
                                f"Bracket falhou ({e}). Stop Loss avulso enviado em {sl_preco}. "
                                "Take Profit NAO foi posicionado."
                            ),
                        })
                        continue
                    except Exception as e2:
                        resultados.append({
                            **base,
                            "status": "ERRO CRITICO",
                            "order_id": order_id,
                            "fill_price": preco,
                            "message": (
                                f"Bracket e Stop avulso falharam ({e} / {e2}). "
                                "POSICAO SEM PROTECAO - agir imediatamente."
                            ),
                        })
                        continue

                resultados.append({
                    **base,
                    "status": "ERRO",
                    "message": str(e),
                })

        return resultados
