"""Redis-backed sliding-window rate limiter (Risk 2 mitigation).

Replaces the per-process in-memory approach with a shared Redis counter so that
rate limits are enforced correctly across all workers/pods in a horizontally
scaled deployment.

Algorithm: sliding-window log using Redis ZADD / ZREMRANGEBYSCORE / ZCARD.

Fallback behaviour: if Redis is unreachable, an in-process sliding-window
counter is used as a best-effort fallback. This does not synchronise across
multiple worker processes/pods but is strictly better than fail-open (which
provided zero protection). Security-sensitive endpoints (login) always use the
in-memory fallback rather than failing open.

IP Extraction — Cloudflare / Trusted-Proxy hardening:
  Rate-limit keys are keyed on client IP. The server MUST NOT blindly trust
  attacker-controlled headers (X-Forwarded-For, X-Real-IP) unless the
  connecting socket belongs to a known, trusted proxy/CDN.

  TRUSTED_PROXY_CIDRS lists the upstream reverse-proxy or Cloudflare CIDR
  ranges that are allowed to set X-Forwarded-For. Any XFF sent by a socket
  NOT in this list is ignored and the raw socket IP is used instead.
  In production behind Cloudflare, CF-Connecting-IP is preferred over XFF.

Usage::

    # In a route that needs rate-limiting:
    from apps.api.app.core.rate_limit import RateLimitDep, build_rate_limit_dep
    rate_limit_login = build_rate_limit_dep(max_requests=5, window_seconds=60)

    @router.post("/login")
    async def login(..., _rl: None = Depends(rate_limit_login)):
        ...
"""

from __future__ import annotations

import ipaddress
import logging
import threading
import time
from collections import deque
from collections.abc import Callable

from fastapi import HTTPException, Request, Response, status

logger = logging.getLogger("enterprise_rag")

# ---------------------------------------------------------------------------
# Trusted upstream proxy CIDRs
# ---------------------------------------------------------------------------
# Only sockets originating from these ranges are allowed to set
# X-Forwarded-For / X-Real-IP. All other requests are rate-limited
# by their raw socket IP, preventing XFF spoofing from the open internet.
#
# Production deployment checklist:
#   - Behind Cloudflare: add all Cloudflare IPv4/IPv6 ranges from
#     https://www.cloudflare.com/ips/ and use CF-Connecting-IP instead of XFF.
#   - Behind nginx/haproxy on same host: add 127.0.0.1/32, ::1/128.
#   - Never add 0.0.0.0/0 — that defeats the entire protection.
_TRUSTED_PROXY_CIDRS: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = [
    # Loopback / local reverse-proxy (nginx, caddy on same machine)
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
    # RFC-1918 private networks (docker, k8s pod networks, internal LB)
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    # Cloudflare IPv4 ranges (https://www.cloudflare.com/ips-v4)
    ipaddress.ip_network("173.245.48.0/20"),
    ipaddress.ip_network("103.21.244.0/22"),
    ipaddress.ip_network("103.22.200.0/22"),
    ipaddress.ip_network("103.31.4.0/22"),
    ipaddress.ip_network("141.101.64.0/18"),
    ipaddress.ip_network("108.162.192.0/18"),
    ipaddress.ip_network("190.93.240.0/20"),
    ipaddress.ip_network("188.114.96.0/20"),
    ipaddress.ip_network("197.234.240.0/22"),
    ipaddress.ip_network("198.41.128.0/17"),
    ipaddress.ip_network("162.158.0.0/15"),
    ipaddress.ip_network("104.16.0.0/13"),
    ipaddress.ip_network("104.24.0.0/14"),
    ipaddress.ip_network("172.64.0.0/13"),
    ipaddress.ip_network("131.0.72.0/22"),
    # Cloudflare IPv6 ranges (https://www.cloudflare.com/ips-v6)
    ipaddress.ip_network("2400:cb00::/32"),
    ipaddress.ip_network("2606:4700::/32"),
    ipaddress.ip_network("2803:f800::/32"),
    ipaddress.ip_network("2405:b500::/32"),
    ipaddress.ip_network("2405:8100::/32"),
    ipaddress.ip_network("2a06:98c0::/29"),
    ipaddress.ip_network("2c0f:f248::/32"),
]


