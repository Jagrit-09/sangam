window.Views.matches = async function (container) {
  if (!State.getUser()) return requireLogin(container, "Matches show up here once you and another attendee both say yes.");
  const matches = await Api.getMatches();

  container.innerHTML = `
    <div class="view-header">
      <span class="eyebrow">Your people</span>
      <h1>Matches</h1>
      <p class="lede">Everyone you've mutually matched with. Tap one to chat and plan how to get there together.</p>
    </div>
    <div id="match-list"></div>`;
  const listEl = container.querySelector("#match-list");

  if (!matches.length) {
    listEl.innerHTML = `<div class="empty-state">No matches yet. Open an event, tap “Find travel buddies”, and start swiping.</div>`;
    return;
  }
  listEl.innerHTML = `<div class="match-list">${matches
    .map(
      (m) => `
      <a class="match-list-item" href="#/chat/${m.id}">
        <div class="avatar" style="background:${m.otherUser.color}">${escapeHtml(m.otherUser.initials)}</div>
        <div class="info">
          <h4>${escapeHtml(m.otherUser.name)} ${m.otherUser.demo ? '<span class="demo-tag">Demo</span>' : ""}</h4>
          <p>${
            m.lastMessage
              ? `${m.lastMessage.mine ? "You: " : ""}${escapeHtml(m.lastMessage.text.slice(0, 60))} · ${timeAgo(m.lastMessage.at)}`
              : `Matched for ${escapeHtml(m.event ? m.event.name : "an event")} · ${timeAgo(m.at)}`
          }</p>
        </div>
        <span class="card-arrow-inline" aria-hidden="true">→</span>
      </a>`
    )
    .join("")}</div>`;
};
