"""
Teste unico de credenciais Tradovate/Apex + resolucao de contrato + dry run.

Uso (a partir da pasta sentinel):
    python test_tradovate.py                      # auth + contas + resolve MNQ1!
    python test_tradovate.py --symbol MNQ1!       # resolve outro simbolo
    python test_tradovate.py --dryrun             # valida a ordem (NAO envia ordem real)

IMPORTANTE: o endpoint /auth/accesstokenrequest permite apenas 5 tentativas
FALHAS por hora. Se o script rodar em loop ele vai estourar o limite e
bloquear a conta por ~1h (penalty ticket com p-captcha). Rode uma unica vez.
O token valido fica salvo em .tradovate_token.json e e reaproveitado.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tradovate_client import TradovateClient, TradovatePenaltyError  # noqa: E402

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

SIMBOLO = "MNQ1!"
DRY_RUN = False

argv = sys.argv[1:]
for i, arg in enumerate(argv):
    if arg == "--symbol" and i + 1 < len(argv):
        SIMBOLO = argv[i + 1]
    elif arg == "--dryrun":
        DRY_RUN = True

client = TradovateClient()
print(f"env={client.env} base={client.base_url} user={client.username!r}")

# --- 1) Autenticacao (+ lista de contas) ---
try:
    contas = client.listar_contas()
except TradovatePenaltyError as exc:
    print(f"PENALTY: {exc}")
    print("  -> Espere o tempo indicado (ou peça reset ao suporte Tradovate) e rode o script UMA vez.")
    sys.exit(4)
except Exception as exc:
    print(f"FALHA: {exc}")
    sys.exit(3)

print(f"AUTENTICACAO OK - {len(contas)} conta(s):")
for acc in contas:
    print(f"  - id={acc['id']} | name={acc['name']} | type={acc['account_type']} | ativo={acc['is_active']}")

apex = [a for a in contas if "apex" in str(a["name"]).lower()]
print(f"CONTAS COM 'APEX' NO NOME: {len(apex)}")

# --- 2) Resolucao do simbolo monitorado ---
try:
    info = client.resolver_contrato(SIMBOLO)
except TradovatePenaltyError as exc:
    print(f"PENALTY: {exc}")
    sys.exit(4)
except Exception as exc:
    print(f"FALHA AO RESOLVER '{SIMBOLO}': {exc}")
    sys.exit(6)

print()
print(f"RESOLUCAO: {SIMBOLO} -> {info['symbol']}")
print(f"  produto   : {info['product']} (status: {info.get('productStatus')})")
print(f"  vencimento: {info.get('expirationDate')}")
print(f"  tick      : {info['tickSize']} | valor por ponto: ${info['valuePerPoint']}")

# --- 3) Dry run (valida sem enviar ordem) ---
if DRY_RUN:
    if not contas:
        print("Dry run: sem contas para testar.")
        sys.exit(7)
    acc = contas[0]
    try:
        check = client.dry_run(acc["id"], info, "Buy", 1)
    except TradovatePenaltyError as exc:
        print(f"PENALTY: {exc}")
        sys.exit(4)
    except Exception as exc:
        print(f"FALHA NO DRY RUN: {exc}")
        sys.exit(8)

    print()
    print(f"DRY RUN conta {acc['id']} ({acc['name']}):")
    print(f"  ok={check.get('ok')} erro={check.get('error')} motivo={check.get('rejectReason')}")
    if not check.get("ok"):
        sys.exit(9)

print()
print("TUDO OK")
