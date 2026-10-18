"""Database layer (SQLite)."""
import datetime
import json
import re
import secrets
import sqlite3
import threading
import time
import uuid

import config
from security import hash_password, verify_password, hash_token

PING_TTL_MS = 45 * 60 * 1000
PING_TYPES = {"emergency", "medical", "washroom", "stall", "crowd_hype", "crowd_calm", "general"}
EVENT_TYPES = ["college_fest", "small_gig", "major_concert"]
INTEREST_OPTIONS = [
    "EDM", "Rock", "Indie", "Pop", "Classical Fusion", "Acoustic",
    "Hip-Hop", "Jazz", "Photography", "Dance", "Travel", "Poetry",
]
AVATAR_PALETTE = ["#FFB627", "#47E0D2", "#FF5FA8", "#8C7CFF", "#6FCF7A", "#FF8A5B"]
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")


class ValidationError(Exception):
    pass


def bad(msg):
    raise ValidationError(msg)


def now_ms():
    return int(time.time() * 1000)


def iso_date(offset_days=0):
    return (datetime.date.today() + datetime.timedelta(days=offset_days)).isoformat()


_lock = threading.RLock()
_conn = None
seed_events = []
seed_users = []

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, name TEXT NOT NULL,
  color TEXT, age INTEGER, bio TEXT DEFAULT '', interests TEXT DEFAULT '[]',
  profile_complete INTEGER DEFAULT 0, created_at INTEGER);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER);
CREATE TABLE IF NOT EXISTS events(
  id TEXT PRIMARY KEY, created_by TEXT, created_at INTEGER, name TEXT, type TEXT, genre TEXT,
  venue TEXT, area TEXT, description TEXT, lat REAL, lng REAL, date TEXT, start_time TEXT,
  end_time TEXT, ticket_url TEXT, tips TEXT, venue_layout TEXT);
CREATE TABLE IF NOT EXISTS attendances(user_id TEXT, event_id TEXT, at INTEGER, PRIMARY KEY(user_id, event_id));
CREATE TABLE IF NOT EXISTS swipes(
  id TEXT PRIMARY KEY, user_id TEXT, target_id TEXT, event_id TEXT, direction TEXT, at INTEGER,
  UNIQUE(user_id, target_id, event_id));
CREATE TABLE IF NOT EXISTS matches(id TEXT PRIMARY KEY, event_id TEXT, a TEXT, b TEXT, at INTEGER);
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, match_id TEXT, sender TEXT, text TEXT, at INTEGER);
CREATE TABLE IF NOT EXISTS pings(
  id TEXT PRIMARY KEY, event_id TEXT, type TEXT, x REAL, y REAL, note TEXT, created_by TEXT,
  at INTEGER, expires_at INTEGER);
