/**
 * Инициализирует все интерактивные элементы сгенерированной страницы публикации.
 *
 * Скрипт обернут в немедленно вызываемую функцию, чтобы константы и
 * вспомогательные функции не попадали в глобальную область видимости. После
 * готовности DOM он настраивает сохранение темы, мобильное меню, режимы
 * отображения контента и раскрытие парных абзацев в двуязычном тексте.
 */
(function () {
  const themeKey = "kasina-theme";
  const contentModeKey = "kasina-content-mode";
  const themes = new Set(["light", "dark"]);
  const contentModes = new Set(["bilingual", "translation", "original"]);

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
      setTheme(body.dataset.theme === "dark" ? "light" : "dark", true);
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
          pairedOriginal.classList.toggle("paired-visible");
        }
      }

      if (mode === "original" && original) {
        const pairedTranslation = original.nextElementSibling;

        if (pairedTranslation?.matches('blockquote[lang="ru"]')) {
          pairedTranslation.classList.toggle("paired-visible");
        }
      }
    }

    setTheme(storageGet(themeKey));
    setContentMode(storageGet(contentModeKey));
    setMenuOpen(false);

    menuToggle?.addEventListener("click", handleMenuToggleClick);
    navBackdrop?.addEventListener("click", closeMenu);
    navClose?.addEventListener("click", closeMenu);
    siteNav?.addEventListener("click", handleSiteNavClick);
    document.addEventListener("keydown", handleDocumentKeydown);
    themeToggle?.addEventListener("click", handleThemeToggleClick);

    for (const input of contentModeInputs) {
      input.addEventListener("change", handleContentModeInputChange);
    }

    document.addEventListener("click", handlePairedContentClick);
  }

  onReady(initializePublicationControls);
})();
