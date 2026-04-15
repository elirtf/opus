"""
JWT session auth, optional reverse-proxy header auth, and client IP helpers.

Used from Flask-Login's request_loader and from auth routes (cookie issuance).
"""

from __future__ import annotations

import ipaddress
import os
import secrets
import time
from typing import Any

import jwt
from flask import Request, current_app, g, has_request_context, request
from werkzeug.security import check_password_hash

from app.models import User

OPUS_SESSION_COOKIE = "opus_session"
JWT_ALG = "HS256"
REFRESH_REMAINING_SEC = 1800


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    s = str(raw).strip().lower()
    if s == "":
        return default
    return s in ("1", "true", "yes", "on")


def proxy_auth_enabled() -> bool:
    return env_bool("OPUS_PROXY_AUTH", False)


def _jwt_secret_candidates(app) -> list[str]:
    """Resolution order: OPUS_JWT_SECRET → .jwt_secret next to config → same next to DB."""
    out: list[str] = []
    env_s = (os.environ.get("OPUS_JWT_SECRET") or "").strip()
    if env_s:
        out.append(env_s)
    cfg_parent = os.path.dirname((app.config.get("GO2RTC_CONFIG_PATH") or "/config/go2rtc.yaml").rstrip("/\\"))
    db_path = app.config.get("DATABASE_PATH") or ""
    db_parent = os.path.dirname(db_path) if db_path else ""
    for parent in (cfg_parent, db_parent, "."):
        if not parent:
            continue
        p = os.path.join(parent, ".jwt_secret")
        try:
            if os.path.isfile(p):
                with open(p, "r", encoding="utf-8") as f:
                    s = f.read().strip()
                if s and s not in out:
                    out.append(s)
        except OSError:
            pass
    return out


def get_jwt_secret(app) -> str:
    """
    OPUS_JWT_SECRET env → read/create .jwt_secret under config dir (GO2RTC parent),
    then same filename next to the SQLite file.
    """
    cands = _jwt_secret_candidates(app)
    if cands:
        return cands[0]
    cfg_parent = os.path.dirname((app.config.get("GO2RTC_CONFIG_PATH") or "/config/go2rtc.yaml").rstrip("/\\"))
    try:
        os.makedirs(cfg_parent, exist_ok=True)
    except OSError:
        cfg_parent = os.path.dirname((app.config.get("DATABASE_PATH") or ".") or ".") or "."
    path = os.path.join(cfg_parent, ".jwt_secret")
    sk = secrets.token_hex(32)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(sk)
    except OSError:
        return secrets.token_hex(32)
    return sk


def session_ttl_seconds() -> int:
    try:
        v = int((os.environ.get("OPUS_SESSION_LENGTH") or "86400").strip())
        return max(300, min(v, 86400 * 30))
    except ValueError:
        return 86400


def mint_jwt(app, user: User) -> str:
    now = int(time.time())
    exp = now + session_ttl_seconds()
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
        "iat": now,
        "exp": exp,
    }
    return jwt.encode(payload, get_jwt_secret(app), algorithm=JWT_ALG)


def decode_jwt(app, token: str) -> dict[str, Any] | None:
    if not token:
        return None
    secret = get_jwt_secret(app)
    for s in _jwt_secret_candidates(app) or [secret]:
        try:
            return jwt.decode(token, s, algorithms=[JWT_ALG])
        except jwt.InvalidTokenError:
            continue
    return None


def _trusted_proxy_nets() -> list[ipaddress._BaseNetwork]:
    raw = (os.environ.get("TRUSTED_PROXIES") or "").strip()
    if not raw:
        return []
    nets: list[ipaddress._BaseNetwork] = []
    for part in raw.split(","):
        p = part.strip()
        if not p:
            continue
        try:
            if "/" in p:
                nets.append(ipaddress.ip_network(p, strict=False))
            elif ":" in p:
                nets.append(ipaddress.ip_network(f"{p}/128", strict=False))
            else:
                nets.append(ipaddress.ip_network(f"{p}/32", strict=False))
        except ValueError:
            continue
    return nets


