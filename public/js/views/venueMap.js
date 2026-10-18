const PING_TYPES = [
  { key: "emergency", icon: "🚨", label: "Emergency", color: "var(--danger)" },
  { key: "medical", icon: "🏥", label: "Medical help", color: "var(--danger)" },
  { key: "washroom", icon: "🚻", label: "Washroom queue", color: "var(--text-muted)" },
  { key: "stall", icon: "🍔", label: "Stall spotted", color: "var(--amber)" },
  { key: "crowd_hype", icon: "🔥", label: "Crowd's hyped", color: "var(--pulse)" },
  { key: "crowd_calm", icon: "🌬️", label: "Room to breathe", color: "var(--live)" },
  { key: "general", icon: "📍", label: "General note", color: "var(--text-muted)" },
];

const ZONE_TEMPLATES = {
  large: [
    { icon: "🎤", label: "Main Stage", x: 50, y: 15 },
    { icon: "🚪", label: "Gate A", x: 10, y: 92 },
    { icon: "🚪", label: "Gate B", x: 90, y: 92 },
    { icon: "🍔", label: "Food & Stalls", x: 20, y: 55 },
    { icon: "🏥", label: "Medical Tent", x: 80, y: 55 },
    { icon: "🚻", label: "Washrooms", x: 50, y: 80 },
  ],
  campus: [
    { icon: "🎤", label: "Stage", x: 50, y: 20 },
    { icon: "🚪", label: "Entry Gate", x: 50, y: 92 },
    { icon: "🍔", label: "Food Stalls", x: 20, y: 50 },
    { icon: "🏥", label: "Medical Point", x: 80, y: 50 },
    { icon: "🚻", label: "Washrooms", x: 80, y: 80 },
  ],
};

function pingMeta(type) {
  return PING_TYPES.find((t) => t.key === type) || PING_TYPES[PING_TYPES.length - 1];
}

