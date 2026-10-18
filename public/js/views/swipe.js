window.Views.swipe = async function (container, params) {
  const eventId = params.id;
  const event = await Api.getEvent(eventId);
  const currentUser = State.getUser();

  if (!currentUser) {
    container.innerHTML = `
      <a href="#/event/${eventId}" class="back-link">&larr; ${escapeHtml(event.name)}</a>
      <div class="view-header">
        <h1>Log in first</h1>
        <p class="lede">Matching is tied to your account, so the people you match with are people actually going. <a href="#/login">Log in or sign up</a>.</p>
      </div>
    `;
    return;
  }

  if (!currentUser.profileComplete) {
    location.hash = "#/onboarding";
    return;
  }

  const userId = currentUser.id;
  const selfSummary = currentUser;

  // opening the deck counts as RSVPing
  if (!event.isAttending) {
    try {
      await Api.setRsvp(eventId, true);
    } catch (e) {
      // not fatal
    }
  }

  let deck = await Api.getAttendees(eventId, userId);
  let index = 0;
  let dragging = false;
  let startX = 0;
  let currentX = 0;
  let keydownHandler = null;
  let busy = false; // guards against a double-fire from rapid key mashing / clicks

  function renderShell() {
    container.innerHTML = `
      <a href="#/event/${eventId}" class="back-link">&larr; ${escapeHtml(event.name)}</a>
      <div class="view-header">
        <span class="eyebrow">Travel buddies</span>
        <h1>Who's heading to ${escapeHtml(event.name)}?</h1>
        <p class="lede">Swipe right if you'd like to meet up, left to pass. It only counts as a match when you both say yes.</p>
      </div>
      <div class="swipe-stage">
        <div class="card-stack" id="card-stack"></div>
        <div class="swipe-controls">
          <button class="swipe-btn pass" id="pass-btn" aria-label="Pass" title="Pass (or press ←)">✕</button>
          <button class="swipe-btn like" id="like-btn" aria-label="Like" title="Like (or press →)">♥</button>
        </div>
        <p class="swipe-hint">Drag the card, use the buttons, or the ← / → arrow keys.</p>
      </div>
    `;
  }

  function renderStack() {
    const stack = container.querySelector("#card-stack");
    if (!stack) return;

    const visible = deck.slice(index, index + 3);
    if (visible.length === 0) {
      stack.innerHTML = `<div class="empty-state">You've swiped through everyone attending this event so far. Check back closer to the date — more people RSVP as it gets nearer.</div>`;
      return;
    }

    stack.innerHTML = visible
      .map(
        (u, i) => `
      <div class="swipe-card" data-depth="${i}" style="
        transform: translateY(${i * 10}px) scale(${1 - i * 0.04});
        z-index: ${10 - i};
        opacity: ${i === 2 ? 0.5 : 1};
      ">
        <span class="swipe-flag pass" data-flag="pass">Pass</span>
        <span class="swipe-flag like" data-flag="like">Yes!</span>
        <div class="avatar" style="background:${u.color}">${escapeHtml(u.initials)}</div>
        <h3>${escapeHtml(u.name)} ${u.demo ? '<span class="demo-tag" title="Sample profile for trying out Sangam">Demo</span>' : ""}</h3>
        <div class="age">${u.age} years old</div>
        <p class="bio">${escapeHtml(u.bio)}</p>
        <div class="interests">
          ${u.interests.map((t) => `<span class="interest-chip">${escapeHtml(t)}</span>`).join("")}
        </div>
        ${u.demo ? "" : `<button type="button" class="card-report" data-uid="${u.id}" title="Block or report">Report / block</button>`}
      </div>
    `
      )
      .join("");

    attachDragHandlers();
    const rep = stack.querySelector('.swipe-card[data-depth="0"] .card-report');
    if (rep) {
      rep.addEventListener("pointerdown", (e) => e.stopPropagation());
      rep.addEventListener("click", async () => {
        const reason = prompt("What's the problem? (this also blocks them)");
        if (!reason) return;
        try {
          await Api.reportUser(rep.dataset.uid, reason);
          toast("Reported and blocked. Thanks.");
          deck.splice(index, 1);
          renderStack();
        } catch (e) {
          toast(e.message);
        }
      });
    }
  }

  function attachDragHandlers() {
    const topCard = container.querySelector('.swipe-card[data-depth="0"]');
    if (!topCard) return;

    topCard.addEventListener("pointerdown", (e) => {
      dragging = true;
      startX = e.clientX;
      currentX = 0;
      topCard.setPointerCapture(e.pointerId);
    });
    topCard.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      currentX = e.clientX - startX;
      updateCardTransform(topCard, currentX);
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      const threshold = 110;
      if (currentX > threshold) commitSwipe("like");
      else if (currentX < -threshold) commitSwipe("pass");
      else {
        topCard.style.transform = "translateY(0px) scale(1)";
        topCard.querySelectorAll(".swipe-flag").forEach((f) => (f.style.opacity = 0));
      }
    };
    topCard.addEventListener("pointerup", endDrag);
    topCard.addEventListener("pointercancel", endDrag);
  }

  function updateCardTransform(card, dx) {
    const rotate = dx / 18;
    card.style.transform = `translateX(${dx}px) rotate(${rotate}deg)`;
    const likeFlag = card.querySelector('[data-flag="like"]');
    const passFlag = card.querySelector('[data-flag="pass"]');
    likeFlag.style.opacity = Math.max(0, Math.min(1, dx / 100));
    passFlag.style.opacity = Math.max(0, Math.min(1, -dx / 100));
  }

  async function commitSwipe(direction) {
    const target = deck[index];
    if (!target || busy) return;
    busy = true;

    const topCard = container.querySelector('.swipe-card[data-depth="0"]');
    if (topCard) {
      const flyX = direction === "like" ? 500 : -500;
      topCard.style.transition = "transform 0.25s ease";
      topCard.style.transform = `translateX(${flyX}px) rotate(${flyX / 18}deg)`;
    }

    let result = { matched: false };
    try {
      result = await Api.swipe(target.id, eventId, direction);
    } catch (e) {
      toast("Couldn't record that swipe — try again.");
    }

    setTimeout(() => {
      index += 1;
      busy = false;
      renderStack();
      if (result.matched) showMatchModal(target, result.match.id);
    }, 250);
  }

  function showMatchModal(otherUser, matchId) {
    const overlay = document.createElement("div");
    overlay.className = "match-overlay";
    overlay.innerHTML = `
      <div class="match-card">
        <div class="headline">It's a Sangam!</div>
        <p>You and ${escapeHtml(otherUser.name)} both want to meet up at ${escapeHtml(event.name)}.</p>
        <div class="avatars">
          <div class="avatar" style="background:${selfSummary ? selfSummary.color : "#FFB627"}">${escapeHtml(selfSummary ? selfSummary.initials : "You")}</div>
          <div class="avatar" style="background:${otherUser.color}">${escapeHtml(otherUser.initials)}</div>
        </div>
        <a class="btn btn-primary btn-block" id="say-hi-btn" href="#/chat/${matchId}">Say hi 👋</a>
        <button class="btn btn-ghost btn-block" id="keep-swiping-btn" style="margin-top:10px">Keep swiping</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector("#keep-swiping-btn").addEventListener("click", () => overlay.remove());
    overlay.querySelector("#say-hi-btn").addEventListener("click", () => overlay.remove());
  }

  renderShell();
  renderStack();

  container.querySelector("#pass-btn").addEventListener("click", () => commitSwipe("pass"));
  container.querySelector("#like-btn").addEventListener("click", () => commitSwipe("like"));

  keydownHandler = (e) => {
    if (e.key === "ArrowLeft") commitSwipe("pass");
    if (e.key === "ArrowRight") commitSwipe("like");
  };
  document.addEventListener("keydown", keydownHandler);

  return function cleanup() {
    if (keydownHandler) document.removeEventListener("keydown", keydownHandler);
  };
};
