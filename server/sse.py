"""Server-Sent Events: channels for live pings and chat."""
import json
import queue
import threading

_channels = {}
_lock = threading.Lock()


def subscribe(channel):
    q = queue.Queue()
    with _lock:
        _channels.setdefault(channel, set()).add(q)
    return q


def unsubscribe(channel, q):
    with _lock:
        subs = _channels.get(channel)
        if subs:
            subs.discard(q)
            if not subs:
                _channels.pop(channel, None)


def publish(channel, event, data):
    payload = f"event: {event}\ndata: {json.dumps(data)}\n\n"
    with _lock:
        subs = list(_channels.get(channel, ()))
    for q in subs:
        q.put(payload)