window.Views.venueMap = async function (container, params) {
  const eventId = params.id;
  const event = await Api.getEvent(eventId);
  const loggedIn = !!State.getUser();

  const zones = ZONE_TEMPLATES[event.venueLayout] || ZONE_TEMPLATES.campus;
  let pings = await Api.getPings(eventId);
  let activePicker = null;

  container.innerHTML = `
    <a href="#/event/${eventId}" class="back-link">&larr; ${escapeHtml(event.name)}</a>
    <div class="view-header">
      <span class="eyebrow"><span class="live-dot pulsing"></span> Live ground map</span>
      <h1>${escapeHtml(event.venue)}</h1>
      <p class="lede">Tap anywhere on the ground to drop a live ping — emergencies, stalls, queues, or where the crowd's at. Pings clear themselves after 45 minutes.</p>
    </div>

    <div class="venue-map-wrap">
      <div class="venue-ground" id="venue-ground">
        ${zones
          .map(
            (z) => `
          <div class="venue-zone" style="left:${z.x}%; top:${z.y}%">
            <div class="icon">${z.icon}</div>
            <div class="zone-label">${escapeHtml(z.label)}</div>
          </div>
        `
          )
          .join("")}
        <div id="ping-layer"></div>
      </div>

      <div>
        <div class="venue-legend">
          <h3>Ping types</h3>
          ${PING_TYPES.map(
            (t) => `
            <div class="legend-item">
              <span class="legend-swatch" style="background:${t.color}"></span>
              ${t.icon} ${t.label}
            </div>
          `
          ).join("")}
        </div>
        <div class="venue-legend section-gap" style="margin-top:14px">
          <h3>Recent pings</h3>
          <div class="ping-feed" id="ping-feed"></div>
        </div>
      </div>
    </div>
    <p class="venue-hint">Ground layout is a stylized illustration, not a survey-accurate map. Pings are shared with everyone currently viewing this event's map.</p>
  `;

  const ground = container.querySelector("#venue-ground");
  const pingLayer = container.querySelector("#ping-layer");
  const feedEl = container.querySelector("#ping-feed");

  function renderPingDot(ping) {
    const meta = pingMeta(ping.type);
    const dot = document.createElement("div");
    dot.className = "ping-dot";
    dot.dataset.id = ping.id;
    dot.style.left = ping.x + "%";
    dot.style.top = ping.y + "%";
    dot.style.background = meta.color;
    dot.style.color = "#14101c";
    dot.textContent = meta.icon;
    dot.title = `${meta.label}${ping.note ? " — " + ping.note : ""} · ${escapeHtml(ping.createdBy)}`;
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      toast(`${meta.label} · reported by ${ping.createdBy}`);
    });
    pingLayer.appendChild(dot);
  }

  function renderFeedItem(ping) {
    const meta = pingMeta(ping.type);
    const item = document.createElement("div");
    item.className = "ping-feed-item";
    item.dataset.id = ping.id;
    item.innerHTML = `<span class="t">${meta.icon}</span><span>${meta.label}${ping.note ? " — " + escapeHtml(ping.note) : ""} <span style="color:var(--text-faint)">· ${escapeHtml(ping.createdBy)}</span></span>`;
    feedEl.prepend(item);
  }

  pings
    .sort((a, b) => a.at - b.at)
    .forEach((p) => {
      renderPingDot(p);
      renderFeedItem(p);
    });
  if (pings.length === 0) {
    feedEl.innerHTML = `<p style="color:var(--text-faint); font-size:0.8rem; margin:0;">No pings yet — be the first to report something.</p>`;
  }

  function closePicker() {
    if (activePicker) {
      activePicker.remove();
      activePicker = null;
    }
  }

  async function submitPing(type, x, y) {
    closePicker();
    try {
      await Api.addPing(eventId, { type, x, y });
      // the new dot comes back through the SSE stream
    } catch (e) {
      toast(e.message || "Couldn't drop that ping — try again.");
    }
  }

  ground.addEventListener("click", (e) => {
    if (e.target.closest(".ping-picker") || e.target.closest(".ping-dot")) return;
    closePicker();
    if (!loggedIn) {
      toast("Log in to drop a ping.");
      return;
    }

    const rect = ground.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    // clamp the picker position so it stays inside the map
    const pickerX = Math.min(85, Math.max(15, x));
    const pickerY = Math.max(12, y);

    const picker = document.createElement("div");
    picker.className = "ping-picker";
    picker.style.left = pickerX + "%";
    picker.style.top = pickerY + "%";
    picker.innerHTML = PING_TYPES.map(
      (t) => `<button type="button" title="${t.label}" data-type="${t.key}">${t.icon}</button>`
    ).join("");
    picker.addEventListener("click", (evt) => {
      const btn = evt.target.closest("button[data-type]");
      if (!btn) return;
      submitPing(btn.dataset.type, x, y);
    });
    ground.appendChild(picker);
    activePicker = picker;
  });

  function outsideClickHandler(e) {
    if (activePicker && !e.target.closest(".ping-picker") && !e.target.closest("#venue-ground")) {
      closePicker();
    }
  }
  document.addEventListener("click", outsideClickHandler);

  // live updates over Server-Sent Events
  const stream = new EventSource(Api.pingStreamUrl(eventId));
  stream.addEventListener("ping", (e) => {
    const ping = JSON.parse(e.data);
    if (feedEl.querySelector('[style*="No pings yet"]')) feedEl.innerHTML = "";
    const placeholder = feedEl.querySelector("p");
    if (placeholder) placeholder.remove();
    renderPingDot(ping);
    renderFeedItem(ping);
  });
  stream.addEventListener("ping-removed", (e) => {
    const { ids } = JSON.parse(e.data);
    ids.forEach((id) => {
      const dot = pingLayer.querySelector(`[data-id="${id}"]`);
      if (dot) dot.remove();
      const feedItem = feedEl.querySelector(`[data-id="${id}"]`);
      if (feedItem) feedItem.remove();
    });
  });
  stream.onerror = () => {
    // EventSource reconnects by itself
  };

  return function cleanup() {
    stream.close();
    document.removeEventListener("click", outsideClickHandler);
  };
};
