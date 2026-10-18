// hash-based router (#/event/123)
const Router = (() => {
  const routes = [];
  let activeCleanup = null;

  function register(pattern, viewFn) {
    const keys = [];
    const regex = new RegExp(
      "^" +
        pattern
          .split("/")
          .map((seg) => {
            if (seg.startsWith(":")) {
              keys.push(seg.slice(1));
              return "([^/]+)";
            }
            return seg;
          })
          .join("/") +
        "$"
    );
    routes.push({ regex, keys, viewFn });
  }

  async function resolve() {
    const hash = location.hash.slice(1) || "/";
    const path = hash.split("?")[0];

    if (typeof activeCleanup === "function") {
      try {
        activeCleanup();
      } catch (e) {
        console.error("View cleanup error:", e);
      }
      activeCleanup = null;
    }

    const container = document.getElementById("app");

    for (const route of routes) {
      const match = path.match(route.regex);
      if (!match) continue;
      const params = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(match[i + 1])));

      container.innerHTML = '<p class="loading-text">Loading…</p>';
      window.scrollTo(0, 0);
      updateActiveNav(path);

      try {
        if (typeof route.viewFn !== "function") {
          throw new Error("This page didn't finish loading correctly — try a hard refresh (Ctrl+Shift+R / Cmd+Shift+R).");
        }
        const cleanup = await route.viewFn(container, params);
        if (typeof cleanup === "function") activeCleanup = cleanup;
      } catch (err) {
        console.error("View render error:", err);
        container.innerHTML = `<p class="error-text">Something went wrong loading this page: ${escapeHtml(err.message)}</p>`;
      }
      return;
    }

    container.innerHTML = '<p class="error-text">Page not found.</p>';
  }

  function updateActiveNav(path) {
    document.querySelectorAll(".top-nav a").forEach((a) => {
      const href = a.getAttribute("href").slice(1);
      a.classList.toggle("active", href === "/" ? path === "/" : path.startsWith(href));
    });
  }

  function start() {
    window.addEventListener("hashchange", resolve);
    resolve();
  }

  return { register, start };
})();
