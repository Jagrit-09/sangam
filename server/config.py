"""Settings. Optional overrides come from a .env file (see .env.example)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
PUBLIC_DIR = ROOT / "public"


def _load_dotenv():
    f = ROOT / ".env"
    if not f.exists():
        return
    for line in f.read_text(encoding="utf8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip("\"'"))


_load_dotenv()


def _bool(name, default):
    v = os.environ.get(name, "")
    if v == "":
        return default
    return v.strip().lower() not in ("0", "false", "no", "off")


# HOST=0.0.0.0 makes the site reachable from other devices
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "3000"))
SHOW_DEMO_DATA = _bool("SHOW_DEMO_DATA", True)
COOKIE_SECURE = _bool("COOKIE_SECURE", False)
DB_PATH = Path(os.environ.get("SANGAM_DB", DATA_DIR / "sangam.db"))
SESSION_COOKIE = "sangam_session"
SESSION_MAX_AGE = 30 * 24 * 60 * 60
