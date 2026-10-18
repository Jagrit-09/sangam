// Login and sign-up
window.Views.auth = async function (container, mode) {
  const isSignup = mode === "signup";
  if (State.getUser()) {
    location.hash = "#/";
    return;
  }
  container.innerHTML = `
    <div class="onboard-wrap">
      <form class="onboard-card" id="auth-form" novalidate>
        <h1>${isSignup ? "Join Sangam" : "Welcome back"}</h1>
        <p class="lede">${
          isSignup
            ? "Make an account to RSVP, find travel buddies and drop pings on the ground map."
            : "Log in to see your matches and chats."
        }</p>
        ${
          isSignup
            ? `<label class="field-label" for="au-name">Your name</label>
               <input id="au-name" class="text-input" autocomplete="name" maxlength="50" placeholder="Aditi Verma" />`
            : ""
        }
        <label class="field-label" for="au-email">Email</label>
        <input id="au-email" type="email" class="text-input" autocomplete="email" placeholder="you@example.com" />
        <label class="field-label" for="au-pass">Password ${isSignup ? '<span class="field-hint">(8+ characters)</span>' : ""}</label>
        <input id="au-pass" type="password" class="text-input" autocomplete="${isSignup ? "new-password" : "current-password"}" />
        <p class="form-error" id="au-error" role="alert"></p>
        <button class="btn btn-primary btn-block" id="au-submit" type="submit">${isSignup ? "Create account" : "Log in"}</button>
        <p class="onboard-skip-note">${
          isSignup
            ? 'Already have an account? <a href="#/login">Log in</a>'
            : 'New here? <a href="#/signup">Create an account</a>'
        }</p>
      </form>
    </div>`;

  const form = container.querySelector("#auth-form");
  const err = container.querySelector("#au-error");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    const btn = container.querySelector("#au-submit");
    btn.disabled = true;
    try {
      const payload = {
        email: container.querySelector("#au-email").value,
        password: container.querySelector("#au-pass").value,
      };
      if (isSignup) payload.name = container.querySelector("#au-name").value;
      const { user } = await (isSignup ? Api.signup(payload) : Api.login(payload));
      State.setUser(user);
      const next = State.next;
      State.next = null;
      if (!user.profileComplete) location.hash = "#/onboarding";
      else location.hash = next || "#/";
      toast(isSignup ? "Account created." : `Welcome back, ${user.name.split(" ")[0]}.`);
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });
};

// shown by pages that need a login
window.requireLogin = function (container, why) {
  State.next = location.hash;
  container.innerHTML = `
    <div class="view-header">
      <h1>Log in to continue</h1>
      <p class="lede">${escapeHtml(why)} <a href="#/login">Log in</a> or <a href="#/signup">sign up</a> — it takes a minute.</p>
    </div>`;
};