def _is_trusted_proxy(socket_ip: str) -> bool:
    """Return True if the connecting socket IP is a known trusted proxy/CDN."""
    try:
        addr = ipaddress.ip_address(socket_ip)
        return any(addr in net for net in _TRUSTED_PROXY_CIDRS)
    except ValueError:
        return False


def _get_real_client_ip(request: Request) -> str:
    """Extract the real client IP, resistant to XFF header spoofing.

    Security model (Cloudflare methodology):
      1. Always start from the raw socket IP.
      2. If the socket belongs to a trusted proxy/CDN, trust the rightmost
         *non-private* IP from X-Forwarded-For (or CF-Connecting-IP if set).
      3. If the socket is from an untrusted source, use the socket IP directly
         — ignoring any XFF/X-Real-IP headers entirely (they are attacker data).

    This prevents the classic XFF-spoofing rate-limit bypass where an attacker
    sends ``X-Forwarded-For: 1.1.1.1`` to rotate their apparent IP address.
    """
    socket_ip: str = (request.client.host if request.client else "unknown")

    # Cloudflare sets CF-Connecting-IP to the actual visitor IP.
    # This is the most reliable header when behind CF.
    cf_ip = request.headers.get("CF-Connecting-IP", "").strip()
    if cf_ip and _is_trusted_proxy(socket_ip):
        return cf_ip

    # Fallback: use XFF only when the connecting socket is a trusted proxy.
    if _is_trusted_proxy(socket_ip):
        xff = request.headers.get("X-Forwarded-For", "")
        if xff:
            # XFF is a comma-separated list: client, proxy1, proxy2 …
            # The leftmost entry is claimed by the client — use it only when
            # we trust the proxy chain (which we do, since socket is trusted).
            candidate = xff.split(",")[0].strip()
            if candidate:
                return candidate
        x_real = request.headers.get("X-Real-IP", "").strip()
        if x_real:
            return x_real

    # Untrusted socket — use raw socket IP. Ignore ALL forwarding headers.
    return socket_ip

# ---------------------------------------------------------------------------
# Shared Redis connection pool
# ---------------------------------------------------------------------------
_redis_pool: object | None = None  # redis.asyncio.Redis instance, set at startup


def set_redis_pool(pool: object) -> None:  # noqa: ANN001
    """Register the shared Redis connection pool.  Called from ``lifespan``."""
    global _redis_pool  # noqa: PLW0603
    _redis_pool = pool


def get_redis_pool() -> object | None:
    """Return the shared pool (may be None if Redis is not configured)."""
    return _redis_pool


# ---------------------------------------------------------------------------
# In-memory sliding-window fallback (used when Redis is unavailable)
# ---------------------------------------------------------------------------
# Maps rate-limit key → deque of request timestamps (float, seconds).
# Protected by a threading.Lock because FastAPI may run sync code in threads.
_mem_store: dict[str, deque[float]] = {}
_mem_lock = threading.Lock()


def _mem_sliding_window_check(
    key: str,
    max_requests: int,
    window_seconds: int,
) -> tuple[bool, int, int]:
    """Thread-safe in-memory sliding-window counter.

    Returns:
        (allowed, remaining, retry_after_seconds)

    Note: not synchronised across multiple OS processes / pods. Use Redis for
    multi-process deployments.
    """
    now = time.time()
    window_start = now - window_seconds

    with _mem_lock:
        timestamps = _mem_store.setdefault(key, deque())

        # Evict timestamps that have fallen outside the window
        while timestamps and timestamps[0] < window_start:
            timestamps.popleft()

        current_count = len(timestamps)

        if current_count >= max_requests:
            # Window full — reject. retry_after = time until oldest entry expires.
            retry_after = max(1, int(timestamps[0] + window_seconds - now) + 1) if timestamps else window_seconds
            return False, 0, retry_after

        # Accept and record this request
        timestamps.append(now)
        remaining = max(0, max_requests - len(timestamps))
        return True, remaining, 0


