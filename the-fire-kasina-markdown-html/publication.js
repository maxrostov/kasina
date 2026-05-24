(function () {
  const themeKey = "kasina-theme";
  const contentModeKey = "kasina-content-mode";
  const themes = new Set(["light", "dark"]);
  const contentModes = new Set(["bilingual", "translation", "original"]);

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Browsing modes can disable localStorage; the current page still works.
    }
  }

  function normalizedValue(value, allowedValues, fallback) {
    return allowedValues.has(value) ? value : fallback;
  }

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
      return;
    }

    callback();
  }

  onReady(() => {
    const body = document.body;
    const menuToggle = document.querySelector(".menu-toggle");
    const navBackdrop = document.querySelector(".nav-backdrop");
    const navClose = document.querySelector(".nav-close");
    const siteNav = document.querySelector(".site-nav");
    const themeToggle = document.querySelector(".theme-toggle");
    const contentModeInputs = Array.from(
      document.querySelectorAll('input[name="content-mode"]'),
    );

    function setMenuOpen(isOpen) {
      body.dataset.menuOpen = String(isOpen);

      if (menuToggle) {
        menuToggle.setAttribute("aria-expanded", String(isOpen));
      }
    }

    function setTheme(theme, shouldPersist = false) {
      const nextTheme = normalizedValue(theme, themes, "light");

      body.dataset.theme = nextTheme;

      if (themeToggle) {
        themeToggle.textContent =
          nextTheme === "dark" ? "Светлая тема" : "Темная тема";
      }

      if (shouldPersist) {
        storageSet(themeKey, nextTheme);
      }
    }

    function setContentMode(contentMode, shouldPersist = false) {
      const nextContentMode = normalizedValue(
        contentMode,
        contentModes,
        "bilingual",
      );

      body.dataset.contentMode = nextContentMode;

      for (const input of contentModeInputs) {
        input.checked = input.value === nextContentMode;
      }

      if (shouldPersist) {
        storageSet(contentModeKey, nextContentMode);
      }
    }

    setTheme(storageGet(themeKey));
    setContentMode(storageGet(contentModeKey));
    setMenuOpen(false);

    menuToggle?.addEventListener("click", () => {
      setMenuOpen(body.dataset.menuOpen !== "true");
    });

    navBackdrop?.addEventListener("click", () => {
      setMenuOpen(false);
    });

    navClose?.addEventListener("click", () => {
      setMenuOpen(false);
    });

    siteNav?.addEventListener("click", (event) => {
      if (event.target.closest("a")) {
        setMenuOpen(false);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    });

    themeToggle?.addEventListener("click", () => {
      setTheme(body.dataset.theme === "dark" ? "light" : "dark", true);
    });

    for (const input of contentModeInputs) {
      input.addEventListener("change", () => {
        if (input.checked) {
          setContentMode(input.value, true);
        }
      });
    }

    document.addEventListener("click", (event) => {
      const target =
        event.target instanceof Element
          ? event.target
          : event.target?.parentElement;

      if (!target) {
        return;
      }

      const mode = body.dataset.contentMode;
      const translation = target.closest('main > blockquote[lang="ru"]');
      const original = target.closest("main > [lang='en']");

      if (target.closest("a, button, input, textarea, select, summary")) {
        return;
      }

      if (mode === "translation" && translation) {
        const pairedOriginal = translation.previousElementSibling;

        if (pairedOriginal?.matches('[lang="en"]')) {
          pairedOriginal.classList.toggle("paired-visible");
        }
      }

      if (mode === "original" && original) {
        const pairedTranslation = original.nextElementSibling;

        if (pairedTranslation?.matches('blockquote[lang="ru"]')) {
          pairedTranslation.classList.toggle("paired-visible");
        }
      }
    });
  });
})();
