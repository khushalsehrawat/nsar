(function () {
  // AOS init
  if (window.AOS) {
    AOS.init({
      once: true,
      offset: 80,
      duration: 900
    });
  }

  // Back to top button (index)
  const btn = document.getElementById("toTop");
  if (btn) {
    btn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    const toggle = () => {
      if (window.scrollY > 240) btn.style.opacity = "1";
      else btn.style.opacity = ".0";
    };
    btn.style.opacity = ".0";
    toggle();
    window.addEventListener("scroll", toggle, { passive: true });
  }

  // Active hash handling for same-page anchors (index)
  const anchors = document.querySelectorAll('a.nav-link[href^="#"]');
  anchors.forEach(a => {
    a.addEventListener("click", () => {
      const nav = document.getElementById("navMain");
      if (nav && nav.classList.contains("show")) {
        const bsCollapse = bootstrap.Collapse.getOrCreateInstance(nav);
        bsCollapse.hide();
      }
    });
  });
})();
