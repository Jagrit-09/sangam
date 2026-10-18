// Post-an-event form
window.Views.addEvent = async function (container) {
  if (!State.getUser()) return requireLogin(container, "Posting an event needs an account, so listings can be traced to someone.");
  const user = State.getUser();
  if (!user.profileComplete) {
    State.next = "#/add-event";
    location.hash = "#/onboarding";
    return;
  }
  const { areas, today } = State.meta;
  let picked = { lat: areas[0].lat, lng: areas[0].lng };
  let marker = null;
  let map = null;

  container.innerHTML = `
    <a href="#/" class="back-link">&larr; All events</a>
    <div class="view-header">
      <span class="eyebrow">Community listing</span>
      <h1>Post an event</h1>
      <p class="lede">Only post things you're sure about. Others will use this to plan their evening.</p>
    </div>
    <form class="panel event-form" id="event-form" novalidate>
      <label class="field-label" for="f-name">Event name</label>
      <input id="f-name" class="text-input" maxlength="80" placeholder="Hauz Khas Social Unplugged Night" />

      <div class="form-2col">
        <div>
          <label class="field-label" for="f-type">Type</label>
          <select id="f-type" class="text-input">
            <option value="small_gig">Small gig</option>
            <option value="college_fest">College fest</option>
            <option value="major_concert">Major concert</option>
          </select>
        </div>
        <div>
          <label class="field-label" for="f-genre">Genre / vibe</label>
          <input id="f-genre" class="text-input" maxlength="40" placeholder="Indie, EDM, Rock…" />
        </div>
      </div>

      <div class="form-2col">
        <div>
          <label class="field-label" for="f-venue">Venue</label>
          <input id="f-venue" class="text-input" maxlength="80" placeholder="Venue or campus ground" />
        </div>
        <div>
          <label class="field-label" for="f-area">Area</label>
          <input id="f-area" class="text-input" maxlength="60" placeholder="Hauz Khas, Delhi" />
        </div>
      </div>

      <label class="field-label">Where is it? <span class="field-hint">Pick a nearby area, then click the map to drop the pin exactly.</span></label>
      <select id="f-preset" class="text-input">
        ${areas.map((a, i) => `<option value="${i}">${escapeHtml(a.name)}</option>`).join("")}
      </select>
      <div id="pick-map" class="pick-map"><div class="map-fallback">The map needs internet. The area you choose above will be used as the location.</div></div>

      <div class="form-3col">
        <div><label class="field-label" for="f-date">Date</label>
          <input id="f-date" type="date" class="text-input" min="${today}" /></div>
        <div><label class="field-label" for="f-start">Starts</label>
          <input id="f-start" type="time" class="text-input" value="18:00" /></div>
        <div><label class="field-label" for="f-end">Ends</label>
          <input id="f-end" type="time" class="text-input" value="22:00" /></div>
      </div>

      <label class="field-label" for="f-desc">What's happening?</label>
      <textarea id="f-desc" class="text-input" rows="4" maxlength="500" placeholder="Lineup, vibe, entry rules, who it's for."></textarea>

      <label class="field-label" for="f-tips">Getting there tip <span class="field-hint">(optional: which gate, parking, last metro)</span></label>
      <input id="f-tips" class="text-input" maxlength="250" />

      <label class="field-label" for="f-url">Ticket / info link <span class="field-hint">(optional)</span></label>
      <input id="f-url" class="text-input" type="url" placeholder="https://" />

      <p class="form-error" id="f-error" role="alert"></p>
      <button class="btn btn-primary btn-block" type="submit" id="f-submit">Publish event</button>
    </form>`;

  const $ = (s) => container.querySelector(s);

  if (window.L) {
    try {
      const el = $("#pick-map");
      el.innerHTML = "";
      map = L.map(el).setView([picked.lat, picked.lng], 12);
      addBaseMap(map);
      marker = L.marker([picked.lat, picked.lng], { draggable: true }).addTo(map);
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        picked = { lat: p.lat, lng: p.lng };
      });
      map.on("click", (e) => {
        picked = { lat: e.latlng.lat, lng: e.latlng.lng };
        marker.setLatLng(e.latlng);
      });
    } catch (e) {
      console.error(e);
    }
  }

  $("#f-preset").addEventListener("change", (e) => {
    const a = areas[Number(e.target.value)];
    picked = { lat: a.lat, lng: a.lng };
    if (map && marker) {
      marker.setLatLng([a.lat, a.lng]);
      map.setView([a.lat, a.lng], 14);
    }
    if (!$("#f-area").value) $("#f-area").value = a.name;
  });

  $("#event-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#f-error");
    err.textContent = "";
    const btn = $("#f-submit");
    btn.disabled = true;
    try {
      const ev = await Api.createEvent({
        name: $("#f-name").value,
        type: $("#f-type").value,
        genre: $("#f-genre").value,
        venue: $("#f-venue").value,
        area: $("#f-area").value,
        lat: picked.lat,
        lng: picked.lng,
        date: $("#f-date").value,
        startTime: $("#f-start").value,
        endTime: $("#f-end").value,
        description: $("#f-desc").value,
        tips: $("#f-tips").value,
        ticketUrl: $("#f-url").value,
      });
      toast("Event published.");
      location.hash = `#/event/${ev.id}`;
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });

  return () => map && map.remove();
};
