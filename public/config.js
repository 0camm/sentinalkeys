"use strict";
window.API_BASE_URL = "https://sentinelkeys.onrender.com";

// Session handling. The panel and the API live on different domains, and mobile
// browsers block cross-site cookies, so the login token is kept here and sent as a
// header instead.
(function () {
  const KEY = "sentinel_admin_token";

  window.getToken = function () {
    try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; }
  };
  window.setToken = function (token) {
    try { localStorage.setItem(KEY, token); } catch (e) { /* storage blocked */ }
  };
  window.clearToken = function () {
    try { localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ }
  };

  // fetch() that attaches the admin token.
  window.authFetch = function (url, options) {
    const opts = Object.assign({}, options);
    opts.headers = Object.assign({}, opts.headers);
    const token = window.getToken();
    if (token) opts.headers["X-Admin-Token"] = token;
    return fetch(url, opts);
  };
})();
