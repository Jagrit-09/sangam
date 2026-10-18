"""Sangam web server (standard library only). Run: python server/app.py"""
import json
import mimetypes
import queue
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

sys.path.insert(0, str(Path(__file__).resolve().parent))

import config  # noqa: E402
import db  # noqa: E402
import sse  # noqa: E402
import transit  # noqa: E402
from security import Limiter  # noqa: E402

LIMITS = {
    "login": Limiter(8, 600),
    "signup": Limiter(10, 3600),
    "event": Limiter(5, 3600),
    "message": Limiter(30, 60),
    "ping": Limiter(1, 8),
    "report": Limiter(10, 3600),
}

BOT_REPLIES = [
    "Hey! Great to match. Which gate are you planning to enter from?",
    "Nice, I was hoping someone would say yes. Want to meet at the metro station and go together?",
    "Same here, going solo. Let's grab a spot near the stage.",
    "Sounds good. I'll ping the ground map if I find a quieter spot.",
]

ROUTES = []


def route(method, pattern):
    regex = re.compile("^" + re.sub(r":(\w+)", r"(?P<\1>[^/]+)", pattern) + "$")

    def deco(fn):
        ROUTES.append((method, regex, fn))
        return fn

    return deco


class HttpError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class Handler(BaseHTTPRequestHandler):
    server_version = "Sangam"

    def log_message(self, *a):  # keep the console quiet
        pass

    # ---- helpers ----
    def send_json(self, status, obj, headers=None):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._security_headers()
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        # tile servers need a Referer header
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-Frame-Options", "DENY")

    def cookies(self):
        out = {}
        for part in (self.headers.get("Cookie") or "").split(";"):
            if "=" in part:
                k, v = part.split("=", 1)
                out[k.strip()] = v.strip()
        return out

    def user_id(self):
        return db.session_user(self.cookies().get(config.SESSION_COOKIE))

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 1_000_000:
            raise HttpError(413, "Request too large.")
        if n == 0:
            return {}
        try:
            data = json.loads(self.rfile.read(n))
        except ValueError:
            raise HttpError(400, "Invalid request body.")
        return data if isinstance(data, dict) else {}

    def ip(self):
        return self.client_address[0]

    @staticmethod
    def cookie_header(token, max_age):
        c = f"{config.SESSION_COOKIE}={token}; Path=/; SameSite=Lax; HttpOnly; Max-Age={max_age}"
        return c + ("; Secure" if config.COOKIE_SECURE else "")

    # ---- dispatch ----
    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_HEAD(self):
        self.dispatch("GET")

    def dispatch(self, method):
        url = urlparse(self.path)
        path = unquote(url.path)
        self.query = {k: v[0] for k, v in parse_qs(url.query).items()}
        for m, regex, fn in ROUTES:
            if m != method:
                continue
            match = regex.match(path)
            if match:
                self.params = match.groupdict()
                try:
                    fn(self)
                except HttpError as e:
                    self.send_json(e.status, {"error": e.message})
                except db.ValidationError as e:
                    self.send_json(400, {"error": str(e)})
                except (BrokenPipeError, ConnectionResetError):
                    pass
                except Exception as e:  # noqa: BLE001
                    print("Route error:", repr(e))
                    try:
                        self.send_json(500, {"error": "Internal server error"})
                    except Exception:  # noqa: BLE001
                        pass
                return
        if method == "GET":
            return self.serve_static(path)
        self.send_json(405, {"error": "Method not allowed"})

    def serve_static(self, path):
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        f = (config.PUBLIC_DIR / rel).resolve()
        if config.PUBLIC_DIR.resolve() not in f.parents or not f.is_file():
            self.send_response(404)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Not found")
            return
        data = f.read_bytes()
        ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("text/") or ctype.endswith("javascript") else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self._security_headers()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def require_user(self):
        uid = self.user_id()
        user = db.get_self(uid) if uid else None
        if not user:
            raise HttpError(401, "Please log in first.")
        return user

    def stream(self, channel):
        q = sse.subscribe(channel)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self._security_headers()
            self.end_headers()
            self.wfile.write(b"retry: 3000\n\n")
            self.wfile.flush()
            while True:
                try:
                    self.wfile.write(q.get(timeout=25).encode())
                except queue.Empty:
                    self.wfile.write(b": keep-alive\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            sse.unsubscribe(channel, q)


# ================= routes =================

@route("GET", "/api/meta")
def meta(r):
    r.send_json(200, {
        "interestOptions": db.INTEREST_OPTIONS, "eventTypes": db.EVENT_TYPES, "areas": transit.AREAS,
        "stations": [{"id": s["id"], "name": s["name"], "lines": s["lines"]} for s in transit.STATIONS],
        "demoData": config.SHOW_DEMO_DATA, "today": db.iso_date(0),
    })


# ---- auth ----

def _login_response(r, user_id, status=200):
    token = db.create_session(user_id)
    r.send_json(status, {"user": db.get_self(user_id)},
                {"Set-Cookie": r.cookie_header(token, config.SESSION_MAX_AGE)})


@route("POST", "/api/auth/signup")
def signup(r):
    b = r.body()
    if not LIMITS["signup"].check(r.ip()):
        raise HttpError(429, "Too many sign-ups from here. Try again later.")
    _login_response(r, db.create_user(b.get("name"), b.get("email"), b.get("password")), 201)


@route("POST", "/api/auth/login")
def login(r):
    b = r.body()
    if not LIMITS["login"].check(r.ip() + "|" + str(b.get("email", "")).lower()):
        raise HttpError(429, "Too many attempts. Wait a few minutes and try again.")
    uid = db.authenticate(b.get("email"), b.get("password"))
    if not uid:
        raise HttpError(401, "Wrong email or password.")
    _login_response(r, uid)


@route("GET", "/api/auth/me")
def me(r):
    uid = r.user_id()
    r.send_json(200, {"user": db.get_self(uid) if uid else None})


@route("POST", "/api/auth/logout")
def logout(r):
    db.destroy_session(r.cookies().get(config.SESSION_COOKIE))
    r.send_json(200, {"ok": True}, {"Set-Cookie": r.cookie_header("", 0)})


@route("POST", "/api/me/profile")
def profile(r):
    u = r.require_user()
    b = r.body()
    db.update_profile(u["id"], b.get("name"), b.get("age"), b.get("bio"), b.get("interests"))
    r.send_json(200, {"user": db.get_self(u["id"])})


@route("POST", "/api/me/delete")
def delete_me(r):
    u = r.require_user()
    if not db.authenticate(u["email"], r.body().get("password")):
        raise HttpError(401, "Password is wrong.")
    db.delete_user(u["id"])
    r.send_json(200, {"ok": True}, {"Set-Cookie": r.cookie_header("", 0)})


# ---- events ----

@route("GET", "/api/events")
def list_events(r):
    q = r.query
    r.send_json(200, db.get_events(q.get("type"), q.get("genre"), q.get("q"), q.get("mine"), r.user_id()))


@route("POST", "/api/events")
def create_event(r):
    u = r.require_user()
    b = r.body()
    if not LIMITS["event"].check(u["id"]):
        raise HttpError(429, "You've posted a few events already. Try again in an hour.")
    eid = db.add_event(u["id"], b)
    db.set_attendance(u["id"], eid, True)
    r.send_json(201, db.get_event(eid))


@route("GET", "/api/events/:id")
def get_event(r):
    ev = db.get_event(r.params["id"])
    if not ev:
        raise HttpError(404, "Event not found")
    uid = r.user_id()
    r.send_json(200, {**ev, "isAttending": bool(uid) and db.is_attending(uid, ev["id"]),
                      "isHost": bool(uid) and ev.get("createdBy") == uid})


@route("POST", "/api/events/:id/delete")
def delete_event(r):
    u = r.require_user()
    status = db.delete_event(u["id"], r.params["id"])
    if status == 403:
        raise HttpError(403, "Only the host can remove this event.")
    if status == 404:
        raise HttpError(404, "Event not found")
    r.send_json(200, {"ok": True})


@route("POST", "/api/events/:id/rsvp")
def rsvp(r):
    u = r.require_user()
    b = r.body()
    if not db.get_event(r.params["id"]):
        raise HttpError(404, "Event not found")
    r.send_json(200, db.set_attendance(u["id"], r.params["id"], bool(b.get("attending"))))


@route("GET", "/api/events/:id/attendees")
def attendees(r):
    u = r.require_user()
    r.send_json(200, db.get_attendees(r.params["id"], u["id"]))


@route("GET", "/api/events/:id/transit")
def event_transit(r):
    ev = db.get_event(r.params["id"])
    if not ev:
        raise HttpError(404, "Event not found")
    q = r.query
    origin = {"stationId": q["stationId"]} if q.get("stationId") else ({"lat": q["lat"], "lng": q["lng"]} if q.get("lat") and q.get("lng") else None)
    r.send_json(200, transit.estimate(ev["lat"], ev["lng"], origin, ev.get("tips")))


# ---- swipe / matches / chat ----

@route("POST", "/api/swipe")
def swipe(r):
    u = r.require_user()
    b = r.body()
    target, event_id, direction = b.get("targetId"), b.get("eventId"), b.get("direction")
    if not target or not event_id or direction not in ("like", "pass"):
        raise HttpError(400, "targetId, eventId and a valid direction are required.")
    if not u["profileComplete"]:
        raise HttpError(400, "Finish your profile first.")
    if not db.get_event(event_id):
        raise HttpError(400, "Unknown event.")
    if not db.is_attending(u["id"], event_id):
        raise HttpError(400, "RSVP to this event first.")
    if target == u["id"] or not db.get_user(target):
        raise HttpError(400, "Unknown person.")
    r.send_json(200, db.record_swipe(u["id"], target, event_id, direction))


@route("GET", "/api/matches")
def matches(r):
    r.send_json(200, db.get_matches(r.require_user()["id"]))


@route("GET", "/api/matches/:id/messages")
def get_messages(r):
    u = r.require_user()
    m = db.get_match_for(r.params["id"], u["id"])
    if not m:
        raise HttpError(404, "Chat not found.")
    r.send_json(200, {"match": m, "messages": db.get_messages(m["id"])})


def _bot_reply(match_id, bot_id, text):
    try:
        sse.publish("chat:" + match_id, "message", db.add_message(match_id, bot_id, text))
    except Exception:  # noqa: BLE001 - match may have been deleted meanwhile
        pass


@route("POST", "/api/matches/:id/messages")
def send_message(r):
    u = r.require_user()
    b = r.body()
    m = db.get_match_for(r.params["id"], u["id"])
    if not m:
        raise HttpError(404, "Chat not found.")
    if not LIMITS["message"].check(u["id"]):
        raise HttpError(429, "Slow down a little.")
    msg = db.add_message(m["id"], u["id"], b.get("text"))
    sse.publish("chat:" + m["id"], "message", msg)
    r.send_json(201, msg)
    if db.is_demo_user(m["otherUser"]["id"]):
        text = BOT_REPLIES[len(db.get_messages(m["id"])) % len(BOT_REPLIES)]
        threading.Timer(1.2, _bot_reply, (m["id"], m["otherUser"]["id"], text)).start()


@route("GET", "/api/matches/:id/stream")
def chat_stream(r):
    uid = r.user_id()
    m = db.get_match_for(r.params["id"], uid) if uid else None
    if not m:
        raise HttpError(404, "Chat not found.")
    r.stream("chat:" + m["id"])


# ---- safety ----

@route("POST", "/api/users/:id/block")
def block(r):
    u = r.require_user()
    if not db.get_user(r.params["id"]):
        raise HttpError(404, "Person not found.")
    db.block_user(u["id"], r.params["id"])
    r.send_json(200, {"ok": True})


@route("POST", "/api/users/:id/report")
def report(r):
    u = r.require_user()
    b = r.body()
    if not LIMITS["report"].check(u["id"]):
        raise HttpError(429, "Too many reports. Try later.")
    if not db.get_user(r.params["id"]):
        raise HttpError(404, "Person not found.")
    db.report_user(u["id"], r.params["id"], b.get("reason"))
    r.send_json(200, {"ok": True})


# ---- live pings ----

@route("GET", "/api/events/:id/pings")
def pings(r):
    if not db.get_event(r.params["id"]):
        raise HttpError(404, "Event not found")
    r.send_json(200, db.get_pings(r.params["id"]))


@route("POST", "/api/events/:id/pings")
def add_ping(r):
    u = r.require_user()
    b = r.body()
    if not db.get_event(r.params["id"]):
        raise HttpError(404, "Event not found")
    if b.get("type") not in db.PING_TYPES:
        raise HttpError(400, "Unknown ping type.")
    if not LIMITS["ping"].check(u["id"]):
        raise HttpError(429, "One ping every few seconds. Wait a moment.")
    p = db.add_ping(r.params["id"], b["type"], b.get("x"), b.get("y"), b.get("note"), u["name"].split()[0])
    sse.publish("pings:" + r.params["id"], "ping", p)
    r.send_json(201, p)


@route("GET", "/api/events/:id/pings/stream")
def ping_stream(r):
    if not db.get_event(r.params["id"]):
        raise HttpError(404, "Event not found")
    r.stream("pings:" + r.params["id"])


# ================= boot =================

def _sweeper():
    import time
    while True:
        time.sleep(60)
        by_event = {}
        for p in db.sweep_expired_pings():
            by_event.setdefault(p["eventId"], []).append(p["id"])
        for eid, ids in by_event.items():
            sse.publish("pings:" + eid, "ping-removed", {"ids": ids})


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def make_server(port=None):
    db.init()
    threading.Thread(target=_sweeper, daemon=True).start()
    return Server((config.HOST, config.PORT if port is None else port), Handler)


if __name__ == "__main__":
    srv = make_server()
    print(f"\n  Sangam is running -> http://localhost:{config.PORT}\n")
    print("  Sample events and demo profiles are ON (SHOW_DEMO_DATA=false to hide)."
          if config.SHOW_DEMO_DATA else "  Sample data is OFF. Only events people post will show.")
    print("  Press Ctrl+C to stop.\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.")
