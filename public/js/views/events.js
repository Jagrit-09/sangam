window.Views.events = async function (container) {
  let activeType = "";
  let query = "";
  let mineOnly = false;
  const TYPE_ICON = { college_fest: "🎓", small_gig: "🎸", major_concert: "🏟️" };
  const types = ["college_fest", "small_gig", "major_concert"];
  const loggedIn = !!State.getUser();

  container.innerHTML = `
    <div class="view-header">
      <span class="eyebrow"><span class="live-dot pulsing"></span> Delhi NCR · upcoming</span>
      <h1>Where the music <span class="text-glow">takes you.</span></h1>
      <p class="lede">College fests, small gigs and big stadium nights, posted by people who know about them. Know of one that's missing? <a href="#/add-event">Post it</a>.</p>
    </div>
    <div class="stats-strip" id="stats-strip"></div>
    <div class="search-row">
      <input id="ev-search" class="text-input" type="search" placeholder="Search events, venues, genres…" />
    </div>
    <div class="chip-row" id="filter-chips"></div>
    <div class="event-grid" id="event-grid"></div>`;

  const chipsEl = container.querySelector("#filter-chips");
  const gridEl = container.querySelector("#event-grid");

  function renderChips() {
    chipsEl.innerHTML =
      `<button class="chip ${!activeType && !mineOnly ? "active" : ""}" data-type="">All</button>` +
      types.map((t) => `<button class="chip ${activeType === t ? "active" : ""}" data-type="${t}">${TYPE_ICON[t]} ${EVENT_TYPE_LABELS[t]}</button>`).join("") +
      (loggedIn ? `<button class="chip ${mineOnly ? "active" : ""}" data-mine="1">My posts</button>` : "");
  }

  async function load() {
    gridEl.innerHTML = '<p class="loading-text">Loading…</p>';
    const events = await Api.getEvents({ type: activeType, q: query, mine: mineOnly ? "1" : "" });
    const next = events[0];
    container.querySelector("#stats-strip").innerHTML = events.length
      ? `<div><b>${events.length}</b><span>upcoming</span></div>
         <div><b>${events.reduce((n, e) => n + (e.going || 0), 0)}</b><span>people going</span></div>
         <div><b>${events.filter((e) => e.source === "community").length}</b><span>community posted</span></div>
         <div><b>${next ? (daysUntil(next.date) || "").replace("In ", "") : "–"}</b><span>until the next one</span></div>`
      : "";
    if (!events.length) {
      gridEl.innerHTML = `<div class="empty-state">${
        query || activeType || mineOnly
          ? "Nothing matches that. Try clearing the filters."
          : 'No upcoming events yet. Be the first — <a href="#/add-event">post one</a>.'
      }</div>`;
      return;
    }
    gridEl.innerHTML = events
      .map((e, i) => {
        const countdown = daysUntil(e.date);
        return `
        <article class="event-card type-${e.type}" data-id="${e.id}" style="animation-delay:${Math.min(i, 8) * 45}ms" tabindex="0" role="link">
          ${eventCoverHtml(e)}
          <div class="event-card-top">
            <span class="badge type-${e.type}">${TYPE_ICON[e.type]} ${EVENT_TYPE_LABELS[e.type]}</span>
            ${countdown ? `<span class="countdown-chip">${countdown}</span>` : ""}
          </div>
          <h3>${escapeHtml(e.name)}</h3>
          <div class="meta">
            <span>${escapeHtml(e.venue)} · ${escapeHtml(e.area)}</span>
            <span class="date">${formatDate(e.date)} · ${e.startTime}</span>
            <span>${escapeHtml(e.genre)}${e.going ? ` · ${e.going} going` : ""}</span>
          </div>
          <span class="card-arrow" aria-hidden="true">→</span>
        </article>`;
      })
      .join("");
    gridEl.querySelectorAll(".event-card").forEach((card) => {
      const go = () => (location.hash = `#/event/${card.dataset.id}`);
      card.addEventListener("click", go);
      card.addEventListener("keydown", (e) => e.key === "Enter" && go());
    });
  }

  chipsEl.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    mineOnly = !!chip.dataset.mine;
    activeType = chip.dataset.type || "";
    renderChips();
    load();
  });
  let timer;
  container.querySelector("#ev-search").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      query = e.target.value.trim();
      load();
    }, 250);
  });

  renderChips();
  await load();
};