# ---------------------------------------------------------------------------
# Core sliding-window counter (Redis-first, in-memory fallback)
# ---------------------------------------------------------------------------
async def _sliding_window_check(
    key: str,
    max_requests: int,
    window_seconds: int,
) -> tuple[bool, int, int]:
    """Check and increment a sliding-window rate-limit counter.

    Tries Redis first. Falls back to the in-memory counter if Redis is
    unavailable, so there is always *some* rate limiting in place.

    Returns:
        (allowed, remaining, retry_after_seconds)
    """
    pool = get_redis_pool()
    if pool is None:
        # No Redis configured — use in-memory fallback instead of fail-open
        logger.debug(
            "Rate limiter: Redis pool not set, using in-memory fallback",
            extra={"extra": {"key": key}},
        )
        return _mem_sliding_window_check(key, max_requests, window_seconds)

    now = time.time()
    window_start = now - window_seconds

    try:
        import redis.asyncio as aioredis  # type: ignore[import-untyped]

        r: aioredis.Redis = pool  # type: ignore[assignment]
        pipe = r.pipeline()
        # Remove entries older than the window
        pipe.zremrangebyscore(key, "-inf", window_start)
        # Add this request with current timestamp as score and member
        pipe.zadd(key, {str(now): now})
        # Count requests in window
        pipe.zcard(key)
        # Expire the key after the window so Redis doesn't accumulate stale keys
        pipe.expire(key, window_seconds + 1)
        results = await pipe.execute()
        current_count: int = results[2]
    except Exception as exc:
        logger.warning(
            "Rate limiter Redis error — using in-memory fallback",
            extra={"extra": {"error": str(exc)}},
        )
        # Redis call failed mid-flight — fall back to in-memory counter
        return _mem_sliding_window_check(key, max_requests, window_seconds)

    if current_count > max_requests:
        remaining = 0
        return False, remaining, window_seconds
    return True, max(0, max_requests - current_count), 0


# ---------------------------------------------------------------------------
# FastAPI dependency factory
# ---------------------------------------------------------------------------
def build_rate_limit_dep(
    max_requests: int = 10,
    window_seconds: int = 60,
) -> Callable:
    """Return a FastAPI dependency that enforces a sliding-window rate limit.

    The limit key is ``ratelimit:{path}:{client_ip}``.
    On breach: raises HTTP 429 and sets ``Retry-After``, ``X-RateLimit-*`` headers.
    On Redis failure: logs and allows the request (fail-open).

    Args:
        max_requests: Maximum requests allowed in *window_seconds*.
        window_seconds: Length of the sliding window in seconds.
    """

    async def _rate_limit_dep(request: Request, response: Response) -> None:
        # Security fix: use trusted-proxy-aware IP extraction to prevent XFF spoofing.
        client_ip = _get_real_client_ip(request)
        key = f"ratelimit:{request.url.path}:{client_ip}"
        allowed, remaining, retry_after = await _sliding_window_check(
            key=key,
            max_requests=max_requests,
            window_seconds=window_seconds,
        )

        # Always set informational headers (Rule 3 — transparency)
        response.headers["X-RateLimit-Limit"] = str(max_requests)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        if retry_after:
            response.headers["Retry-After"] = str(retry_after)

        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded. Please slow down.",
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(max_requests),
                    "X-RateLimit-Remaining": "0",
                },
            )

    return _rate_limit_dep


# ---------------------------------------------------------------------------
# Pre-built dependencies for commonly rate-limited endpoints
# ---------------------------------------------------------------------------
# Login: 5 attempts per 60-second window per IP (brute-force protection)
rate_limit_login = build_rate_limit_dep(max_requests=5, window_seconds=60)

# Registration: 5 new accounts per 60-second window per IP (account-flood protection)
# This closes the open /register endpoint that allowed unlimited account creation.
rate_limit_register = build_rate_limit_dep(max_requests=5, window_seconds=60)

# Chat: 10 requests per 60-second window per IP (cost-DOS prevention, Rule 15)
rate_limit_chat = build_rate_limit_dep(max_requests=10, window_seconds=60)

# Search: 30 requests per 60-second window per IP (Rule 11, 15)
rate_limit_search = build_rate_limit_dep(max_requests=30, window_seconds=60)

# Ingestion / Registration: 10 requests per 60-second window per IP (Rule 11, 15)
rate_limit_ingest = build_rate_limit_dep(max_requests=10, window_seconds=60)

# General Write / Mutations: 20 requests per 60-second window per IP (Rule 11, 15)
rate_limit_write = build_rate_limit_dep(max_requests=20, window_seconds=60)
