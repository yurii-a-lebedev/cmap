(function (global) {
  function t(key, vars) {
    const cat = global.CMAP_I18N || {};
    let s = cat[key] || key;
    if (vars) {
      Object.keys(vars).forEach((k) => {
        s = s.split(`{${k}}`).join(String(vars[k]));
      });
    }
    return s;
  }

  function localeTag() {
    return global.CMAP_LANG === "ru" ? "ru-RU" : "en-US";
  }

  function setLang(lang) {
    const code = String(lang || "").toLowerCase().slice(0, 2);
    if (code !== "en" && code !== "ru") return;
    document.cookie = `cmap_lang=${code};path=/;max-age=31536000;SameSite=Lax`;
    const url = new URL(window.location.href);
    url.searchParams.set("lang", code);
    window.location.href = url.toString();
  }

  function bindLangSwitch() {
    document.querySelectorAll("[data-set-lang]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        setLang(btn.getAttribute("data-set-lang"));
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindLangSwitch);
  } else {
    bindLangSwitch();
  }

  global.t = t;
  global.localeTag = localeTag;
  global.setCmapLang = setLang;
})(window);
