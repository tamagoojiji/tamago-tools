/**
 * レシート経費記録アプリ
 * ReceiptApp モジュール
 */
var ReceiptApp = (function () {
  "use strict";

  // === 設定 ===
  var GAS_URL = "https://script.google.com/macros/s/AKfycbwvemxonI88X44s0mgJ-mkLCHDvXnhqieExvsv026ZKaQU_462bePBPQqucu1mPslhFPA/exec";

  var currentReceipt = null;
  var userId = null;

  // 勘定科目別アイコン・色
  var CATEGORY_MAP = {
    "仕入高":     { icon: "📦", color: "#EFEBE9" },
    "租税公課":   { icon: "🏛", color: "#F5F5F5" },
    "水道光熱費": { icon: "💡", color: "#FFFDE7" },
    "旅費交通費": { icon: "🚃", color: "#E3F2FD" },
    "通信費":     { icon: "📱", color: "#F3E5F5" },
    "広告宣伝費": { icon: "📢", color: "#FFF3E0" },
    "接待交際費": { icon: "🍻", color: "#FCE4EC" },
    "損害保険料": { icon: "🛡", color: "#E8EAF6" },
    "修繕費":     { icon: "🔧", color: "#E0F2F1" },
    "消耗品費":   { icon: "🧴", color: "#FFF8E1" },
    "福利厚生費": { icon: "🏥", color: "#E0F7FA" },
    "外注工賃":   { icon: "🤝", color: "#F1F8E9" },
    "地代家賃":   { icon: "🏠", color: "#EDE7F6" },
    "新聞図書費": { icon: "📚", color: "#E8F5E9" },
    "会議費":     { icon: "☕", color: "#FBE9E7" },
    "車両費":     { icon: "🚗", color: "#E3F2FD" },
    "雑費":       { icon: "📋", color: "#F5F5F5" }
  };

  // 月次ナビ用
  var currentMonth = null;

  // === GAS POSTヘルパー（リダイレクト対応） ===
  function gasPostJson(data) {
    return fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(data)
    })
    .then(function (r) {
      return r.text();
    })
    .then(function (text) {
      try {
        return JSON.parse(text);
      } catch (e) {
        return { ok: false, error: "レスポンス解析エラー" };
      }
    });
  }

  // === 初期化 ===
  function start() {
    userId = FormUtils.getUserId();
    FormUtils.showScreen("main-screen");
    checkRemaining();
  }

  // === タブ切替 ===
  function switchTab(tabName) {
    var tabs = document.querySelectorAll(".tab-content");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.remove("active");
    }
    document.getElementById("tab-" + tabName).classList.add("active");

    var btns = document.querySelectorAll(".tab-btn");
    for (var j = 0; j < btns.length; j++) {
      btns[j].classList.remove("active");
    }
    btns[["scan", "history", "monthly", "settings"].indexOf(tabName)].classList.add("active");

    // タブ遷移時にデータ読み込み
    if (tabName === "history") loadHistory();
    if (tabName === "monthly") loadMonthly();
    if (tabName === "scan") checkRemaining();
  }

  // === 残り回数チェック ===
  function checkRemaining() {
    if (!GAS_URL) return;
    FormUtils.gasGet(GAS_URL, { action: "check", userId: userId })
      .then(function (res) {
        var container = document.getElementById("remaining-container");
        if (!res.ok) {
          container.innerHTML = "";
          return;
        }
        if (!res.canScan) {
          container.innerHTML = '<div class="remaining-badge danger">' + res.reason + '</div>';
          return;
        }
        var cls = "remaining-badge";
        if (res.remaining <= 1) cls += " danger";
        else if (res.remaining <= 2) cls += " warn";
        container.innerHTML = '<div class="' + cls + '">残り ' + res.remaining + ' 回</div>';
      })
      .catch(function () { /* silent */ });
  }

  // === カメラ起動 ===
  function openCamera() {
    document.getElementById("camera-input").click();
  }

  // === 画像選択ハンドラ ===
  function handleImageSelect(e) {
    var file = e.target.files[0];
    if (!file) return;

    compressImage(file, function (base64, mimeType) {
      // スピナー表示
      document.getElementById("spinner").classList.remove("hidden");

      if (!GAS_URL) {
        // GAS URL未設定時のデモ
        document.getElementById("spinner").classList.add("hidden");
        FormUtils.showToast("GAS URLが未設定です");
        return;
      }

      // OCR リクエスト
      gasPostJson({
        action: "scan",
        userId: userId,
        imageBase64: base64,
        mimeType: mimeType
      })
      .then(function (res) {
        document.getElementById("spinner").classList.add("hidden");
        if (res.ok) {
          showOcrResult(res.receipt);
        } else {
          FormUtils.showToast(res.error || "読み取りに失敗しました");
        }
      })
      .catch(function (err) {
        document.getElementById("spinner").classList.add("hidden");
        FormUtils.showToast("スキャンエラー: " + (err.message || err));
        console.error("scan error:", err);
      });

      // input をリセット
      e.target.value = "";
    });
  }

  // === 画像圧縮 ===
  function compressImage(file, callback) {
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement("canvas");
        var maxWidth = 1200;
        var scale = Math.min(1, maxWidth / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;

        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        var dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        var base64 = dataUrl.split(",")[1];
        callback(base64, "image/jpeg");
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  // === OCR結果を表示 ===
  function showOcrResult(receipt) {
    currentReceipt = receipt;

    document.getElementById("receipt-date").value = receipt.date || "";
    document.getElementById("receipt-store").value = receipt.store || "";
    document.getElementById("receipt-category").value = receipt.category || "その他";
    document.getElementById("receipt-total").value = receipt.total || "";
    document.getElementById("receipt-memo").value = "";

    // 品目リスト
    var listEl = document.getElementById("items-list");
    listEl.innerHTML = "";

    var items = receipt.items || [];
    if (items.length === 0) {
      addItemRow();
    } else {
      for (var i = 0; i < items.length; i++) {
        addItemRow(items[i].name, items[i].price, items[i].quantity);
      }
    }

    FormUtils.showScreen("result-screen");
  }

  // === 品目行追加 ===
  function addItemRow(name, price, qty) {
    var listEl = document.getElementById("items-list");
    var row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML =
      '<input type="text" class="form-input item-name" placeholder="品名" value="' + escapeHtml(name || "") + '">' +
      '<input type="number" class="form-input item-price" placeholder="金額" value="' + (price || "") + '">' +
      '<input type="number" class="form-input item-qty" placeholder="数" value="' + (qty || 1) + '">' +
      '<button class="item-delete" onclick="this.parentElement.remove()">&times;</button>';
    listEl.appendChild(row);
  }

  // === HTMLエスケープ ===
  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // === レシート保存 ===
  function saveReceipt() {
    var date = document.getElementById("receipt-date").value;
    var store = document.getElementById("receipt-store").value;
    var category = document.getElementById("receipt-category").value;
    var total = document.getElementById("receipt-total").value;
    var memo = document.getElementById("receipt-memo").value;

    if (!date) {
      FormUtils.showToast("日付を入力してください");
      return;
    }

    // 品目収集
    var rows = document.querySelectorAll("#items-list .item-row");
    var items = [];
    for (var i = 0; i < rows.length; i++) {
      var name = rows[i].querySelector(".item-name").value.trim();
      var price = Number(rows[i].querySelector(".item-price").value) || 0;
      var qty = Number(rows[i].querySelector(".item-qty").value) || 1;
      if (name) {
        items.push({ name: name, price: price, quantity: qty });
      }
    }

    if (!GAS_URL) {
      FormUtils.showToast("GAS URLが未設定です");
      return;
    }

    document.getElementById("spinner").classList.remove("hidden");
    document.querySelector("#spinner .spinner-text").textContent = "保存しています...";

    gasPostJson({
      action: "save",
      userId: userId,
      receipt: {
        date: date,
        store: store,
        category: category,
        total: Number(total) || 0,
        items: items,
        memo: memo
      }
    })
    .then(function (res) {
      document.getElementById("spinner").classList.add("hidden");
      document.querySelector("#spinner .spinner-text").textContent = "レシートを読み取っています...";
      if (res.ok) {
        FormUtils.showToast("保存しました");
        FormUtils.showScreen("main-screen");
        switchTab("history");
      } else {
        FormUtils.showToast(res.error || "保存に失敗しました");
      }
    })
    .catch(function (err) {
      document.getElementById("spinner").classList.add("hidden");
      document.querySelector("#spinner .spinner-text").textContent = "レシートを読み取っています...";
      FormUtils.showToast("保存エラー: " + (err.message || err));
      console.error("save error:", err);
    });
  }

  // === スキャンに戻る ===
  function backToScan() {
    currentReceipt = null;
    FormUtils.showScreen("main-screen");
    switchTab("scan");
  }

  // === 履歴読み込み ===
  function loadHistory() {
    var listEl = document.getElementById("history-list");
    if (!GAS_URL) {
      listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">GAS URLが未設定です</div></div>';
      return;
    }

    listEl.innerHTML = '<div class="empty-state"><div class="spinner" style="margin:0 auto 8px;width:32px;height:32px;border-width:3px"></div><div class="empty-state-text">読み込み中...</div></div>';

    FormUtils.gasGet(GAS_URL, { action: "list", userId: userId })
      .then(function (res) {
        if (!res.ok || !res.receipts || res.receipts.length === 0) {
          listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">まだレシートがありません</div></div>';
          return;
        }

        // 日付でグループ化
        var groups = {};
        for (var i = 0; i < res.receipts.length; i++) {
          var r = res.receipts[i];
          var d = r.date || "不明";
          if (!groups[d]) groups[d] = [];
          groups[d].push(r);
        }

        var html = "";
        var dates = Object.keys(groups).sort().reverse();
        for (var di = 0; di < dates.length; di++) {
          var date = dates[di];
          html += '<div class="date-group-title">' + FormUtils.formatDate(date) + '</div>';
          var items = groups[date];
          for (var j = 0; j < items.length; j++) {
            var receipt = items[j];
            var cat = CATEGORY_MAP[receipt.category] || CATEGORY_MAP["その他"];
            html += '<div class="data-card">'
              + '<div class="category-icon" style="background:' + cat.color + '">' + cat.icon + '</div>'
              + '<div class="data-card-body">'
              + '<div class="data-card-title">' + escapeHtml(receipt.store || "不明") + '</div>'
              + '<div class="data-card-sub">' + escapeHtml(receipt.category || "") + '</div>'
              + '</div>'
              + '<div class="data-card-right">'
              + '<div class="data-card-amount">&yen;' + FormUtils.formatMoney(receipt.total) + '</div>'
              + '</div>'
              + '<button class="data-card-delete" onclick="ReceiptApp.deleteReceipt(\'' + receipt.id + '\')">&times;</button>'
              + '</div>';
          }
        }

        listEl.innerHTML = html;
      })
      .catch(function () {
        listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-text">読み込みに失敗しました</div></div>';
      });
  }

  // === レシート削除 ===
  function deleteReceipt(receiptId) {
    if (!confirm("このレシートを削除しますか？")) return;
    if (!GAS_URL) return;

    gasPostJson({
      action: "delete",
      userId: userId,
      receiptId: receiptId
    })
    .then(function (res) {
      if (res.ok) {
        FormUtils.showToast("削除しました");
        loadHistory();
      } else {
        FormUtils.showToast(res.error || "削除に失敗しました");
      }
    })
    .catch(function (err) {
      FormUtils.showToast("削除エラー: " + (err.message || err));
      console.error("delete error:", err);
    });
  }

  // === 月次集計 ===
  function loadMonthly() {
    if (!currentMonth) {
      var now = new Date();
      currentMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    }
    renderMonthSelector();
    fetchMonthlySummary();
  }

  function renderMonthSelector() {
    var parts = currentMonth.split("-");
    var label = parts[0] + "年" + Number(parts[1]) + "月";
    document.getElementById("monthly-selector").innerHTML =
      '<button class="month-nav" onclick="ReceiptApp.prevMonth()">◀</button>'
      + '<span class="month-label">' + label + '</span>'
      + '<button class="month-nav" onclick="ReceiptApp.nextMonth()">▶</button>';
  }

  function prevMonth() {
    var parts = currentMonth.split("-");
    var y = Number(parts[0]);
    var m = Number(parts[1]) - 1;
    if (m < 1) { m = 12; y--; }
    currentMonth = y + "-" + String(m).padStart(2, "0");
    loadMonthly();
  }

  function nextMonth() {
    var parts = currentMonth.split("-");
    var y = Number(parts[0]);
    var m = Number(parts[1]) + 1;
    if (m > 12) { m = 1; y++; }
    currentMonth = y + "-" + String(m).padStart(2, "0");
    loadMonthly();
  }

  function fetchMonthlySummary() {
    var statsEl = document.getElementById("monthly-stats");
    var chartEl = document.getElementById("monthly-chart");

    if (!GAS_URL) {
      statsEl.innerHTML = '<div class="empty-state"><div class="empty-state-text">GAS URLが未設定です</div></div>';
      chartEl.innerHTML = "";
      return;
    }

    statsEl.innerHTML = '<div class="empty-state"><div class="spinner" style="margin:0 auto 8px;width:32px;height:32px;border-width:3px"></div></div>';
    chartEl.innerHTML = "";

    FormUtils.gasGet(GAS_URL, { action: "summary", userId: userId, month: currentMonth })
      .then(function (res) {
        if (!res.ok) {
          statsEl.innerHTML = '<div class="empty-state"><div class="empty-state-text">データなし</div></div>';
          return;
        }

        // 統計カード
        statsEl.innerHTML =
          '<div class="stat-row">'
          + '<div class="stat-card"><div class="stat-label">合計</div><div class="stat-value">&yen;' + FormUtils.formatMoney(res.grandTotal) + '</div></div>'
          + '<div class="stat-card"><div class="stat-label">件数</div><div class="stat-value">' + res.count + '<span class="stat-unit">件</span></div></div>'
          + '</div>';

        // カテゴリ別棒グラフ
        if (!res.categories || res.categories.length === 0) {
          chartEl.innerHTML = '<div class="empty-state"><div class="empty-state-text">この月のデータはありません</div></div>';
          return;
        }

        var maxAmount = res.categories[0].total;
        var html = '<div class="bar-chart">';
        for (var i = 0; i < res.categories.length; i++) {
          var cat = res.categories[i];
          var pct = maxAmount > 0 ? Math.round((cat.total / maxAmount) * 100) : 0;
          var catInfo = CATEGORY_MAP[cat.category] || CATEGORY_MAP["その他"];
          html += '<div class="bar-row">'
            + '<div class="bar-label">' + catInfo.icon + '</div>'
            + '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>'
            + '<div class="bar-value">&yen;' + FormUtils.formatMoney(cat.total) + '</div>'
            + '</div>';
        }
        html += '</div>';
        chartEl.innerHTML = html;
      })
      .catch(function () {
        statsEl.innerHTML = '<div class="empty-state"><div class="empty-state-text">読み込みに失敗しました</div></div>';
      });
  }

  // === ローカルIDリセット ===
  function resetLocalId() {
    if (!confirm("ローカルIDをリセットしますか？\n新しいIDが生成され、以前のデータは表示されなくなります。")) return;
    localStorage.removeItem("tamago_browser_id");
    userId = FormUtils.getUserId();
    FormUtils.showToast("IDをリセットしました");
  }

  // === イベント登録 ===
  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("camera-input").addEventListener("change", handleImageSelect);
  });

  return {
    start: start,
    switchTab: switchTab,
    openCamera: openCamera,
    addItemRow: addItemRow,
    saveReceipt: saveReceipt,
    backToScan: backToScan,
    deleteReceipt: deleteReceipt,
    prevMonth: prevMonth,
    nextMonth: nextMonth,
    resetLocalId: resetLocalId
  };
})();
