"""Metro / auto / cab estimates from data/metro.json (approximate coordinates)."""
import json
import math

from config import DATA_DIR

_data = json.loads((DATA_DIR / "metro.json").read_text(encoding="utf8"))
STATIONS = _data["stations"]
AREAS = _data["areas"]
_by_id = {s["id"]: s for s in STATIONS}

ROAD_FACTOR = 1.35  # straight line -> typical Delhi road distance


def haversine_km(lat1, lng1, lat2, lng2):
    r = 6371
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl, dg = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dl / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dg / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _round5(n):
    return int(round(n / 5.0) * 5)


def nearest_stations(lat, lng, n=3):
    ranked = sorted(STATIONS, key=lambda s: haversine_km(lat, lng, s["lat"], s["lng"]))[:n]
    out = []
    for s in ranked:
        road = haversine_km(lat, lng, s["lat"], s["lng"]) * ROAD_FACTOR
        out.append({
            "id": s["id"], "name": s["name"], "lines": s["lines"],
            "distKm": round(road, 1),
            "walkMins": max(1, round(road / 0.075)),  # ~4.5 km/h
        })
    return out


def metro_fare(km):
    """Delhi Metro weekday fare slabs by distance."""
    for limit, fare in ((2, 11), (5, 21), (12, 32), (21, 43), (32, 54)):
        if km <= limit:
            return fare
    return 64


def auto_fare(road_km):
    f = 30 + max(0, road_km - 1.5) * 11  # Rs30 first 1.5 km, then Rs11/km
    return {"min": _round5(f * 0.9), "max": _round5(f * 1.35)}


def cab_fare(road_km):
    f = max(100, 50 + road_km * 13)
    return {"min": _round5(f), "max": _round5(f * 1.7)}  # wide upper bound: event-night surge


def _resolve_origin(origin):
    if not origin:
        return None
    if origin.get("stationId"):
        s = _by_id.get(origin["stationId"])
        return {"lat": s["lat"], "lng": s["lng"], "label": s["name"] + " metro"} if s else None
    try:
        return {"lat": float(origin["lat"]), "lng": float(origin["lng"]), "label": "your location"}
    except (KeyError, TypeError, ValueError):
        return None


def estimate(dest_lat, dest_lng, origin=None, host_tips=None):
    near = nearest_stations(dest_lat, dest_lng, 3)
    first = near[0]
    result = {
        "approximate": True,
        "nearestMetro": first,
        "otherStations": near[1:],
        "walkOrRide": (
            f"{first['walkMins']} min walk from {first['name']}"
            if first["walkMins"] <= 15
            else f"{first['walkMins']} min on foot from {first['name']}. An e-rickshaw or auto for the last stretch is easier."
        ),
        "lastMileAuto": auto_fare(first["distKm"]),
        "from": None,
    }
    o = _resolve_origin(origin)
    if o:
        road = haversine_km(o["lat"], o["lng"], dest_lat, dest_lng) * ROAD_FACTOR
        board = nearest_stations(o["lat"], o["lng"], 1)[0]
        a, b = _by_id[board["id"]], _by_id[first["id"]]
        metro_km = haversine_km(a["lat"], a["lng"], b["lat"], b["lng"]) * 1.25
        if board["id"] == first["id"]:
            metro = {"sameStation": True, "fare": 0}
        else:
            metro = {
                "board": board["name"], "alight": first["name"], "fare": metro_fare(metro_km),
                "walkToStationMins": board["walkMins"],
                "note": "Fare from distance slabs. Interchanges and exact stops are not computed.",
            }
        result["from"] = {
            "label": o["label"], "roadKm": round(road, 1), "metro": metro,
            "auto": auto_fare(road), "cab": cab_fare(road),
        }
        if road > 25:
            result["from"]["note"] = "That's a long way for an auto. Metro or a cab will make more sense."
    if host_tips:
        result["hostTips"] = host_tips
    return result
