(async function boot() {
  const authArea = document.getElementById("auth-area");

  function renderAuthArea() {
    const user = State.getUser();
    if (!user) {
      authArea.innerHTML = `
        <a class="btn btn-ghost btn-sm" href="#/login">Log in</a>
        <a class="btn btn-primary btn-sm" href="#/signup">Sign up</a>`;
      return;
    }
    authArea.innerHTML = `
      <a class="user-chip" href="#/profile" title="Your profile">
        <span class="user-chip-avatar avatar" style="background:${user.color}">${escapeHtml(user.initials)}</span>
        <span class="user-chip-name">${escapeHtml(user.name.split(" ")[0])}</span>
      </a>
      <button class="btn-logout" id="logout-btn" title="Log out">⏻</button>`;
    document.getElementById("logout-btn").addEventListener("click", async () => {
      try {
        await Api.logout();
      } catch (e) {}
      State.setUser(null);
      location.hash = "#/";
      toast("Logged out.");
    });
  }
  State.onUserChange(renderAuthArea);

  const [meta, me] = await Promise.all([
    Api.getMeta().catch(() => ({ interestOptions: [], areas: [], stations: [] })),
    Api.getMe().catch(() => ({ user: null })),
  ]);
  State.meta = meta;
  State.setUser(me.user);

  // routes
  Router.register("/", (c) => Views.events(c));
  Router.register("/login", (c) => Views.auth(c, "login"));
  Router.register("/signup", (c) => Views.auth(c, "signup"));
  Router.register("/onboarding", (c) => Views.onboarding(c));
  Router.register("/profile", (c) => Views.onboarding(c));
  Router.register("/add-event", (c) => Views.addEvent(c));
  Router.register("/event/:id", (c, p) => Views.eventDetail(c, p));
  Router.register("/event/:id/swipe", (c, p) => Views.swipe(c, p));
  Router.register("/event/:id/map", (c, p) => Views.venueMap(c, p));
  Router.register("/matches", (c) => Views.matches(c));
  Router.register("/chat/:id", (c, p) => Views.chat(c, p));

  Router.start();
})();