def _addr_in_nets(addr: str, nets: list[ipaddress._BaseNetwork]) -> bool:
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    return any(ip in n for n in nets)


def get_effective_client_ip(req: Request | None = None) -> str:
    """Real client IP; trust X-Forwarded-For only when the immediate peer is in TRUSTED_PROXIES."""
    if req is None:
        req = request
    ra = (req.remote_addr or "").strip() or "127.0.0.1"
    nets = _trusted_proxy_nets()
    if not nets or not _addr_in_nets(ra, nets):
        return ra
    xff = (req.headers.get("X-Forwarded-For") or "").strip()
    if not xff:
        return ra
    parts = [p.strip() for p in xff.split(",") if p.strip()]
    if not parts:
        return ra
    return parts[0]


def attach_session_cookie(response, token: str):
    response.set_cookie(
        OPUS_SESSION_COOKIE,
        token,
        max_age=session_ttl_seconds(),
        httponly=True,
        samesite="Strict",
        secure=bool(getattr(request, "is_secure", False)),
        path="/",
    )


def clear_session_cookie(response):
    response.delete_cookie(OPUS_SESSION_COOKIE, path="/")


def _load_user_from_legacy_bearer(raw: str) -> User | None:
    """Optional per-user API token hashes (pre-JWT automation)."""
    q = User.select().where(User.api_token_hash.is_null(False))
    for user in q:
        if user.api_token_hash and check_password_hash(user.api_token_hash, raw):
            return user
    return None


def _proxy_user(request: Request) -> User | None:
    secret = (os.environ.get("OPUS_PROXY_SECRET") or "").strip()
    hdr = (request.headers.get("X-Proxy-Secret") or "").strip()
    if not secret or not secrets.compare_digest(secret, hdr):
        return None
    username = (request.headers.get("X-Forwarded-User") or "").strip()
    if not username:
        return None
    role_hdr = (request.headers.get("X-Forwarded-Role") or "").strip().lower()
    if role_hdr not in ("admin", "viewer", ""):
        return None
    try:
        user = User.get(User.username == username)
    except User.DoesNotExist:
        return None
    if role_hdr and role_hdr != (user.role or "").lower():
        return None
    return user


def load_user_for_request(app, req: Request) -> User | None:
    """
    Resolve the authenticated User for this request (JWT cookie, JWT Bearer, legacy Bearer, proxy).
    Sets g.opus_jwt_rotation when a refreshed JWT should be applied on the response cookie.
    """
    g.opus_jwt_rotation = None
    if proxy_auth_enabled():
        return _proxy_user(req)

    token = None
    c = req.cookies.get(OPUS_SESSION_COOKIE)
    if c:
        token = c.strip()
    if not token:
        h = req.headers.get("Authorization", "") or ""
        if h.startswith("Bearer "):
            token = h[7:].strip()
    if not token:
        return None

    payload = decode_jwt(app, token)
    if payload is None:
        return _load_user_from_legacy_bearer(token)

    try:
        uid = int(payload.get("sub"))
    except (TypeError, ValueError):
        return None
    try:
        user = User.get_by_id(uid)
    except User.DoesNotExist:
        return None

    exp = payload.get("exp")
    try:
        exp_i = int(exp) if exp is not None else 0
    except (TypeError, ValueError):
        exp_i = 0
    if exp_i and (exp_i - int(time.time())) < REFRESH_REMAINING_SEC:
        g.opus_jwt_rotation = mint_jwt(app, user)
    return user


def apply_jwt_rotation(response):
    """Call from Flask after_request when g.opus_jwt_rotation is set."""
    if has_request_context():
        new_tok = getattr(g, "opus_jwt_rotation", None)
        if new_tok and response and getattr(response, "status_code", 200) < 400:
            attach_session_cookie(response, new_tok)
    return response
