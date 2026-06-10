/**
 * かんたん顧客管理（CRM） — localStorage のみで完結（バックエンド・APIキーなし）
 * 描画は createElement / textContent のみ（innerHTML 不使用＝XSS安全）
 */
var CrmApp = (function () {
  "use strict";

  var STORAGE_KEY = "tamago_crm_v1";
  var THRESHOLD_KEY = "tamago_crm_threshold_v1";
  var state = { customers: [], editingId: null, threshold: 30 };

  // === DOMヘルパー ===
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

  // === 日付 ===
  function todayStr() {
    var d = new Date();
    var m = ("0" + (d.getMonth() + 1)).slice(-2);
    var day = ("0" + d.getDate()).slice(-2);
    return d.getFullYear() + "-" + m + "-" + day;
  }
  function daysSince(dateStr) {
    if (!dateStr) return Infinity;
    var then = new Date(dateStr + "T00:00:00");
    if (isNaN(then.getTime())) return Infinity;
    var now = new Date(todayStr() + "T00:00:00");
    return Math.floor((now - then) / 86400000);
  }
  function isDue(c) {
    return daysSince(c.lastContact) >= state.threshold;
  }

  function load() {
    try {
      state.customers = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
      state.customers = [];
    }
    var t = parseInt(localStorage.getItem(THRESHOLD_KEY), 10);
    state.threshold = (t && t > 0) ? t : 30;
  }
  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.customers));
  }

  function start() {
    FormUtils.showScreen("main-screen");
    document.getElementById("f-threshold").value = state.threshold;
    switchTab("list");
    render();
  }

  function switchTab(name) {
    document.getElementById("tab-list").classList.toggle("active", name === "list");
    document.getElementById("tab-settings").classList.toggle("active", name === "settings");
    document.getElementById("tab-btn-list").classList.toggle("active", name === "list");
    document.getElementById("tab-btn-settings").classList.toggle("active", name === "settings");
  }

  function setStat(id, n, unit) {
    var node = document.getElementById(id);
    node.replaceChildren(document.createTextNode(String(n)), el("span", { class: "stat-unit", text: unit }));
  }

  function emptyState(icon, text) {
    return el("div", { class: "empty-state" }, [
      el("div", { class: "empty-state-icon", text: icon }),
      el("div", { class: "empty-state-text", text: text })
    ]);
  }

  function card(c) {
    var due = isDue(c);
    var tags = (c.tags || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var subParts = [];
    if (c.contact) subParts.push((c.contactType || "") + " " + c.contact);
    var lastLabel = c.lastContact ? ("最終連絡 " + c.lastContact) : "連絡記録なし";

    var bodyKids = [
      el("div", { class: "data-card-title", text: c.name }),
      el("div", { class: "data-card-sub", text: subParts.join(" ・ ") || "連絡先未登録" })
    ];
    if (tags.length) {
      var tagWrap = el("div", {}, tags.map(function (t) { return el("span", { class: "tag-chip", text: t }); }));
      bodyKids.push(tagWrap);
    }
    if (c.memo) bodyKids.push(el("div", { class: "data-card-sub", style: "margin-top:3px", text: "📝 " + c.memo }));
    bodyKids.push(el("span", { class: "follow-badge " + (due ? "follow-due" : "follow-ok"), text: due ? "そろそろ連絡" : "フォロー済" }));
    bodyKids.push(el("div", { class: "data-card-sub", style: "margin-top:3px", text: lastLabel }));

    var body = el("div", { class: "data-card-body", style: "cursor:pointer", onclick: function () { openEdit(c.id); } }, bodyKids);

    var right = el("div", { class: "data-card-right" }, [
      el("button", { class: "contact-btn", onclick: function () { markContacted(c.id); } }, ["連絡した"])
    ]);

    return el("div", { class: "data-card" + (due ? " follow-now" : "") }, [
      el("div", { class: "data-card-icon", style: "background:" + (due ? "#FFEBEE" : "#FFF3E0") }, [due ? "🔔" : "🙂"]),
      body,
      right
    ]);
  }

  function render() {
    var q = (document.getElementById("search-input").value || "").trim().toLowerCase();
    var list = state.customers.filter(function (c) {
      if (!q) return true;
      return (c.name + " " + (c.contact || "") + " " + (c.tags || "")).toLowerCase().indexOf(q) !== -1;
    });
    list.sort(function (a, b) {
      var da = isDue(a), db = isDue(b);
      if (da !== db) return da ? -1 : 1;
      return a.name.localeCompare(b.name, "ja");
    });

    setStat("stat-total", state.customers.length, "人");
    setStat("stat-follow", state.customers.filter(isDue).length, "人");

    var box = document.getElementById("crm-list");
    box.replaceChildren();
    if (list.length === 0) {
      box.appendChild(state.customers.length === 0
        ? emptyState("🧑‍🤝‍🧑", "まだ顧客がいません。「＋ 顧客を追加」から登録しましょう。")
        : emptyState("🔍", "該当する顧客がいません"));
      return;
    }
    list.forEach(function (c) { box.appendChild(card(c)); });
  }

  function markContacted(id) {
    var c = state.customers.find(function (x) { return x.id === id; });
    if (!c) return;
    c.lastContact = todayStr();
    persist();
    FormUtils.showToast("本日を最終連絡日にしました");
    render();
  }

  function openEdit(id) {
    state.editingId = id || null;
    var c = id ? state.customers.find(function (x) { return x.id === id; }) : null;
    document.getElementById("edit-title").textContent = c ? "顧客を編集" : "顧客を追加";
    document.getElementById("f-name").value = c ? c.name : "";
    document.getElementById("f-contact-type").value = c ? (c.contactType || "電話") : "電話";
    document.getElementById("f-contact").value = c ? (c.contact || "") : "";
    document.getElementById("f-tags").value = c ? (c.tags || "") : "";
    document.getElementById("f-last").value = c ? (c.lastContact || "") : todayStr();
    document.getElementById("f-memo").value = c ? (c.memo || "") : "";
    document.getElementById("btn-delete").style.display = c ? "block" : "none";
    FormUtils.showScreen("edit-screen");
  }

  function save() {
    var name = document.getElementById("f-name").value.trim();
    if (!name) { FormUtils.showToast("名前を入力してください"); return; }
    var data = {
      name: name,
      contactType: document.getElementById("f-contact-type").value,
      contact: document.getElementById("f-contact").value.trim(),
      tags: document.getElementById("f-tags").value.trim(),
      lastContact: document.getElementById("f-last").value,
      memo: document.getElementById("f-memo").value.trim()
    };
    if (state.editingId) {
      var c = state.customers.find(function (x) { return x.id === state.editingId; });
      if (c) { c.name = data.name; c.contactType = data.contactType; c.contact = data.contact; c.tags = data.tags; c.lastContact = data.lastContact; c.memo = data.memo; }
    } else {
      data.id = FormUtils.generateId();
      state.customers.push(data);
    }
    persist();
    FormUtils.showToast("保存しました");
    backToList();
  }

  function removeCurrent() {
    if (!state.editingId) return;
    if (!confirm("この顧客を削除しますか？")) return;
    state.customers = state.customers.filter(function (x) { return x.id !== state.editingId; });
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

  function saveThreshold() {
    var t = parseInt(document.getElementById("f-threshold").value, 10);
    if (!t || t < 1) { FormUtils.showToast("1以上の日数を入力してください"); return; }
    state.threshold = t;
    localStorage.setItem(THRESHOLD_KEY, String(t));
    FormUtils.showToast("フォロー間隔を保存しました");
    render();
  }

  function clearAll() {
    if (!confirm("登録した顧客データをすべて削除しますか？この操作は取り消せません。")) return;
    state.customers = [];
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
    markContacted: markContacted,
    openEdit: openEdit,
    save: save,
    removeCurrent: removeCurrent,
    backToList: backToList,
    saveThreshold: saveThreshold,
    clearAll: clearAll
  };
})();
