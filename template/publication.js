/**
 * Инициализирует все интерактивные элементы сгенерированной страницы публикации.
 *
 * Скрипт обернут в немедленно вызываемую функцию, чтобы константы и
 * вспомогательные функции не попадали в глобальную область видимости. После
 * готовности DOM он настраивает сохранение темы, мобильное меню, режимы
 * отображения контента и раскрытие парных абзацев в двуязычном тексте.
 */
(function () {
  const themeKey = "theme";
  const contentModeKey = "content-mode";
  const themes = new Set(["light", "dark"]);
  const contentModes = new Set(["bilingual", "translation", "original"]);
  const readingPositionKey = "reading-position";

  /**
   * Читает строковое значение из localStorage.
   *
   * Доступ к localStorage может быть запрещен в приватном режиме, внутри
   * ограниченных iframe или настройками браузера. В таких случаях функция
   * возвращает null, чтобы вызывающий код мог использовать значение по
   * умолчанию и не прерывал инициализацию страницы.
   *
   * @param {string} key Ключ, по которому нужно прочитать значение.
   * @returns {string | null} Сохраненное значение, null при отсутствии ключа
   * или недоступности хранилища.
   */
  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  /**
   * Сохраняет строковое значение в localStorage, если хранилище доступно.
   *
   * Ошибки записи намеренно игнорируются: эти настройки являются улучшением
   * поверх базовой работы страницы. Текущее состояние интерфейса все равно
   * можно обновить, даже если браузер не позволит запомнить его для следующего
   * посещения.
   *
   * @param {string} key Ключ, по которому нужно записать значение.
   * @param {string} value Значение для сохранения.
   * @returns {void}
   */
  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Browsing modes can disable localStorage; the current page still works.
    }
  }

  /**
   * Принимает значение только тогда, когда оно входит в разрешенный набор.
   *
   * Это защищает DOM datasets от устаревших значений из localStorage и
   * неожиданных значений из элементов управления: все неизвестные варианты
   * заменяются безопасным значением по умолчанию.
   *
   * @param {string | null | undefined} value Проверяемое значение.
   * @param {Set<string>} allowedValues Допустимые значения настройки.
   * @param {string} fallback Значение, используемое при недопустимом варианте.
   * @returns {string} Исходное значение, если оно допустимо, иначе fallback.
   */
  function normalizedValue(value, allowedValues, fallback) {
    return allowedValues.has(value) ? value : fallback;
  }

  /**
   * Запускает callback, когда DOM уже можно безопасно читать.
   *
   * Если скрипт выполняется до DOMContentLoaded, callback откладывается до
   * завершения разбора документа. Если документ уже готов, callback запускается
   * сразу, чтобы инициализация не была пропущена.
   *
   * @param {() => void} callback Функция с DOM-зависимой логикой.
   * @returns {void}
   */
  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
      return;
    }

    callback();
  }

  /**
   * Находит элементы управления публикацией в DOM и подключает обработчики.
   *
   * Функция управляет всем интерактивным состоянием страницы. Само состояние
   * хранится в body.dataset, чтобы CSS мог реагировать на изменение меню, темы
   * и режима отображения контента без дублирования правил видимости в
   * JavaScript.
   *
   * @returns {void}
   */
  function initializePublicationControls() {
    const body = document.body;
    const menuToggle = document.querySelector(".menu-toggle");
    const navBackdrop = document.querySelector(".nav-backdrop");
    const navClose = document.querySelector(".nav-close");
    const siteNav = document.querySelector(".site-nav");
    const offlineStatus = document.querySelector(".offline-status");
    const themeToggle = document.querySelector(".theme-toggle");
    const contentModeInputs = Array.from(
      document.querySelectorAll('input[name="content-mode"]'),
    );
    const isContentModeEnabled = body.dataset.contentModeDisabled !== "true";

    /**
     * Открывает или закрывает мобильное навигационное меню.
     *
     * Состояние меню синхронизируется сразу в двух местах: в
     * body.dataset.menuOpen для CSS-стилей и в aria-expanded кнопки-переключателя
     * для вспомогательных технологий.
     *
     * @param {boolean} isOpen Должно ли меню быть открытым.
     * @returns {void}
     */
    function setMenuOpen(isOpen) {
      body.dataset.menuOpen = String(isOpen);

      if (menuToggle) {
        menuToggle.setAttribute("aria-expanded", String(isOpen));
      }
    }

    /**
     * Применяет выбранную цветовую тему и при необходимости сохраняет ее.
     *
     * Недопустимые или отсутствующие значения заменяются светлой темой. Текст
     * кнопки обновляется так, чтобы он описывал действие следующего нажатия.
     *
     * @param {string | null | undefined} theme Запрошенное имя темы.
     * @param {boolean} [shouldPersist=false] Нужно ли запомнить тему.
     * @returns {void}
     */
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

    /**
     * Применяет выбранный режим отображения двуязычного контента.
     *
     * Если переключение режимов отключено для страницы, функция завершается без
     * изменения состояния. Иначе она нормализует режим, записывает его в
     * body.dataset.contentMode для CSS, синхронизирует radio input и при
     * необходимости сохраняет выбор.
     *
     * @param {string | null | undefined} contentMode Запрошенный режим.
     * @param {boolean} [shouldPersist=false] Нужно ли запомнить режим.
     * @returns {void}
     */
    function setContentMode(contentMode, shouldPersist = false) {
      if (!isContentModeEnabled) {
        return;
      }

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

    /**
     * Показывает статус офлайн-режима, когда браузер действительно потерял сеть.
     *
     * @returns {void}
     */
    function updateOfflineStatus() {
      if (offlineStatus) {
        offlineStatus.hidden = navigator.onLine;
      }
    }

    /**
     * Переключает мобильное меню из текущего состояния в противоположное.
     *
     * @returns {void}
     */
    function handleMenuToggleClick() {
      setMenuOpen(body.dataset.menuOpen !== "true");
    }

    /**
     * Закрывает мобильное навигационное меню.
     *
     * Один и тот же обработчик используется для всех действий, которые должны
     * закрывать меню: клика по фону, кнопки закрытия и перехода по ссылке
     * навигации.
     *
     * @returns {void}
     */
    function closeMenu() {
      setMenuOpen(false);
    }

    /**
     * Закрывает навигационное меню после клика по ссылке внутри него.
     *
     * @param {MouseEvent} event Событие клика внутри контейнера навигации.
     * @returns {void}
     */
    function handleSiteNavClick(event) {
      const target =
        event.target instanceof Element
          ? event.target
          : event.target?.parentElement;

      if (target?.closest("a")) {
        closeMenu();
      }
    }

    /**
     * Закрывает навигационное меню при нажатии клавиши Escape.
     *
     * @param {KeyboardEvent} event Событие нажатия клавиши на документе.
     * @returns {void}
     */
    function handleDocumentKeydown(event) {
      if (event.key === "Escape") {
        closeMenu();
      }
    }

    /**
     * Переключает светлую и темную тему и сохраняет новое значение.
     *
     * @returns {void}
     */
    function handleThemeToggleClick() {
      const next = body.dataset.theme === "dark" ? "light" : "dark";
      const apply = () => setTheme(next, true);

      const vt = document.startViewTransition;
      if (typeof vt === "function") {
        vt.call(document, apply);
        return;
      }

      apply();
    }

    /**
     * Применяет и сохраняет режим контента, выбранный через radio input.
     *
     * @param {Event} event Событие изменения radio input режима контента.
     * @returns {void}
     */
    function handleContentModeInputChange(event) {
      const input = event.currentTarget;

      if (isContentModeEnabled && input.checked) {
        setContentMode(input.value, true);
      }
    }

    let visiblePseudoAnchor = null;

    /**
     * Проверяет, находится ли точка в зоне псевдо-якоря блока.
     *
     * @param {Element} block Блок с id.
     * @param {MouseEvent} event Событие мыши.
     * @returns {boolean} true, если точка попадает в область "#".
     */
    function isInPseudoAnchorArea(block, event) {
      const rect = block.getBoundingClientRect();
      const style = window.getComputedStyle(block);
      const fontSize = Number.parseFloat(style.fontSize) || 16;
      const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.2;
      const left = rect.left - fontSize * 1.6;
      const right = rect.left;
      const top = rect.top;
      const bottom = Math.min(rect.bottom, rect.top + lineHeight);

      return (
        event.clientX >= left &&
        event.clientX <= right &&
        event.clientY >= top &&
        event.clientY <= bottom
      );
    }

    /**
     * Находит блок, псевдо-якорь которого находится под курсором.
     *
     * @param {MouseEvent} event Событие мыши.
     * @returns {Element | null} Блок с id или null.
     */
    function pseudoAnchorBlockAtPoint(event) {
      const target =
        event.target instanceof Element
          ? event.target
          : event.target?.parentElement;
      const directBlock = target?.closest(
        'main > [id^="en"], main > [id^="ru"]',
      );

      if (directBlock && isInPseudoAnchorArea(directBlock, event)) {
        return directBlock;
      }

      for (const block of document.querySelectorAll(
        'main > [id^="en"], main > [id^="ru"]',
      )) {
        if (isInPseudoAnchorArea(block, event)) {
          return block;
        }
      }

      return null;
    }

    /**
     * Находит текущий текстовый блок под курсором или его псевдо-якорем.
     *
     * @param {MouseEvent} event Событие мыши.
     * @returns {Element | null} Блок с id или null.
     */
    function sectionBlockAtPoint(event) {
      const target =
        event.target instanceof Element
          ? event.target
          : event.target?.parentElement;
      const directBlock = target?.closest(
        'main > [id^="en"], main > [id^="ru"]',
      );

      return directBlock || pseudoAnchorBlockAtPoint(event);
    }

    /**
     * Синхронизирует класс видимости для псевдо-якоря под курсором.
     *
     * @param {Element | null} block Текущий блок или null.
     * @returns {void}
     */
    function setVisiblePseudoAnchor(block) {
      if (visiblePseudoAnchor === block) {
        return;
      }

      visiblePseudoAnchor?.classList.remove("section-anchor-visible");
      visiblePseudoAnchor = block;
      visiblePseudoAnchor?.classList.add("section-anchor-visible");
    }

    /**
     * Обновляет видимость псевдо-якоря при движении мыши.
     *
     * @param {MouseEvent} event Событие движения мыши.
     * @returns {void}
     */
    function handlePseudoAnchorMousemove(event) {
      setVisiblePseudoAnchor(sectionBlockAtPoint(event));
    }

    /**
     * Находит текстовый блок, если клик пришел в область его псевдо-якоря.
     *
     * Символ "#" рисуется через CSS ::before, поэтому DOM-элемента ссылки нет.
     * Для сохранения кликабельности проверяем координаты клика относительно
     * левой области блока, где расположен псевдоэлемент.
     *
     * @param {MouseEvent} event Событие клика по документу.
     * @returns {Element | null} Блок с id, если клик попал по псевдо-якорю.
     */
    function pseudoAnchorTarget(event) {
      return pseudoAnchorBlockAtPoint(event);
    }

    /**
     * Переходит к hash текущего блока при клике по псевдо-якорю.
     *
     * @param {MouseEvent} event Событие клика по документу.
     * @returns {void}
     */
    function handlePseudoAnchorClick(event) {
      const block = pseudoAnchorTarget(event);

      if (!block) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      window.location.hash = block.id;
    }

    /**
     * Показывает или скрывает парный абзац в режимах только перевода или
     * только оригинала.
     *
     * В режиме перевода клик по русскому blockquote переключает видимость
     * предыдущего английского абзаца, если он является парным оригиналом. В
     * режиме оригинала клик по английскому абзацу переключает следующий русский
     * blockquote. Интерактивные элементы игнорируются, чтобы ссылки и формы
     * продолжали работать стандартным образом.
     *
     * @param {MouseEvent} event Событие клика по документу.
     * @returns {void}
     */
    function handlePairedContentClick(event) {
      if (!isContentModeEnabled) {
        return;
      }

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
          const isVisible = pairedOriginal.classList.toggle("paired-visible");
          translation.classList.toggle("paired-trigger-visible", isVisible);
        }
      }

      if (mode === "original" && original) {
        const pairedTranslation = original.nextElementSibling;

        if (pairedTranslation?.matches('blockquote[lang="ru"]')) {
          const isVisible =
            pairedTranslation.classList.toggle("paired-visible");
          original.classList.toggle("paired-trigger-visible", isVisible);
        }
      }
    }

    setTheme(storageGet(themeKey));
    setContentMode(storageGet(contentModeKey));
    setMenuOpen(false);
    updateOfflineStatus();

    // --- Continue reading ---

    /**
     * Возвращает имя файла текущей страницы (например, "04-day-one.html").
     * @returns {string}
     */
    function currentPagePath() {
      return window.location.pathname.split("/").pop() || "index.html";
    }

    /**
     * Сохраняет позицию чтения в localStorage.
     *
     * @param {string} hash Значение хэша без символа #.
     * @returns {void}
     */
    function saveReadingPosition(hash) {
      if (!hash) return;
      storageSet(readingPositionKey, currentPagePath() + "#" + hash);
    }

    // Сохраняем позицию при загрузке страницы с якорем
    if (window.location.hash) {
      saveReadingPosition(window.location.hash.slice(1));
    }

    // Отслеживаем скролл для автосохранения позиции на страницах контента
    if (isContentModeEnabled) {
      var enBlocks = Array.from(document.querySelectorAll('main > [id^="en"]'));

      if (enBlocks.length > 0) {
        var mostVisibleId = null;
        var saveTimeout = null;

        var readingObserver = new IntersectionObserver(
          function (entries) {
            var topmostId = null;
            var topmostY = Infinity;

            for (var i = 0; i < entries.length; i++) {
              if (
                entries[i].intersectionRatio > 0 &&
                entries[i].boundingClientRect.top < topmostY
              ) {
                topmostY = entries[i].boundingClientRect.top;
                topmostId = entries[i].target.id;
              }
            }

            if (topmostId && topmostId !== mostVisibleId) {
              mostVisibleId = topmostId;

              if (saveTimeout) {
                clearTimeout(saveTimeout);
              }

              saveTimeout = setTimeout(function () {
                saveReadingPosition(mostVisibleId);
              }, 1500);
            }
          },
          { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5] },
        );

        for (var i = 0; i < enBlocks.length; i++) {
          readingObserver.observe(enBlocks[i]);
        }
      }
    }

    // Показываем кнопку «Продолжить чтение» на титульной странице
    if (!isContentModeEnabled) {
      var savedPosition = storageGet(readingPositionKey);

      if (savedPosition && savedPosition.indexOf("#") !== -1) {
        var main = document.querySelector("main");

        if (main) {
          var bar = document.createElement("div");
          bar.className = "continue-reading-bar";

          var link = document.createElement("a");
          link.className = "continue-reading-link";
          link.href = savedPosition;
          link.textContent = "Продолжить чтение →";

          bar.appendChild(link);

          var h1 = main.querySelector("h1");

          if (h1 && h1.nextSibling) {
            main.insertBefore(bar, h1.nextSibling);
          } else {
            main.insertBefore(bar, main.firstChild);
          }
        }
      }
    }

    menuToggle?.addEventListener("click", handleMenuToggleClick);
    navBackdrop?.addEventListener("click", closeMenu);
    navClose?.addEventListener("click", closeMenu);
    siteNav?.addEventListener("click", handleSiteNavClick);
    document.addEventListener("keydown", handleDocumentKeydown);
    window.addEventListener("online", updateOfflineStatus);
    window.addEventListener("offline", updateOfflineStatus);
    themeToggle?.addEventListener("click", handleThemeToggleClick);

    for (const input of contentModeInputs) {
      input.addEventListener("change", handleContentModeInputChange);
    }

    document.addEventListener("mousemove", handlePseudoAnchorMousemove);
    document.addEventListener("mouseleave", () => setVisiblePseudoAnchor(null));
    document.addEventListener("click", handlePseudoAnchorClick);
    document.addEventListener("click", handlePairedContentClick);
    window.addEventListener("hashchange", function () {
      if (window.location.hash) {
        saveReadingPosition(window.location.hash.slice(1));
      }
    });
  }

  onReady(initializePublicationControls);
})();
