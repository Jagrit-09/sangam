// fetch() wrapper used by all views
const Api = (() => {
  async function request(path, options = {}) {
    const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
    let body = null;
    try {
      body = await res.json();
    } catch (e) {}
    if (!res.ok) throw new Error((body && body.error) || `Request failed (${res.status})`);
    return body;
  }
  const post = (path, data) => request(path, { method: "POST", body: JSON.stringify(data || {}) });
  const enc = encodeURIComponent;

  return {
    getMeta: () => request("/api/meta"),
    signup: (d) => post("/api/auth/signup", d),
    login: (d) => post("/api/auth/login", d),
    getMe: () => request("/api/auth/me"),
    logout: () => post("/api/auth/logout"),
    updateProfile: (d) => post("/api/me/profile", d),
    deleteAccount: (password) => post("/api/me/delete", { password }),

    getEvents(filters = {}) {
      const qs = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v))).toString();
      return request("/api/events" + (qs ? "?" + qs : ""));
    },
    getEvent: (id) => request(`/api/events/${enc(id)}`),
    createEvent: (d) => post("/api/events", d),
    deleteEvent: (id) => post(`/api/events/${enc(id)}/delete`),
    setRsvp: (id, attending) => post(`/api/events/${enc(id)}/rsvp`, { attending }),
    getAttendees: (id) => request(`/api/events/${enc(id)}/attendees`),
    getTransit(id, origin = {}) {
      const qs = new URLSearchParams(origin).toString();
      return request(`/api/events/${enc(id)}/transit${qs ? "?" + qs : ""}`);
    },

    swipe: (targetId, eventId, direction) => post("/api/swipe", { targetId, eventId, direction }),
    getMatches: () => request("/api/matches"),
    getMessages: (matchId) => request(`/api/matches/${enc(matchId)}/messages`),
    sendMessage: (matchId, text) => post(`/api/matches/${enc(matchId)}/messages`, { text }),
    chatStreamUrl: (matchId) => `/api/matches/${enc(matchId)}/stream`,
    blockUser: (id) => post(`/api/users/${enc(id)}/block`),
    reportUser: (id, reason) => post(`/api/users/${enc(id)}/report`, { reason }),

    getPings: (id) => request(`/api/events/${enc(id)}/pings`),
    addPing: (id, ping) => post(`/api/events/${enc(id)}/pings`, ping),
    pingStreamUrl: (id) => `/api/events/${enc(id)}/pings/stream`,
  };
})();
