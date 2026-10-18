"""Password hashing and rate limiting."""
import hashlib
import hmac
import secrets
import threading
import time

_N, _R, _P = 2 ** 14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    try:
        h = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=64)
        return f"scrypt${salt.hex()}${h.hex()}"
    except (AttributeError, ValueError):  # Python built without scrypt
        h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000, 64)
        return f"pbkdf2${salt.hex()}${h.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_hex, hash_hex = stored.split("$")
        salt, expected = bytes.fromhex(salt_hex), bytes.fromhex(hash_hex)
        if scheme == "scrypt":
            actual = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=len(expected))
        elif scheme == "pbkdf2":
            actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000, len(expected))
        else:
            return False
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Limiter:
    """At most max_hits per window seconds, per key."""

    def __init__(self, max_hits, window):
        self.max, self.window = max_hits, window
        self.hits = {}
        self.lock = threading.Lock()

    def check(self, key) -> bool:
        now = time.time()
        with self.lock:
            arr = [t for t in self.hits.get(key, []) if now - t < self.window]
            if len(arr) >= self.max:
                self.hits[key] = arr
                return False
            arr.append(now)
            self.hits[key] = arr
            return True
