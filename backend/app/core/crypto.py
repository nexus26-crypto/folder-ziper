"""Fernet symmetric encryption para credenciais de terceiros (senhas XUI).

Chave derivada de JWT_SECRET — não requer nova env var. Se você quiser rotacionar,
sete FERNET_KEY no .env (32 bytes url-safe base64).
"""
import base64
import hashlib
import os
from functools import lru_cache
from cryptography.fernet import Fernet, InvalidToken
from app.core.config import settings


@lru_cache
def _fernet() -> Fernet:
    raw = os.getenv("FERNET_KEY")
    if raw:
        key = raw.encode()
    else:
        digest = hashlib.sha256(settings.JWT_SECRET.encode()).digest()
        key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt(plain: str) -> str:
    if plain is None:
        return ""
    return _fernet().encrypt(plain.encode()).decode()


def decrypt(token: str) -> str:
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        # Compat: valores antigos gravados em texto puro voltam como estão.
        return token