CREATE TABLE IF NOT EXISTS blocks(by_id TEXT, target_id TEXT, at INTEGER, PRIMARY KEY(by_id, target_id));
CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, by_id TEXT, target_id TEXT, reason TEXT, at INTEGER);
CREATE INDEX IF NOT EXISTS idx_msg_match ON messages(match_id, at);
CREATE INDEX IF NOT EXISTS idx_ping_event ON pings(event_id);
"""


def init():
    """Open the database and load the sample data. Safe to call more than once."""
    global _conn, seed_events, seed_users
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    if _conn:
        _conn.close()
    _conn = sqlite3.connect(str(config.DB_PATH), check_same_thread=False)
    _conn.row_factory = sqlite3.Row
    _conn.executescript(SCHEMA)
    _conn.commit()

    seed = json.loads((config.DATA_DIR / "seed.json").read_text(encoding="utf8"))
    if config.SHOW_DEMO_DATA:
        seed_events = []
        for e in seed["events"]:
            e = {k: v for k, v in e.items() if k not in ("transit", "daysFromNow")} | {
                "source": "demo", "date": iso_date(e["daysFromNow"])}
            seed_events.append(e)
        seed_users = seed["users"]
    else:
        seed_events, seed_users = [], []


def _q(sql, args=(), one=False, commit=False):
    with _lock:
        cur = _conn.execute(sql, args)
        rows = cur.fetchone() if one else cur.fetchall()
        if commit:
            _conn.commit()
        return rows


def _run(sql, args=()):
    with _lock:
        _conn.execute(sql, args)
        _conn.commit()


# ---------------- users ----------------

def _initials(name):
    return "".join(w[0] for w in (name or "?").split()[:2]).upper()


def _public(u):
    """u: sqlite Row (real user) -> public dict."""
    return {
        "id": u["id"], "name": u["name"], "initials": _initials(u["name"]), "color": u["color"],
        "age": u["age"], "bio": u["bio"] or "", "interests": json.loads(u["interests"] or "[]"),
        "profileComplete": bool(u["profile_complete"]), "demo": False,
    }


def _public_demo(u):
    return {
        "id": u["id"], "name": u["name"], "initials": u["initials"], "color": u["color"],
        "age": u["age"], "bio": u["bio"], "interests": u["interests"], "profileComplete": True, "demo": True,
    }


def _real_row(user_id):
    return _q("SELECT * FROM users WHERE id=?", (user_id,), one=True)


def get_user(user_id):
    r = _real_row(user_id)
    if r:
        return _public(r)
    d = next((u for u in seed_users if u["id"] == user_id), None)
    return _public_demo(d) if d else None


def get_self(user_id):
    r = _real_row(user_id)
    return {**_public(r), "email": r["email"]} if r else None


def is_demo_user(user_id):
    return any(u["id"] == user_id for u in seed_users)


def create_user(name, email, password):
    name = str(name or "").strip()
    email = str(email or "").strip().lower()
    password = str(password or "")
    if not 2 <= len(name) <= 50:
        bad("Please enter your name (2-50 characters).")
    if not EMAIL_RE.match(email) or len(email) > 120:
        bad("That email address doesn't look right.")
    if len(password) < 8:
        bad("Password needs at least 8 characters.")
    if len(password) > 200:
        bad("Password is too long.")
    with _lock:
        if _q("SELECT 1 FROM users WHERE email=?", (email,), one=True):
            bad("An account with that email already exists. Try logging in.")
        n = _q("SELECT COUNT(*) c FROM users", one=True)["c"]
        uid = "u_" + str(uuid.uuid4())
        _run(
            "INSERT INTO users(id,email,password_hash,name,color,created_at) VALUES(?,?,?,?,?,?)",
            (uid, email, hash_password(password), name, AVATAR_PALETTE[n % len(AVATAR_PALETTE)], now_ms()),
        )
    return uid


_DUMMY = hash_password("not-a-real-password")


def authenticate(email, password):
    """Always does a hash check, even for unknown emails, so timing doesn't reveal which exist."""
    r = _q("SELECT * FROM users WHERE email=?", (str(email or "").strip().lower(),), one=True)
    ok = verify_password(str(password or ""), r["password_hash"] if r else _DUMMY)
    return r["id"] if (r and ok) else None


def update_profile(user_id, name, age, bio, interests):
    if name is not None:
        name = str(name).strip()
        if not 2 <= len(name) <= 50:
            bad("Please enter your name (2-50 characters).")
    try:
        age = int(age)
    except (TypeError, ValueError):
        bad("Enter a valid age (16-99).")
    if not 16 <= age <= 99:
        bad("Enter a valid age (16-99).")
    bio = str(bio or "").strip()[:120]
    if not bio:
        bad("Add a one-line bio so people know who you are.")
    interests = [i for i in (interests or []) if i in INTEREST_OPTIONS][:6] if isinstance(interests, list) else []
    cur = _real_row(user_id)
    if not cur:
        return False
    _run(
        "UPDATE users SET name=?, age=?, bio=?, interests=?, profile_complete=1 WHERE id=?",
        (name or cur["name"], age, bio, json.dumps(interests), user_id),
    )
    return True


def delete_user(user_id):
    with _lock:
        mids = [r["id"] for r in _q("SELECT id FROM matches WHERE a=? OR b=?", (user_id, user_id))]
        for mid in mids:
            _conn.execute("DELETE FROM messages WHERE match_id=?", (mid,))
        _conn.execute("DELETE FROM matches WHERE a=? OR b=?", (user_id, user_id))
        _conn.execute("DELETE FROM swipes WHERE user_id=? OR target_id=?", (user_id, user_id))
        _conn.execute("DELETE FROM attendances WHERE user_id=?", (user_id,))
        _conn.execute("DELETE FROM blocks WHERE by_id=? OR target_id=?", (user_id, user_id))
        for r in _q("SELECT id FROM events WHERE created_by=?", (user_id,)):
            _conn.execute("DELETE FROM attendances WHERE event_id=?", (r["id"],))
        _conn.execute("DELETE FROM events WHERE created_by=?", (user_id,))
        _conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        _conn.execute("DELETE FROM users WHERE id=?", (user_id,))
        _conn.commit()


