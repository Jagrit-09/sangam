// shared state and helpers
// Views is created once here; each view file adds itself to window.Views
window.Views = window.Views || {};

const State = (() => {
  let currentUser = null; // set by app.js after GET /api/auth/me resolves
  const listeners = [];

  return {
    getUser() {
      return currentUser;
    },
    getUserId() {
      return currentUser ? currentUser.id : null;
    },
    setUser(user) {
      currentUser = user;
      listeners.forEach((fn) => fn(user));
    },
    onUserChange(fn) {
      listeners.push(fn);
    },
  };
})();

function toast(message) {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function formatTimeRange(start, end) {
  return `${start} – ${end}`;
}

function daysUntil(dateStr) {
  const target = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.round((target - now) / 86400000);
  if (diff < 0) return null;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `In ${diff} days`;
}

function timeAgo(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

const EVENT_TYPE_LABELS = {
  college_fest: "College Fest",
  small_gig: "Small Gig",
  major_concert: "Major Concert",
};

// cover art: icon and gradient picked from the genre
const GENRE_VISUALS = [
  { match: /edm|electronic|dj|dance/i, icon: "🎧", from: "#47E0D2", to: "#8C7CFF" },
  { match: /rock|metal/i, icon: "🎸", from: "#FF5FA8", to: "#FFB627" },
  { match: /classical|fusion|orchestra/i, icon: "🎻", from: "#8C7CFF", to: "#47E0D2" },
  { match: /hip.?hop|rap/i, icon: "🎤", from: "#FF8A5B", to: "#FF5FA8" },
  { match: /jazz|blues/i, icon: "🎷", from: "#6FCF7A", to: "#47E0D2" },
  { match: /acoustic|singer|folk/i, icon: "🎼", from: "#FFB627", to: "#6FCF7A" },
  { match: /festival|multi/i, icon: "🎪", from: "#FF5FA8", to: "#FFB627" },
];
function genreVisual(genre) {
  const found = GENRE_VISUALS.find((g) => g.match.test(genre || ""));
  return found || { icon: "🎵", from: "#47E0D2", to: "#FF5FA8" };
}

function eventCoverHtml(event) {
  const v = genreVisual(event.genre);
  const gradient = `linear-gradient(135deg, ${v.from}33, ${v.to}33)`;
  const photo = "";
  return `
    <div class="event-cover" style="background:${gradient}">
      ${photo}
      <span class="event-cover-icon">${v.icon}</span>
      ${
        event.source === "predicthq"
          ? '<span class="live-source-badge"><span class="live-dot pulsing"></span> Live feed</span>'
          : event.source === "demo"
          ? '<span class="live-source-badge demo-badge">Sample</span>'
          : '<span class="live-source-badge community-badge">Community</span>'
      }
    </div>
  `;
}

// base map with fallback: if a tile provider fails, try the next one
const TILE_PROVIDERS = [
  {
    name: "Esri dark",
    layers: [
      { url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", maxZoom: 16 },
      { url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", maxZoom: 16 },
    ],
    attribution: "Tiles &copy; Esri",
  },
  {
    name: "Esri streets",
    layers: [{ url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", maxZoom: 18 }],
    attribution: "Tiles &copy; Esri",
  },
  {
    name: "OpenStreetMap",
    layers: [{ url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxZoom: 19 }],
    attribution: "&copy; OpenStreetMap contributors",
  },
];

function addBaseMap(map) {
  let idx = -1;
  let active = [];
  function useNext() {
    active.forEach((l) => map.removeLayer(l));
    idx += 1;
    if (idx >= TILE_PROVIDERS.length) return;
    const p = TILE_PROVIDERS[idx];
    let loaded = 0;
    let failed = 0;
    active = p.layers.map((cfg, i) => {
      const layer = L.tileLayer(cfg.url, { maxZoom: cfg.maxZoom, attribution: i === 0 ? p.attribution : "" });
      if (i === 0) {
        layer.on("tileload", () => (loaded += 1));
        layer.on("tileerror", () => {
          failed += 1;
          if (loaded === 0 && failed >= 3) useNext(); // nothing ever loaded: try the next provider
        });
      }
      return layer.addTo(map);
    });
  }
  useNext();
}

function osmLink(lat, lng) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
}
