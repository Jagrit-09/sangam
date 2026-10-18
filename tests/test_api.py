"""API tests. Run: python -m unittest discover -s tests -v"""
import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

os.environ["SANGAM_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

import app  # noqa: E402
import db  # noqa: E402
import transit  # noqa: E402


class Client:
    def __init__(self, base):
        self.base, self.cookie = base, ""

    def call(self, method, url, body=None):
        data = json.dumps(body).encode() if body is not None else (b"{}" if method == "POST" else None)
        req = urllib.request.Request(self.base + url, data=data, method=method,
                                     headers={"Content-Type": "application/json", **({"Cookie": self.cookie} if self.cookie else {})})
        try:
            res = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            res = e
        sc = res.headers.get("Set-Cookie")
        if sc:
            self.cookie = sc.split(";")[0]
        raw = res.read()
        try:
            return res.status if hasattr(res, "status") else res.code, json.loads(raw)
        except ValueError:
            return res.code, None


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = app.make_server(0)
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def client(self):
        return Client(self.base)

    def test_full_flow(self):
        a, b, anon, stranger = self.client(), self.client(), self.client(), self.client()

        # meta + sample events
        st, meta = anon.call("GET", "/api/meta")
        self.assertEqual(st, 200)
        self.assertGreater(len(meta["stations"]), 50)
        st, events = anon.call("GET", "/api/events")
        self.assertGreaterEqual(len(events), 7)
        self.assertTrue(all(e["date"] >= db.iso_date(0) for e in events), "only upcoming events")

        # auth
        self.assertEqual(anon.call("POST", "/api/events", {})[0], 401)
        self.assertEqual(a.call("POST", "/api/auth/signup", {"name": "Asha Rao", "email": "asha@example.com", "password": "short"})[0], 400)
        st, r = a.call("POST", "/api/auth/signup", {"name": "Asha Rao", "email": "asha@example.com", "password": "hunter2hunter2"})
        self.assertEqual(st, 201)
        self.assertNotIn("password_hash", json.dumps(r))
        self.assertEqual(anon.call("POST", "/api/auth/signup", {"name": "Dup", "email": "ASHA@example.com", "password": "hunter2hunter2"})[0], 400)
        self.assertEqual(a.call("GET", "/api/auth/me")[1]["user"]["email"], "asha@example.com")
        c = self.client()
        self.assertEqual(c.call("POST", "/api/auth/login", {"email": "asha@example.com", "password": "wrong-password"})[0], 401)
        self.assertEqual(c.call("POST", "/api/auth/login", {"email": "asha@example.com", "password": "hunter2hunter2"})[0], 200)

        # login rate limit
        spam = self.client()
        for _ in range(10):
            st, _ = spam.call("POST", "/api/auth/login", {"email": "x@y.co", "password": "nope-nope"})
        self.assertEqual(st, 429)

        # profile
        self.assertEqual(a.call("POST", "/api/me/profile", {"age": 12, "bio": "x"})[0], 400)
        st, r = a.call("POST", "/api/me/profile", {"age": 22, "bio": "Here for the bassline", "interests": ["EDM", "Jazz", "Nope"]})
        self.assertEqual(st, 200)
        self.assertEqual(r["user"]["interests"], ["EDM", "Jazz"])

        # community event
        good = {"name": "Basement Jam Night", "type": "small_gig", "genre": "Indie", "venue": "The Basement", "area": "Hauz Khas",
                "description": "Open mic and indie sets all night.", "lat": 28.5535, "lng": 77.1946, "date": db.iso_date(10),
                "startTime": "19:00", "endTime": "23:00", "tips": "Enter from the back lane.", "ticketUrl": "https://example.com/t"}
        self.assertEqual(a.call("POST", "/api/events", {**good, "lat": 12.9, "lng": 77.5})[0], 400)
        self.assertEqual(a.call("POST", "/api/events", {**good, "date": "2020-01-01"})[0], 400)
        self.assertEqual(a.call("POST", "/api/events", {**good, "ticketUrl": "javascript:alert(1)"})[0], 400)
        st, ev = a.call("POST", "/api/events", good)
        self.assertEqual(st, 201)
        self.assertEqual(ev["source"], "community")
        ev_id = ev["id"]
        st, found = anon.call("GET", "/api/events?q=basement%20jam")
        self.assertEqual([e["id"] for e in found], [ev_id])

        # transit
        st, t = anon.call("GET", f"/api/events/{ev_id}/transit?stationId=rajiv-chowk")
        self.assertEqual(st, 200)
        self.assertTrue(t["nearestMetro"]["name"] and t["from"]["auto"]["min"] > 0)
        self.assertEqual(t["hostTips"], "Enter from the back lane.")

        # two real users match
        st, r = b.call("POST", "/api/auth/signup", {"name": "Ben Khan", "email": "ben@example.com", "password": "correct-horse-1"})
        b_id = r["user"]["id"]
        b.call("POST", "/api/me/profile", {"age": 23, "bio": "Solo and looking for a crew", "interests": ["Rock"]})
        self.assertEqual(b.call("POST", "/api/swipe", {"targetId": b_id, "eventId": ev_id, "direction": "like"})[0], 400)
        a.call("POST", f"/api/events/{ev_id}/rsvp", {"attending": True})
        b.call("POST", f"/api/events/{ev_id}/rsvp", {"attending": True})
        st, deck = b.call("GET", f"/api/events/{ev_id}/attendees")
        self.assertEqual([u["name"] for u in deck], ["Asha Rao"])
        self.assertNotIn("email", deck[0])
        a_id = deck[0]["id"]
        self.assertFalse(b.call("POST", "/api/swipe", {"targetId": a_id, "eventId": ev_id, "direction": "like"})[1]["matched"])
        st, r = a.call("POST", "/api/swipe", {"targetId": b_id, "eventId": ev_id, "direction": "like"})
        self.assertTrue(r["matched"])
        match_id = r["match"]["id"]
        self.assertTrue(a.call("POST", "/api/swipe", {"targetId": b_id, "eventId": ev_id, "direction": "like"})[1]["duplicate"])

        # chat
        self.assertEqual(a.call("POST", f"/api/matches/{match_id}/messages", {"text": "Hey Ben!"})[0], 201)
        st, r = b.call("GET", f"/api/matches/{match_id}/messages")
        self.assertEqual(len(r["messages"]), 1)
        self.assertEqual(r["match"]["otherUser"]["name"], "Asha Rao")
        self.assertEqual(a.call("POST", f"/api/matches/{match_id}/messages", {"text": "   "})[0], 400)
        stranger.call("POST", "/api/auth/signup", {"name": "Eve Mallory", "email": "eve@example.com", "password": "password-123"})
        self.assertEqual(stranger.call("GET", f"/api/matches/{match_id}/messages")[0], 404)

        # demo profile likes back and replies
        dtu = "ev_dtu_founders"
        a.call("POST", f"/api/events/{dtu}/rsvp", {"attending": True})
        st, deck = a.call("GET", f"/api/events/{dtu}/attendees")
        self.assertTrue(deck and all(u["demo"] for u in deck))
        st, r = a.call("POST", "/api/swipe", {"targetId": deck[0]["id"], "eventId": dtu, "direction": "like"})
        self.assertTrue(r["matched"])
        mid = r["match"]["id"]
        a.call("POST", f"/api/matches/{mid}/messages", {"text": "hi"})
        time.sleep(1.8)
        self.assertEqual(len(a.call("GET", f"/api/matches/{mid}/messages")[1]["messages"]), 2)

        # block
        self.assertEqual(b.call("POST", f"/api/users/{a_id}/block")[0], 200)
        self.assertNotIn(match_id, [m["id"] for m in b.call("GET", "/api/matches")[1]])
        self.assertEqual(a.call("POST", f"/api/matches/{match_id}/messages", {"text": "still there?"})[0], 404)

        # pings
        self.assertEqual(anon.call("POST", f"/api/events/{ev_id}/pings", {"type": "medical", "x": 10, "y": 10})[0], 401)
        self.assertEqual(a.call("POST", f"/api/events/{ev_id}/pings", {"type": "bogus", "x": 10, "y": 10})[0], 400)
        st, p = a.call("POST", f"/api/events/{ev_id}/pings", {"type": "medical", "x": 500, "y": -5, "note": "First aid tent"})
        self.assertEqual(st, 201)
        self.assertEqual((p["x"], p["y"]), (100, 0))
        self.assertEqual(a.call("POST", f"/api/events/{ev_id}/pings", {"type": "washroom", "x": 10, "y": 10})[0], 429)
        self.assertEqual(len(anon.call("GET", f"/api/events/{ev_id}/pings")[1]), 1)

        # only host deletes
        self.assertEqual(b.call("POST", f"/api/events/{ev_id}/delete")[0], 403)
        self.assertEqual(a.call("POST", f"/api/events/{ev_id}/delete")[0], 200)

        # no plaintext passwords stored
        raw = Path(os.environ["SANGAM_DB"]).read_bytes()
        self.assertNotIn(b"hunter2hunter2", raw)

        # account deletion
        self.assertEqual(stranger.call("POST", "/api/me/delete", {"password": "nope"})[0], 401)
        self.assertEqual(stranger.call("POST", "/api/me/delete", {"password": "password-123"})[0], 200)
        self.assertIsNone(stranger.call("GET", "/api/auth/me")[1]["user"])

    def test_static_and_traversal(self):
        req = urllib.request.urlopen(self.base + "/")
        self.assertIn(b"Sangam", req.read())
        self.assertEqual(req.headers["Referrer-Policy"], "strict-origin-when-cross-origin")
        for bad in ("/../server/config.py", "/..%2fserver/config.py", "/css/../../server/db.py"):
            try:
                urllib.request.urlopen(self.base + bad)
                self.fail("traversal not blocked: " + bad)
            except urllib.error.HTTPError as e:
                self.assertEqual(e.code, 404)


class TransitTest(unittest.TestCase):
    def test_fares(self):
        self.assertEqual(transit.metro_fare(1.5), 11)
        self.assertEqual(transit.metro_fare(10), 32)
        self.assertEqual(transit.metro_fare(40), 64)
        self.assertEqual(transit.auto_fare(1.5), {"min": 25, "max": 40})
        near = transit.nearest_stations(28.6328, 77.2195, 1)[0]
        self.assertEqual(near["name"], "Rajiv Chowk")


if __name__ == "__main__":
    unittest.main()