# ---------------- sessions ----------------

def create_session(user_id):
    token = secrets.token_hex(32)
    _run("INSERT INTO sessions VALUES(?,?,?)", (hash_token(token), user_id, now_ms()))
    return token


def session_user(token):
    if not token:
        return None
    r = _q("SELECT * FROM sessions WHERE token_hash=?", (hash_token(token),), one=True)
    if not r:
        return None
    if now_ms() - r["created_at"] > config.SESSION_MAX_AGE * 1000:
        destroy_session(token)
        return None
    return r["user_id"]


def destroy_session(token):
    if token:
        _run("DELETE FROM sessions WHERE token_hash=?", (hash_token(token),))


# ---------------- events ----------------

def _event_from_row(r):
    return {
        "id": r["id"], "source": "community", "createdBy": r["created_by"], "createdAt": r["created_at"],
        "name": r["name"], "type": r["type"], "genre": r["genre"], "venue": r["venue"], "area": r["area"],
        "description": r["description"], "lat": r["lat"], "lng": r["lng"], "date": r["date"],
        "startTime": r["start_time"], "endTime": r["end_time"], "ticketUrl": r["ticket_url"] or "",
        "tips": r["tips"] or "", "venueLayout": r["venue_layout"],
    }


def _all_events():
    rows = _q("SELECT * FROM events")
    return [_event_from_row(r) for r in rows] + [dict(e) for e in seed_events]


def going_count(event_id):
    real = _q("SELECT COUNT(*) c FROM attendances WHERE event_id=?", (event_id,), one=True)["c"]
    demo = sum(1 for u in seed_users if event_id in u["attendingEventIds"])
    return real + demo


def _decorate(e):
    e = dict(e)
    e["going"] = going_count(e["id"])
    if e.get("createdBy"):
        h = _real_row(e["createdBy"])
        e["hostName"] = h["name"] if h else "A Sangam member"
    return e


def validate_event(b):
    def s(key, lo, hi, label):
        v = str(b.get(key) if b.get(key) is not None else "").strip()
        if not lo <= len(v) <= hi:
            bad(f"{label} must be {lo}-{hi} characters.")
        return v

    name = s("name", 3, 80, "Event name")
    if b.get("type") not in EVENT_TYPES:
        bad("Pick an event type.")
    genre = s("genre", 2, 40, "Genre")
    venue = s("venue", 2, 80, "Venue")
    area = s("area", 2, 60, "Area")
    description = s("description", 10, 500, "Description")
    try:
        lat, lng = float(b.get("lat")), float(b.get("lng"))
    except (TypeError, ValueError):
        lat = lng = float("nan")
    if not (27.6 <= lat <= 29.1 and 76.6 <= lng <= 77.9):
        bad("Pick the venue's location on the map (Delhi NCR only).")
    date = str(b.get("date") or "")
    try:
        datetime.date.fromisoformat(date)
    except ValueError:
        bad("Pick a valid date.")
    if date < iso_date(0):
        bad("That date is in the past.")
    if date > iso_date(366):
        bad("Events can be listed up to a year ahead.")

    def t(key, label):
        v = str(b.get(key) or "")
        if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", v):
            bad(f"{label} must look like 18:30.")
        return v

    start, end = t("startTime", "Start time"), t("endTime", "End time")
    url = str(b.get("ticketUrl") or "").strip()
    if url and (not re.fullmatch(r"https?://\S+", url, re.I) or len(url) > 300):
        bad("Ticket link must start with http:// or https://")
    return dict(
        name=name, type=b["type"], genre=genre, venue=venue, area=area, description=description,
        lat=lat, lng=lng, date=date, start_time=start, end_time=end, ticket_url=url,
        tips=str(b.get("tips") or "").strip()[:250],
        venue_layout="large" if b["type"] == "major_concert" else "campus",
    )


def add_event(user_id, body):
    v = validate_event(body)
    eid = "ce_" + uuid.uuid4().hex[:12]
    _run(
        "INSERT INTO events(id,created_by,created_at,name,type,genre,venue,area,description,lat,lng,date,"
        "start_time,end_time,ticket_url,tips,venue_layout) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (eid, user_id, now_ms(), v["name"], v["type"], v["genre"], v["venue"], v["area"], v["description"],
         v["lat"], v["lng"], v["date"], v["start_time"], v["end_time"], v["ticket_url"], v["tips"], v["venue_layout"]),
    )
    return eid


