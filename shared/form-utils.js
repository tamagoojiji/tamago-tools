/**
 * フォーム系アプリ共通ユーティリティ
 * 画面遷移、トースト、日付/金額フォーマット、GASヘルパー、バリデーション
 */
var FormUtils = (function () {
  "use strict";

  // === 画面遷移 ===
  function showScreen(id) {
    var screens = document.querySelectorAll("[data-screen]");
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.add("hidden");
    }
    var target = document.getElementById(id);
    if (target) {
      target.classList.remove("hidden");
      target.classList.add("fade-in");
      window.scrollTo(0, 0);
    }
  }

  // === トースト表示 ===
  function showToast(message) {
    var existing = document.querySelector(".toast");
    if (existing) existing.remove();

    var toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(function () {
      toast.classList.add("show");
    });

    setTimeout(function () {
      toast.classList.remove("show");
      setTimeout(function () { toast.remove(); }, 300);
    }, 2000);
  }

  // === 日付フォーマット ===
  function formatDate(dateStr) {
    var d = new Date(dateStr);
    var m = d.getMonth() + 1;
    var day = d.getDate();
    var weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    return m + "/" + day + "(" + weekdays[d.getDay()] + ")";
  }

  function formatDateFull(dateStr) {
    var d = new Date(dateStr);
    return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
  }

  // === 金額フォーマット ===
  function formatMoney(amount) {
    return Number(amount).toLocaleString();
  }

  // === GASヘルパー ===
  // 楽観的更新（fire-and-forget、レスポンス読み取り不可）
  function gasPost(url, data) {
    return fetch(url, {
      method: "POST",
      mode: "no-cors",
      body: JSON.stringify(data)
    });
  }

  function gasGet(url, params) {
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");
    return fetch(url + "?" + qs).then(function (r) { return r.json(); });
  }

  // === バリデーション ===
  function validateRequired(fields) {
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (!f.value || !f.value.trim()) {
        f.classList.add("input-error");
        f.focus();
        showToast("入力してください");
        return false;
      }
      f.classList.remove("input-error");
    }
    return true;
  }

  // === LINE ユーザーID取得 ===
  function getUserId() {
    try {
      var profile = sessionStorage.getItem("tamago_liff_profile");
      if (profile) {
        var p = JSON.parse(profile);
        if (p.userId) return p.userId;
      }
    } catch (e) {}
    // フォールバック: ブラウザID
    var bid = localStorage.getItem("tamago_browser_id");
    if (!bid) {
      bid = "browser_" + Math.random().toString(36).substr(2, 9);
      localStorage.setItem("tamago_browser_id", bid);
    }
    return bid;
  }

  // === ランダムID生成 ===
  function generateId() {
    return Math.random().toString(36).substr(2, 8);
  }

  return {
    showScreen: showScreen,
    showToast: showToast,
    formatDate: formatDate,
    formatDateFull: formatDateFull,
    formatMoney: formatMoney,
    gasPost: gasPost,
    gasGet: gasGet,
    validateRequired: validateRequired,
    getUserId: getUserId,
    generateId: generateId
  };
})();
