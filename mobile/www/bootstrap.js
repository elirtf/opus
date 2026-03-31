/**
 * Bootstrap for Capacitor WebView: remember Opus base URL in WebView localStorage (capacitor:// origin),
 * then navigate to the real Opus site so cookies/session behave like the browser.
 */
(function () {
  var STORAGE_KEY = 'opus_server_base_url';

  function normalizeUrl(raw) {
    var u = (raw || '').trim();
    if (!u) return null;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    u = u.replace(/\/+$/, '');
    return u;
  }

  function showErr(msg, el) {
    el.textContent = msg;
    el.hidden = !msg;
  }

  function tryRedirect(saved, errEl) {
    if (!saved || !/^https:\/\//i.test(saved)) return false;
    showErr('', errEl);
    window.location.replace(saved + '/');
    return true;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var errEl = document.getElementById('err');
    var input = document.getElementById('url');
    var saved = localStorage.getItem(STORAGE_KEY);

    if (tryRedirect(saved, errEl)) return;

    if (saved) input.value = saved;

    document.getElementById('go').addEventListener('click', function () {
      var base = normalizeUrl(input.value);
      if (!base) {
        showErr('Enter a server URL.', errEl);
        return;
      }
      if (!/^https:\/\//i.test(base)) {
        showErr('Use an https:// URL for production (required on iOS).', errEl);
        return;
      }
      try {
        new URL(base);
      } catch (e) {
        showErr('Invalid URL.', errEl);
        return;
      }
      localStorage.setItem(STORAGE_KEY, base);
      window.location.replace(base + '/');
    });

    document.getElementById('clear').addEventListener('click', function () {
      localStorage.removeItem(STORAGE_KEY);
      input.value = '';
      showErr('Saved URL cleared.', errEl);
    });
  });
})();