def delete_event(user_id, event_id):
    r = _q("SELECT created_by FROM events WHERE id=?", (event_id,), one=True)
    if not r:
        return 404
    if r["created_by"] != user_id:
        return 403
    with _lock:
        _conn.execute("DELETE FROM events WHERE id=?", (event_id,))
        _conn.execute("DELETE FROM attendances WHERE event_id=?", (event_id,))
        _conn.commit()
    return 200


def get_events(type=None, genre=None, q=None, mine=None, viewer_id=None):
    today = iso_date(0)
    out = []
    for e in _all_events():
        if e["date"] < today:
            continue
        if type and e["type"] != type:
            continue
        if genre and e["genre"] != genre:
            continue
        if mine and e.get("createdBy") != viewer_id:
            continue
        if q and q.lower() not in f"{e['name']} {e['venue']} {e['genre']} {e['area']}".lower():
            continue
        out.append(e)
    out.sort(key=lambda e: e["date"] + e["startTime"])
    return [_decorate(e) for e in out]


def get_event(event_id):
    e = next((e for e in _all_events() if e["id"] == event_id), None)
    return _decorate(e) if e else None


# ---------------- attendance ----------------

def set_attendance(user_id, event_id, attending):
    if attending:
        _run("INSERT OR IGNORE INTO attendances VALUES(?,?,?)", (user_id, event_id, now_ms()))
    else:
        _run("DELETE FROM attendances WHERE user_id=? AND event_id=?", (user_id, event_id))
    return {"attending": attending, "going": going_count(event_id)}


def is_attending(user_id, event_id):
    return bool(_q("SELECT 1 FROM attendances WHERE user_id=? AND event_id=?", (user_id, event_id), one=True))


def blocked_either_way(a, b):
    return bool(_q(
        "SELECT 1 FROM blocks WHERE (by_id=? AND target_id=?) OR (by_id=? AND target_id=?)", (a, b, b, a), one=True))


def get_attendees(event_id, viewer_id):
    swiped = {r["target_id"] for r in _q(
        "SELECT target_id FROM swipes WHERE user_id=? AND event_id=?", (viewer_id, event_id))}
    out = []
    for r in _q("SELECT u.* FROM attendances a JOIN users u ON u.id=a.user_id "
                "WHERE a.event_id=? AND u.profile_complete=1 ORDER BY a.at", (event_id,)):
        if r["id"] != viewer_id and r["id"] not in swiped and not blocked_either_way(viewer_id, r["id"]):
            out.append(_public(r))
    for d in seed_users:
        if event_id in d["attendingEventIds"] and d["id"] not in swiped:
            out.append(_public_demo(d))
    return out


# ---------------- swipes, matches, chat ----------------

def record_swipe(user_id, target_id, event_id, direction):
    with _lock:
        if _q("SELECT 1 FROM swipes WHERE user_id=? AND target_id=? AND event_id=?",
              (user_id, target_id, event_id), one=True):
            return {"matched": False, "duplicate": True, "match": None}
        _conn.execute("INSERT INTO swipes VALUES(?,?,?,?,?,?)",
                      (str(uuid.uuid4()), user_id, target_id, event_id, direction, now_ms()))
        # demo profiles always like back so matching can be tried alone
        if direction == "like" and is_demo_user(target_id):
            _conn.execute("INSERT OR IGNORE INTO swipes VALUES(?,?,?,?,?,?)",
                          (str(uuid.uuid4()), target_id, user_id, event_id, "like", now_ms()))
        match_id = None
        if direction == "like" and _q(
                "SELECT 1 FROM swipes WHERE user_id=? AND target_id=? AND event_id=? AND direction='like'",
                (target_id, user_id, event_id), one=True):
            exists = _q("SELECT 1 FROM matches WHERE event_id=? AND ((a=? AND b=?) OR (a=? AND b=?))",
                        (event_id, user_id, target_id, target_id, user_id), one=True)
            if not exists:
                match_id = str(uuid.uuid4())
                _conn.execute("INSERT INTO matches VALUES(?,?,?,?,?)", (match_id, event_id, user_id, target_id, now_ms()))
        _conn.commit()
    return {"matched": bool(match_id), "match": {"id": match_id} if match_id else None}


