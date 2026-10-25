"""Small Windows Credential Manager wrapper for local Tradovate secrets."""
import ctypes
import json
import os
from ctypes import wintypes


SERVICE = "Lumitechia.CopilotIATV.Tradovate.v1"
TOKEN_SERVICE = SERVICE + ".token"
CRED_TYPE_GENERIC = 1
CRED_PERSIST_LOCAL_MACHINE = 2
ERROR_NOT_FOUND = 0x490


class _FILETIME(ctypes.Structure):
    _fields_ = [("dwLowDateTime", wintypes.DWORD), ("dwHighDateTime", wintypes.DWORD)]


class _CREDENTIALW(ctypes.Structure):
    _fields_ = [
        ("Flags", wintypes.DWORD),
        ("Type", wintypes.DWORD),
        ("TargetName", wintypes.LPWSTR),
        ("Comment", wintypes.LPWSTR),
        ("LastWritten", _FILETIME),
        ("CredentialBlobSize", wintypes.DWORD),
        ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
        ("Persist", wintypes.DWORD),
        ("AttributeCount", wintypes.DWORD),
        ("Attributes", ctypes.c_void_p),
        ("TargetAlias", wintypes.LPWSTR),
        ("UserName", wintypes.LPWSTR),
    ]


def _api():
    if os.name != "nt":
        raise OSError("O armazenamento seguro do Sentinel requer Windows.")
    dll = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
    dll.CredWriteW.argtypes = [ctypes.POINTER(_CREDENTIALW), wintypes.DWORD]
    dll.CredWriteW.restype = wintypes.BOOL
    dll.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                              ctypes.POINTER(ctypes.POINTER(_CREDENTIALW))]
    dll.CredReadW.restype = wintypes.BOOL
    dll.CredFree.argtypes = [ctypes.c_void_p]
    dll.CredFree.restype = None
    dll.CredDeleteW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
    dll.CredDeleteW.restype = wintypes.BOOL
    return dll


def write_secret(target, value):
    dll = _api()
    blob = json.dumps(value, ensure_ascii=False).encode("utf-8")
    if len(blob) > 2560:
        raise ValueError("O conteúdo excede o limite do Gerenciador de Credenciais do Windows.")
    buffer = (ctypes.c_ubyte * len(blob)).from_buffer_copy(blob)
    credential = _CREDENTIALW(
        Flags=0,
        Type=CRED_TYPE_GENERIC,
        TargetName=target,
        Comment="Sentinel local Tradovate credentials",
        LastWritten=_FILETIME(0, 0),
        CredentialBlobSize=len(blob),
        CredentialBlob=ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)),
        Persist=CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount=0,
        Attributes=None,
        TargetAlias=None,
        UserName="Sentinel",
    )
    if not dll.CredWriteW(ctypes.byref(credential), 0):
        raise ctypes.WinError(ctypes.get_last_error())


def read_secret(target):
    dll = _api()
    pointer = ctypes.POINTER(_CREDENTIALW)()
    if not dll.CredReadW(target, CRED_TYPE_GENERIC, 0, ctypes.byref(pointer)):
        error = ctypes.get_last_error()
        if error == ERROR_NOT_FOUND:
            return None
        raise ctypes.WinError(error)
    try:
        credential = pointer.contents
        raw = ctypes.string_at(credential.CredentialBlob, credential.CredentialBlobSize)
        return json.loads(raw.decode("utf-8"))
    finally:
        dll.CredFree(pointer)


def delete_secret(target):
    dll = _api()
    if not dll.CredDeleteW(target, CRED_TYPE_GENERIC, 0):
        error = ctypes.get_last_error()
        if error != ERROR_NOT_FOUND:
            raise ctypes.WinError(error)


def remove_tradovate_env_entries(path):
    """Remove only legacy Tradovate variables after secure save; preserve other .env values."""
    if not os.path.isfile(path):
        return
    with open(path, "r", encoding="utf-8-sig") as source:
        lines = source.readlines()
    kept = []
    for line in lines:
        key = line.partition("=")[0].strip()
        if key.startswith("export "):
            key = key[7:].strip()
        if not key.startswith("TRADOVATE_"):
            kept.append(line)
    if len(kept) != len(lines):
        with open(path, "w", encoding="utf-8", newline="") as target:
            target.writelines(kept)
