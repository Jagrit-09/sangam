window.Views.eventDetail = async function (container, params) {
  const event = await Api.getEvent(params.id);
  const currentUser = State.getUser();

  const sourceNote =
    event.source === "demo"
      ? "Sample event for trying out Sangam. It isn't a real listing."
      : event.source === "predicthq"
      ? "Pulled from the PredictHQ live feed. Details can change, so check with the organiser."
      : `Posted by ${escapeHtml(event.hostName || "a member")}. Check with the organiser before you go.`;

  container.innerHTML = `
    <a href="#/" class="back-link">&larr; All events</a>
    ${eventCoverHtml(event)}
    <div class="detail-head">
      <div class="badges">
        <span class="badge type-${event.type}">${EVENT_TYPE_LABELS[event.type]}</span>
        <span class="badge">${escapeHtml(event.genre)}</span>
        ${event.going ? `<span class="badge">${event.going} going</span>` : ""}
      </div>
      <h1>${escapeHtml(event.name)}</h1>
      <div class="venue-line"><strong>${escapeHtml(event.venue)}</strong> · ${escapeHtml(event.area)}</div>
      <div class="datetime">${formatDate(event.date)} · ${formatTimeRange(event.startTime, event.endTime)}</div>
    </div>

    <div class="detail-grid">
      <div class="panel">
        <h2>About</h2>
        <p style="color: var(--text)">${escapeHtml(event.description)}</p>
        ${event.tips ? `<p class="host-tip"><strong>From the host:</strong> ${escapeHtml(event.tips)}</p>` : ""}
        <p class="fare-note">${sourceNote}</p>
        <div class="action-row">
          <button class="btn ${event.isAttending ? "btn-going" : "btn-ghost"}" id="rsvp-btn">${event.isAttending ? "✓ You're going" : "I'm going"}</button>
          <button class="btn btn-primary" id="find-buddies-btn">Find travel buddies →</button>
          <button class="btn btn-ghost" id="venue-map-btn">Live venue map</button>
          ${event.ticketUrl ? `<a class="btn btn-ghost" href="${escapeHtml(event.ticketUrl)}" target="_blank" rel="noopener noreferrer nofollow">Tickets / info ↗</a>` : ""}
          ${event.isHost ? '<button class="btn btn-ghost" id="delete-event-btn">Remove event</button>' : ""}
        </div>
        ${!currentUser ? '<p class="fare-note" style="margin-top:14px"><a href="#/login">Log in</a> to RSVP and match with other attendees.</p>' : ""}
      </div>

      <div class="panel">
        <h2>Getting there</h2>
        <div id="map-container"><div class="map-fallback">Map needs internet to load.</div></div>

        <a class="map-open-link" href="${osmLink(event.lat, event.lng)}" target="_blank" rel="noopener noreferrer">Open in a full map ↗</a>

        <label class="field-label" for="origin-select" style="margin-top:16px">Where are you starting from?</label>
        <div class="origin-row">
          <select id="origin-select" class="text-input">
            <option value="">Pick a metro station…</option>
            ${State.meta.stations.map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (${s.lines.join(", ")})</option>`).join("")}
          </select>
          <button class="btn btn-ghost btn-sm" id="geo-btn" type="button" title="Use my current location">📍</button>
        </div>
        <div id="transit-out"></div>
      </div>
    </div>`;

  const $ = (sel) => container.querySelector(sel);

  $("#find-buddies-btn").addEventListener("click", () => (location.hash = `#/event/${event.id}/swipe`));
  $("#venue-map-btn").addEventListener("click", () => (location.hash = `#/event/${event.id}/map`));

  $("#rsvp-btn").addEventListener("click", async (e) => {
    if (!currentUser) {
      State.next = location.hash;
      location.hash = "#/login";
      return;
    }
    if (!currentUser.profileComplete) {
      State.next = location.hash;
      location.hash = "#/onboarding";
      return;
    }
    const goingNow = !event.isAttending;
    try {
      await Api.setRsvp(event.id, goingNow);
      event.isAttending = goingNow;
      e.target.textContent = goingNow ? "✓ You're going" : "I'm going";
      e.target.classList.toggle("btn-going", goingNow);
      e.target.classList.toggle("btn-ghost", !goingNow);
      toast(goingNow ? "You're on the list." : "RSVP removed.");
    } catch (err) {
      toast(err.message);
    }
  });

  const del = $("#delete-event-btn");
  if (del) {
    del.addEventListener("click", async () => {
      if (!confirm("Remove this event for everyone?")) return;
      try {
        await Api.deleteEvent(event.id);
        toast("Event removed.");
        location.hash = "#/";
      } catch (e) {
        toast(e.message);
      }
    });
  }

  // ---- transit estimate ----
  const out = $("#transit-out");
  const fmt = (r) => `₹${r.min}–${r.max}`;
  function renderTransit(t) {
    const n = t.nearestMetro;
    let html = `
      <div class="transit-row"><span class="label">Nearest metro</span>
        <span class="value">${escapeHtml(n.name)} (${n.lines.join(", ")} Line)<br><small>${escapeHtml(t.walkOrRide)}</small></span></div>
      <div class="transit-row"><span class="label">Last stretch by auto</span><span class="value">${fmt(t.lastMileAuto)}</span></div>`;
    if (t.otherStations.length) {
      html += `<div class="transit-row"><span class="label">Other stations</span><span class="value">${t.otherStations
        .map((s) => `${escapeHtml(s.name)} (${s.walkMins} min walk)`)
        .join("<br>")}</span></div>`;
    }
    if (t.from) {
      const f = t.from;
      html += `<div class="transit-sep">From ${escapeHtml(f.label)} · about ${f.roadKm} km</div>`;
      html += f.metro.sameStation
        ? `<div class="transit-row"><span class="label">Metro</span><span class="value">Same station. No ride needed.</span></div>`
        : `<div class="transit-row"><span class="label">Metro</span><span class="value">₹${f.metro.fare} · ${escapeHtml(f.metro.board)} → ${escapeHtml(f.metro.alight)}<br><small>${escapeHtml(f.metro.note)}</small></span></div>`;
      html += `
        <div class="transit-row"><span class="label">Auto, door to door</span><span class="value">${fmt(f.auto)}</span></div>
        <div class="transit-row"><span class="label">Cab, door to door</span><span class="value">${fmt(f.cab)}</span></div>
        ${f.note ? `<p class="fare-note">${escapeHtml(f.note)}</p>` : ""}`;
    } else {
      html += `<p class="fare-note">Pick where you're starting from to see metro, auto and cab costs.</p>`;
    }
    html += `<p class="fare-note">Estimates from straight-line distance and standard fare rules. Event-night surge and traffic can push cab and auto prices up. Not a live route planner.</p>`;
    out.innerHTML = html;
  }
  async function loadTransit(origin) {
    try {
      renderTransit(await Api.getTransit(event.id, origin));
    } catch (e) {
      out.innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
    }
  }
  let remembered = "";
  try {
    remembered = localStorage.getItem("sangam_origin") || "";
  } catch (e) {}
  const sel = $("#origin-select");
  if (remembered && State.meta.stations.some((s) => s.id === remembered)) sel.value = remembered;
  sel.addEventListener("change", () => {
    try {
      localStorage.setItem("sangam_origin", sel.value);
    } catch (e) {}
    loadTransit(sel.value ? { stationId: sel.value } : {});
  });
  $("#geo-btn").addEventListener("click", () => {
    if (!navigator.geolocation) return toast("Your browser can't share location.");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        sel.value = "";
        loadTransit({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => toast("Couldn't get your location. Pick a station instead.")
    );
  });
  loadTransit(sel.value ? { stationId: sel.value } : {});

  // ---- map ----
  if (window.L) {
    try {
      const mapEl = $("#map-container");
      mapEl.innerHTML = "";
      const map = L.map(mapEl, { zoomControl: false }).setView([event.lat, event.lng], 14);
      addBaseMap(map);
      L.marker([event.lat, event.lng]).addTo(map).bindPopup(escapeHtml(event.venue));
      return () => map.remove();
    } catch (e) {
      console.error("Map failed:", e);
    }
  }
};
