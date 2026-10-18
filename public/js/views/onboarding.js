// Profile creation (first time) and editing (later). Same screen.
window.Views.onboarding = async function (container) {
  const user = State.getUser();
  if (!user) return requireLogin(container, "You need an account to make a profile.");

  const firstTime = !user.profileComplete;
  const interestOptions = State.meta.interestOptions;
  let selected = [...(user.interests || [])];

  container.innerHTML = `
    <div class="onboard-wrap">
      <div class="onboard-card">
        <div class="onboard-avatar"><div class="avatar" style="background:${user.color}">${escapeHtml(user.initials)}</div></div>
        <h1>${firstTime ? `Hey, ${escapeHtml(user.name.split(" ")[0])}.` : "Your profile"}</h1>
        <p class="lede">${firstTime ? "One quick profile before you start swiping. This is what other attendees see." : "This is what other attendees see on your card."}</p>

        <label class="field-label" for="ob-name">Name</label>
        <input id="ob-name" class="text-input" maxlength="50" value="${escapeHtml(user.name)}" />

        <label class="field-label" for="ob-age">Your age</label>
        <input id="ob-age" type="number" min="16" max="99" placeholder="21" class="text-input" value="${user.age || ""}" />

        <label class="field-label" for="ob-bio">A one-line bio</label>
        <input id="ob-bio" type="text" maxlength="120" placeholder="Front-row or nowhere. Here for the bassline." class="text-input" value="${escapeHtml(user.bio || "")}" />

        <label class="field-label">What are you into? <span class="field-hint">(pick up to 6)</span></label>
        <div class="interest-picker" id="interest-picker">
          ${interestOptions
            .map((i) => `<button type="button" class="chip ${selected.includes(i) ? "active" : ""}" data-interest="${escapeHtml(i)}">${escapeHtml(i)}</button>`)
            .join("")}
        </div>
        <p class="form-error" id="ob-error" role="alert"></p>
        <button class="btn btn-primary btn-block" id="save-profile-btn" style="margin-top:20px">${firstTime ? "Start exploring →" : "Save changes"}</button>
        ${
          firstTime
            ? ""
            : `<div class="danger-zone">
                 <p class="field-hint">Your email: ${escapeHtml(user.email)}. Only you can see it.</p>
                 <button class="btn btn-ghost btn-sm" id="delete-acct-btn">Delete my account</button>
               </div>`
        }
      </div>
    </div>`;

  const picker = container.querySelector("#interest-picker");
  picker.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-interest]");
    if (!btn) return;
    const i = btn.dataset.interest;
    if (selected.includes(i)) {
      selected = selected.filter((x) => x !== i);
      btn.classList.remove("active");
    } else if (selected.length < 6) {
      selected.push(i);
      btn.classList.add("active");
    } else toast("Up to 6 interests. Remove one first.");
  });

  const err = container.querySelector("#ob-error");
  container.querySelector("#save-profile-btn").addEventListener("click", async () => {
    err.textContent = "";
    try {
      const { user: updated } = await Api.updateProfile({
        name: container.querySelector("#ob-name").value,
        age: container.querySelector("#ob-age").value,
        bio: container.querySelector("#ob-bio").value,
        interests: selected,
      });
      State.setUser(updated);
      toast("Profile saved.");
      const next = State.next;
      State.next = null;
      location.hash = next || "#/";
    } catch (e) {
      err.textContent = e.message;
    }
  });

  const del = container.querySelector("#delete-acct-btn");
  if (del) {
    del.addEventListener("click", async () => {
      const pw = prompt("This permanently deletes your account, matches and chats. Type your password to confirm.");
      if (!pw) return;
      try {
        await Api.deleteAccount(pw);
        State.setUser(null);
        location.hash = "#/";
        toast("Account deleted.");
      } catch (e) {
        toast(e.message);
      }
    });
  }
};
