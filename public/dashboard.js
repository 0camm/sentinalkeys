"use strict";

const keyList = document.getElementById("key-list");
const historyList = document.getElementById("history-list");
const keyCount = document.getElementById("key-count");
const tabButtons = document.querySelectorAll(".tab-btn");
const views = document.querySelectorAll(".view");
const logoutBtn = document.getElementById("logout-btn");

// Keys are looked up by id from this in-memory map rather than round-tripped
// through HTML attributes, so nothing from the key data ever needs to be
// parsed back out of the DOM.
let keysById = new Map();

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function renderEmpty(container, message) {
  clear(container);
  container.appendChild(el("div", "empty-state", message));
}

function renderKeys(keys) {
  keysById = new Map(keys.map((k) => [k.id, k]));
  clear(keyList);

  if (!keys.length) {
    renderEmpty(keyList, "No keys loaded yet.");
    keyCount.textContent = "0 keys";
    return;
  }

  const usedCount = keys.filter((k) => k.copied).length;
  keyCount.textContent = `${keys.length} keys, ${usedCount} used`;

  keys.forEach((k) => {
    const row = el("div", "key-row" + (k.copied ? " copied" : ""));

    const left = el("div", "key-left");
    left.appendChild(el("div", "key-value", k.key));

    const right = el("div", "key-right");
    right.appendChild(el("span", "key-status" + (k.copied ? " used" : ""),
      k.copied ? "Copied " + formatTime(k.copiedAt) : "Unused"));

    if (k.device) {
      right.appendChild(el("span", "key-status used", "Activated"));
      const rst = el("button", "reset-btn", "Reset PC");
      rst.type = "button";
      rst.addEventListener("click", () => resetKey(k.id));
      right.appendChild(rst);
    }

    const btn = el("button", "copy-btn" + (k.copied ? " used-btn" : ""),
      k.copied ? "Copy again" : "Click to copy");
    btn.type = "button";
    btn.dataset.id = k.id;
    btn.addEventListener("click", () => copyKey(k.id));
    right.appendChild(btn);

    row.appendChild(left);
    row.appendChild(right);
    keyList.appendChild(row);
  });
}

// navigator.clipboard is unavailable or refused on some mobile browsers, so fall back
// to a hidden textarea, and finally to a prompt the user can copy from.
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) { /* try the fallback */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px;";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (err) {
    return false;
  }
}

async function copyKey(id) {
  const entry = keysById.get(id);
  if (!entry) return;
  try {
    if (!(await copyText(entry.key))) {
      window.prompt("Copy this key:", entry.key);
    }
    const res = await authFetch(`${window.API_BASE_URL}/api/keys/${encodeURIComponent(id)}/copy`, {
      method: "POST"
    });
    if (res.status === 401) return redirectToLogin();
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error("Copy request failed:", res.status, body);
    }
    await loadKeys();
  } catch (err) {
    console.error("Copy action failed:", err);
  }
}

async function resetKey(id) {
  if (!window.confirm("Unlink this key from its PC so it can be activated on a new one?")) return;
  try {
    const res = await authFetch(`${window.API_BASE_URL}/api/keys/${encodeURIComponent(id)}/reset`, {
      method: "POST"
    });
    if (res.status === 401) return redirectToLogin();
    await loadKeys();
  } catch (err) {
    console.error("Reset failed:", err);
  }
}

const genBtn = document.getElementById("gen-btn");
const genCount = document.getElementById("gen-count");
const genStatus = document.getElementById("gen-status");

async function generateKeys() {
  genBtn.disabled = true;
  genStatus.textContent = "Generating...";
  try {
    const res = await authFetch(`${window.API_BASE_URL}/api/keys/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: Number(genCount.value) })
    });
    if (res.status === 401) return redirectToLogin();
    if (!res.ok) {
      genStatus.textContent = `Failed (${res.status}).`;
      return;
    }
    const data = await res.json();
    genStatus.textContent = `Created ${data.keys.length} new key${data.keys.length === 1 ? "" : "s"}.`;
    await loadKeys();
  } catch (err) {
    console.error("Generate failed:", err);
    genStatus.textContent = "Failed. Check console.";
  } finally {
    genBtn.disabled = false;
  }
}

genBtn.addEventListener("click", generateKeys);

function renderHistory(history) {
  clear(historyList);
  if (!history.length) {
    renderEmpty(historyList, "No copy activity yet.");
    return;
  }
  history.forEach((h) => {
    const row = el("div", "history-row");
    row.appendChild(el("span", "history-key", h.key));
    row.appendChild(el("span", "history-time", formatTime(h.copiedAt)));
    historyList.appendChild(row);
  });
}

function redirectToLogin() {
  clearToken();
  window.location.href = "/login.html";
}

async function loadKeys() {
  try {
    const res = await authFetch(`${window.API_BASE_URL}/api/keys`);
    if (res.status === 401) return redirectToLogin();
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error("Failed to load keys:", res.status, body);
      renderEmpty(keyList, `Failed to load keys (${res.status}). Check server logs.`);
      keyCount.textContent = "Error";
      return;
    }
    const data = await res.json();
    renderKeys(data.keys || []);
  } catch (err) {
    console.error("Failed to load keys:", err);
    renderEmpty(keyList, "Failed to load keys. Check console/server logs.");
    keyCount.textContent = "Error";
  }
}

async function loadHistory() {
  try {
    const res = await authFetch(`${window.API_BASE_URL}/api/history`);
    if (res.status === 401) return redirectToLogin();
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error("Failed to load history:", res.status, body);
      renderEmpty(historyList, `Failed to load history (${res.status}).`);
      return;
    }
    const data = await res.json();
    renderHistory(data.history || []);
  } catch (err) {
    console.error("Failed to load history:", err);
    renderEmpty(historyList, "Failed to load history. Check console/server logs.");
  }
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
    });
    views.forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    document.getElementById(btn.dataset.view).classList.add("active");
    if (btn.dataset.view === "history-view") {
      loadHistory();
    }
  });
});

logoutBtn.addEventListener("click", async () => {
  try {
    await authFetch(`${window.API_BASE_URL}/api/auth/logout`, { method: "POST" });
  } catch (err) {
    console.error("Logout request failed:", err);
  } finally {
    redirectToLogin();
  }
});

if (!getToken()) {
  redirectToLogin();
} else {
  loadKeys();
}
