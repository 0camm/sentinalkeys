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

async function copyKey(id) {
  const entry = keysById.get(id);
  if (!entry) return;
  try {
    await navigator.clipboard.writeText(entry.key);
    const res = await fetch(`${window.API_BASE_URL}/api/keys/${encodeURIComponent(id)}/copy`, {
      method: "POST",
      credentials: "include"
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
  window.location.href = "/login.html";
}

async function loadKeys() {
  try {
    const res = await fetch(`${window.API_BASE_URL}/api/keys`, { credentials: "include" });
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
    const res = await fetch(`${window.API_BASE_URL}/api/history`, { credentials: "include" });
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
    await fetch(`${window.API_BASE_URL}/api/auth/logout`, { method: "POST", credentials: "include" });
  } catch (err) {
    console.error("Logout request failed:", err);
  } finally {
    redirectToLogin();
  }
});

loadKeys();
