"""
Teste unico de credenciais Tradovate/Apex.

Uso (a partir da pasta sentinel):
    python test_tradovate.py            # 1 tentativa de autenticacao + account/list
    python test_tradovate.py --appid "Meu App"  # testa outro appId

IMPORTANTE: o endpoint /auth/accesstokenrequest permite apenas 5 tentativas
FALHAS por hora. Se o script rodar em loop ele vai estourar o limite e
bloquear a conta por ~1h (penalty ticket com p-captcha). Rode uma unica vez.
"""

import os
import sys

import requests
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

USER = os.getenv("TRADOVATE_USER", "").strip()
PASSWORD = os.getenv("TRADOVATE_PASSWORD", "").strip()
ENV = os.getenv("TRADOVATE_ENV", "live").lower()
APP_ID = "Sample App"
APP_VERSION = "1.0"

for i, arg in enumerate(sys.argv):
    if arg == "--appid" and i + 1 < len(sys.argv):
        APP_ID = sys.argv[i + 1]

BASE = "https://live.tradovateapi.com/v1" if ENV == "live" else "https://demo.tradovateapi.com/v1"
HEADERS = {"Content-Type": "application/json", "Accept": "application/json"}

print(f"env={ENV} base={BASE} appId={APP_ID!r} user={USER!r} senha_len={len(PASSWORD)}")
if not USER or not PASSWORD:
    print("FALHA: TRADOVATE_USER/TRADOVATE_PASSWORD ausentes no .env")
    sys.exit(1)

# --- 1) Autenticacao ---
payload = {
    "name": USER,
    "password": PASSWORD,
    "appId": APP_ID,
    "appVersion": APP_VERSION,
    "cid": 0,
    "sec": "",
    "deviceId": "lumi-copilot-desk-diagnostico",
}

try:
    res = requests.post(f"{BASE}/auth/accesstokenrequest", json=payload, headers=HEADERS, timeout=15)
except requests.RequestException as exc:
    print(f"FALHA DE REDE: {exc}")
    sys.exit(2)

try:
    data = res.json()
except ValueError:
    data = {}

if not res.ok:
    print(f"AUTENTICACAO FALHOU: HTTP {res.status_code} -> {data.get('errorText') or res.text}")
    sys.exit(3)

if not data.get("accessToken"):
    print("Penalty ticket (rate limit da Tradovate):")
    print(f"  p-message : {data.get('p-message')}")
    print(f"  p-time    : {data.get('p-time')}s")
    print(f"  p-captcha : {data.get('p-captcha')}")
    print("  -> Espere ~1h (ou peça reset ao suporte Tradovate) e rode o script UMA vez.")
    sys.exit(4)

token = data["accessToken"]
print(f"AUTENTICACAO OK (userStatus={data.get('userStatus')}, hasLive={data.get('hasLive')}, hasFunded={data.get('hasFunded')})")

# --- 2) Lista de contas ---
auth = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
res = requests.get(f"{BASE}/account/list", headers=auth, timeout=15)
try:
    accounts = res.json()
except ValueError:
    accounts = []

if not res.ok:
    print(f"ACCOUNT/LIST FALHOU: HTTP {res.status_code} -> {res.text[:400]}")
    sys.exit(5)

print(f"CONTAS: {len(accounts)}")
for acc in accounts:
    print(
        f"  - id={acc.get('id')} | name={acc.get('name')} | type={acc.get('accountType')} "
        f"| active={acc.get('active')} | cash={acc.get('cashBalance')}"
    )

apex = [a for a in accounts if "apex" in str(a.get("name", "")).lower()]
print(f"CONTAS COM 'APEX' NO NOME: {len(apex)}")