def get_matches(user_id):
    out = []
    for m in _q("SELECT * FROM matches WHERE a=? OR b=?", (user_id, user_id)):
        other_id = m["b"] if m["a"] == user_id else m["a"]
        if blocked_either_way(user_id, other_id):
            continue
        other = get_user(other_id)
        if not other:
            continue
        ev = get_event(m["event_id"])
        last = _q("SELECT * FROM messages WHERE match_id=? ORDER BY at DESC, rowid DESC LIMIT 1", (m["id"],), one=True)
        out.append({
            "id": m["id"], "at": m["at"], "otherUser": other,
            "event": {"id": ev["id"], "name": ev["name"], "venue": ev["venue"], "date": ev["date"]} if ev else None,
            "lastMessage": {"text": last["text"], "at": last["at"], "mine": last["sender"] == user_id} if last else None,
        })
    out.sort(key=lambda m: (m["lastMessage"]["at"] if m["lastMessage"] else m["at"]), reverse=True)
    return out


def get_match_for(match_id, user_id):
    m = _q("SELECT * FROM matches WHERE id=? AND (a=? OR b=?)", (match_id, user_id, user_id), one=True)
    if not m:
        return None
    other_id = m["b"] if m["a"] == user_id else m["a"]
    if blocked_either_way(user_id, other_id):
        return None
    ev = get_event(m["event_id"])
    return {"id": m["id"], "otherUser": get_user(other_id), "event": {"id": ev["id"], "name": ev["name"]} if ev else None}


def get_messages(match_id):
    rows = _q("SELECT * FROM (SELECT rowid rid,* FROM messages WHERE match_id=? ORDER BY at DESC, rowid DESC LIMIT 200) "
              "ORDER BY at, rid", (match_id,))
    return [{"id": r["id"], "matchId": r["match_id"], "from": r["sender"], "text": r["text"], "at": r["at"]} for r in rows]


def add_message(match_id, sender, text):
    text = str(text or "").strip()
    if not text:
        bad("Write something first.")
    if len(text) > 500:
        bad("Messages can be up to 500 characters.")
    mid = str(uuid.uuid4())
    at = now_ms()
    _run("INSERT INTO messages VALUES(?,?,?,?,?)", (mid, match_id, sender, text, at))
    return {"id": mid, "matchId": match_id, "from": sender, "text": text, "at": at}


# ---------------- safety ----------------

def block_user(by, target):
    if by == target:
        bad("You can't block yourself.")
    _run("INSERT OR IGNORE INTO blocks VALUES(?,?,?)", (by, target, now_ms()))


def report_user(by, target, reason):
    reason = str(reason or "").strip()[:300]
    if not reason:
        bad("Tell us briefly what happened.")
    _run("INSERT INTO reports VALUES(?,?,?,?,?)", (str(uuid.uuid4()), by, target, reason, now_ms()))
    block_user(by, target)


# ---------------- pings ----------------

def _ping(r):
    return {"id": r["id"], "eventId": r["event_id"], "type": r["type"], "x": r["x"], "y": r["y"],
            "note": r["note"], "createdBy": r["created_by"], "at": r["at"], "expiresAt": r["expires_at"]}


def add_ping(event_id, ptype, x, y, note, created_by):
    def clamp(v):
        try:
            return max(0.0, min(100.0, float(v)))
        except (TypeError, ValueError):
            return 0.0

    pid, t = str(uuid.uuid4()), now_ms()
    _run("INSERT INTO pings VALUES(?,?,?,?,?,?,?,?,?)",
         (pid, event_id, ptype, clamp(x), clamp(y), str(note or "")[:60], created_by or "Anonymous", t, t + PING_TTL_MS))
    return _ping(_q("SELECT * FROM pings WHERE id=?", (pid,), one=True))


def get_pings(event_id):
    return [_ping(r) for r in _q("SELECT * FROM pings WHERE event_id=? AND expires_at>? ORDER BY at", (event_id, now_ms()))]


def sweep_expired_pings():
    rows = _q("SELECT * FROM pings WHERE expires_at<=?", (now_ms(),))
    if rows:
        _run("DELETE FROM pings WHERE expires_at<=?", (now_ms(),))
    return [_ping(r) for r in rows]
