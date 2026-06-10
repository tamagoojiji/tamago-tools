/**
 * かんたん在庫管理 — localStorage のみで完結（バックエンド・APIキーなし）
 * 描画は createElement / textContent のみ（innerHTML 不使用＝XSS安全）
 */
var InventoryApp = (function () {
  "use strict";

  var STORAGE_KEY = "tamago_inventory_v1";
  var state = { items: [], editingId: null };

  // === DOMヘルパー（textContentのみ使用） ===
  function el(tag, opts, kids) {
    var e = document.createElement(tag);
    opts = opts || {};
    Object.keys(opts).forEach(function (k) {
      if (k === "class") e.className = opts[k];
      else if (k === "text") e.textContent = opts[k];
      else if (k === "style") e.setAttribute("style", opts[k]);
      else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2), opts[k]);
      else e.setAttribute(k, opts[k]);
    });
    (kids || []).forEach(function (c) {
      if (c == null) return;
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return e;
  }

  function load() {
    try {
      state.items = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
      state.items = [];
    }
  }
  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
  }
  function isLow(it) {
    return Number(it.qty) <= Number(it.min || 0);
  }

  function start() {
    FormUtils.showScreen("main-screen");
    switchTab("list");
    render();
  }

  function switchTab(name) {
    document.getElementById("tab-list").classList.toggle("active", name === "list");
    document.getElementById("tab-settings").classList.toggle("active", name === "settings");
    document.getElementById("tab-btn-list").classList.toggle("active", name === "list");
    document.getElementById("tab-btn-settings").classList.toggle("active", name === "settings");
  }

  function setStat(id, n) {
    var node = document.getElementById(id);
    node.replaceChildren(document.createTextNode(String(n)), el("span", { class: "stat-unit", text: "件" }));
  }

  function emptyState(icon, text) {
    return el("div", { class: "empty-state" }, [
      el("div", { class: "empty-state-icon", text: icon }),
      el("div", { class: "empty-state-text", text: text })
    ]);
  }

  function card(it) {
    var low = isLow(it);
    var unit = it.unit || "";
    var sub = (it.category ? it.category + " ・ " : "") + "最低 " + Number(it.min || 0) + unit;

    var body = el("div", { class: "data-card-body", style: "cursor:pointer", onclick: function () { openEdit(it.id); } }, [
      el("div", { class: "data-card-title", text: it.name }),
      el("div", { class: "data-card-sub", text: sub }),
      el("span", { class: "stock-badge " + (low ? "stock-warn" : "stock-ok"), text: low ? "要発注" : "在庫OK" })
    ]);

    var stepper = el("div", { class: "data-card-right" }, [
      el("div", { class: "qty-stepper" }, [
        el("button", { class: "qty-btn", onclick: function () { adjustQty(it.id, -1); } }, ["−"]),
        el("span", { class: "qty-num", text: String(Number(it.qty)) }),
        el("button", { class: "qty-btn", onclick: function () { adjustQty(it.id, 1); } }, ["＋"])
      ])
    ]);

    return el("div", { class: "data-card" + (low ? " need-order" : "") }, [
      el("div", { class: "data-card-icon", style: "background:" + (low ? "#FFEBEE" : "#FFF3E0") }, [low ? "🔔" : "📦"]),
      body,
      stepper
    ]);
  }

  function render() {
    var q = (document.getElementById("search-input").value || "").trim().toLowerCase();
    var list = state.items.filter(function (it) {
      if (!q) return true;
      return (it.name + " " + (it.category || "")).toLowerCase().indexOf(q) !== -1;
    });
    list.sort(function (a, b) {
      var la = isLow(a), lb = isLow(b);
      if (la !== lb) return la ? -1 : 1;
      return a.name.localeCompare(b.name, "ja");
    });

    setStat("stat-total", state.items.length);
    setStat("stat-warn", state.items.filter(isLow).length);

    var box = document.getElementById("inventory-list");
    box.replaceChildren();
    if (list.length === 0) {
      box.appendChild(state.items.length === 0
        ? emptyState("📦", "まだ品目がありません。「＋ 品目を追加」から登録しましょう。")
        : emptyState("🔍", "該当する品目がありません"));
      return;
    }
    list.forEach(function (it) { box.appendChild(card(it)); });
  }

  function adjustQty(id, delta) {
    var it = state.items.find(function (x) { return x.id === id; });
    if (!it) return;
    it.qty = Math.max(0, Number(it.qty) + delta);
    persist();
    render();
  }

  function openEdit(id) {
    state.editingId = id || null;
    var it = id ? state.items.find(function (x) { return x.id === id; }) : null;
    document.getElementById("edit-title").textContent = it ? "品目を編集" : "品目を追加";
    document.getElementById("f-name").value = it ? it.name : "";
    document.getElementById("f-category").value = it ? (it.category || "") : "";
    document.getElementById("f-qty").value = it ? it.qty : "";
    document.getElementById("f-unit").value = it ? (it.unit || "") : "";
    document.getElementById("f-min").value = it ? (it.min || 0) : "";
    document.getElementById("btn-delete").style.display = it ? "block" : "none";
    FormUtils.showScreen("edit-screen");
  }

  function save() {
    var name = document.getElementById("f-name").value.trim();
    if (!name) { FormUtils.showToast("品名を入力してください"); return; }
    var data = {
      name: name,
      category: document.getElementById("f-category").value.trim(),
      qty: Math.max(0, Number(document.getElementById("f-qty").value) || 0),
      unit: document.getElementById("f-unit").value.trim(),
      min: Math.max(0, Number(document.getElementById("f-min").value) || 0)
    };
    if (state.editingId) {
      var it = state.items.find(function (x) { return x.id === state.editingId; });
      if (it) { it.name = data.name; it.category = data.category; it.qty = data.qty; it.unit = data.unit; it.min = data.min; }
    } else {
      data.id = FormUtils.generateId();
      state.items.push(data);
    }
    persist();
    FormUtils.showToast("保存しました");
    backToList();
  }

  function removeCurrent() {
    if (!state.editingId) return;
    if (!confirm("この品目を削除しますか？")) return;
    state.items = state.items.filter(function (x) { return x.id !== state.editingId; });
    persist();
    FormUtils.showToast("削除しました");
    backToList();
  }

  function backToList() {
    state.editingId = null;
    FormUtils.showScreen("main-screen");
    switchTab("list");
    render();
  }

  function clearAll() {
    if (!confirm("登録した在庫データをすべて削除しますか？この操作は取り消せません。")) return;
    state.items = [];
    persist();
    FormUtils.showToast("削除しました");
    switchTab("list");
    render();
  }

  load();

  return {
    start: start,
    switchTab: switchTab,
    render: render,
    adjustQty: adjustQty,
    openEdit: openEdit,
    save: save,
    removeCurrent: removeCurrent,
    backToList: backToList,
    clearAll: clearAll
  };
})();
