window.Views.chat = async function (container, params) {
  if (!State.getUser()) return requireLogin(container, "Chats are only for matched members.");
  const me = State.getUser();
  const { match, messages } = await Api.getMessages(params.id);
  const other = match.otherUser;
  const seen = new Set();

  container.innerHTML = `
    <a href="#/matches" class="back-link">&larr; Matches</a>
    <div class="chat-head">
      <div class="avatar" style="background:${other.color}">${escapeHtml(other.initials)}</div>
      <div class="chat-head-info">
        <h2>${escapeHtml(other.name)} ${other.demo ? '<span class="demo-tag">Demo</span>' : ""}</h2>
        <p>Matched for ${escapeHtml(match.event ? match.event.name : "an event")}</p>
      </div>
      ${other.demo ? "" : '<button class="btn btn-ghost btn-sm" id="chat-report">Report / block</button>'}
    </div>
    ${other.demo ? '<p class="fare-note">This is a sample profile. It replies with canned lines so you can see how chat works.</p>' : '<p class="fare-note">Tip: meet at the metro station or a busy gate, and tell a friend where you are.</p>'}
    <div class="chat-box" id="chat-box" aria-live="polite"></div>
    <form class="chat-form" id="chat-form">
      <input class="text-input" id="chat-input" maxlength="500" placeholder="Say something…" autocomplete="off" />
      <button class="btn btn-primary" type="submit">Send</button>
    </form>`;

  const box = container.querySelector("#chat-box");
  function addMsg(m) {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    const mine = m.from === me.id;
    const el = document.createElement("div");
    el.className = "bubble " + (mine ? "mine" : "theirs");
    el.innerHTML = `${escapeHtml(m.text)}<span class="bubble-time">${new Date(m.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>`;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }
  messages.forEach(addMsg);
  if (!messages.length) box.innerHTML = '<p class="chat-empty">No messages yet. Break the ice.</p>';
  const clearEmpty = () => {
    const e = box.querySelector(".chat-empty");
    if (e) e.remove();
  };

  const form = container.querySelector("#chat-form");
  const input = container.querySelector("#chat-input");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    try {
      const m = await Api.sendMessage(params.id, text);
      clearEmpty();
      addMsg(m);
    } catch (ex) {
      input.value = text;
      toast(ex.message);
    }
  });

  const es = new EventSource(Api.chatStreamUrl(params.id));
  es.addEventListener("message", (ev) => {
    clearEmpty();
    addMsg(JSON.parse(ev.data));
  });

  const rep = container.querySelector("#chat-report");
  if (rep) {
    rep.addEventListener("click", async () => {
      const reason = prompt("What's the problem? (they'll be blocked and this chat hidden)");
      if (!reason) return;
      try {
        await Api.reportUser(other.id, reason);
        toast("Reported and blocked.");
        location.hash = "#/matches";
      } catch (e) {
        toast(e.message);
      }
    });
  }
  input.focus();
  return () => es.close();
};
