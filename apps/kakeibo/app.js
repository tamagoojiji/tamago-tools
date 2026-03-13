/**
 * かんたん家計簿 メインアプリ
 * IndexedDB ローカル保存 + GAS OCR連携
 */
var KakeiboApp = (function () {
  "use strict";

  var GAS_URL = "https://script.google.com/macros/s/AKfycbwvemxonI88X44s0mgJ-mkLCHDvXnhqieExvsv026ZKaQU_462bePBPQqucu1mPslhFPA/exec";
  var userId = null;
  var currentTab = "input";
  var currentMonth = null; // "YYYY-MM"
  var editingId = null; // 編集中のtransaction ID
  var ocrQueue = []; // ライブラリ複数選択時のキュー

  var CATEGORIES = [
    "食費", "日用品", "交通費", "住居費", "水道光熱費", "通信費",
    "保険", "医療費", "教育費", "趣味・娯楽", "衣服・美容", "交際費",
    "子ども", "ペット", "車両費", "その他"
  ];

  var CATEGORY_ICONS = {
    "食費": "🍽", "日用品": "🧴", "交通費": "🚃", "住居費": "🏠",
    "水道光熱費": "💡", "通信費": "📱", "保険": "🛡", "医療費": "🏥",
    "教育費": "📚", "趣味・娯楽": "🎮", "衣服・美容": "👕", "交際費": "🍻",
    "子ども": "👶", "ペット": "🐶", "車両費": "🚗", "その他": "📦"
  };

  // === 初期化 ===
  function init() {
    userId = FormUtils.getUserId();
    var now = new Date();
    currentMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");

    KakeiboDB.open().then(function () {
      setupTabs();
      setupInputForm();
      setupCamera();
      loadTodayTotal();
      loadHistory();
    });
  }

  // === タブ切替 ===
  function setupTabs() {
    var btns = document.querySelectorAll(".tab-btn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function () {
        switchTab(this.dataset.tab);
      });
    }
  }

  function switchTab(tab) {
    currentTab = tab;
    var btns = document.querySelectorAll(".tab-btn");
    var contents = document.querySelectorAll(".tab-content");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("active", btns[i].dataset.tab === tab);
    }
    for (var j = 0; j < contents.length; j++) {
      contents[j].classList.toggle("active", contents[j].id === "tab-" + tab);
    }

    if (tab === "history") loadHistory();
    if (tab === "report") loadReport();
    if (tab === "settings") loadSettings();
    if (tab === "input") loadTodayTotal();
  }

  // === 入力タブ ===
  function setupInputForm() {
    // カテゴリ選択肢を生成
    var sel = document.getElementById("input-category");
    CATEGORIES.forEach(function (cat) {
      var opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = (CATEGORY_ICONS[cat] || "") + " " + cat;
      sel.appendChild(opt);
    });

    // 日付デフォルト: 今日
    document.getElementById("input-date").value = todayStr();

    // 手入力保存ボタン
    document.getElementById("btn-save-manual").addEventListener("click", saveManualInput);
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function saveManualInput() {
    var date = document.getElementById("input-date").value;
    var amount = parseInt(document.getElementById("input-amount").value, 10);
    var category = document.getElementById("input-category").value;
    var memo = document.getElementById("input-memo").value.trim();

    if (!date || !amount || amount <= 0) {
      FormUtils.showToast("日付と金額を入力してください");
      return;
    }

    var tx = {
      id: FormUtils.generateId() + "_" + Date.now(),
      date: date,
      store: "",
      items: [],
      total: amount,
      category: category,
      memo: memo,
      inputType: "manual",
      createdAt: new Date().toISOString()
    };

    KakeiboDB.addTransaction(tx).then(function () {
      FormUtils.showToast("保存しました");
      document.getElementById("input-amount").value = "";
      document.getElementById("input-memo").value = "";
      loadTodayTotal();
    });
  }

  function loadTodayTotal() {
    var today = todayStr();
    KakeiboDB.getAllTransactions().then(function (all) {
      var total = 0;
      var count = 0;
      all.forEach(function (tx) {
        if (tx.date === today) {
          total += tx.total;
          count++;
        }
      });
      document.getElementById("today-total").textContent = total.toLocaleString() + "円";
      document.getElementById("today-count").textContent = count + "件";
    });
  }

  // === カメラ / OCR ===
  function setupCamera() {
    var cameraInput = document.getElementById("camera-input");
    var libraryInput = document.getElementById("library-input");

    document.getElementById("btn-camera").addEventListener("click", function () {
      cameraInput.click();
    });
    cameraInput.addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      e.target.value = "";
      ocrQueue = [];
      processOneFile(file);
    });

    document.getElementById("btn-library").addEventListener("click", function () {
      libraryInput.click();
    });
    libraryInput.addEventListener("change", function (e) {
      var files = Array.from(e.target.files);
      e.target.value = "";
      if (files.length === 0) return;
      if (files.length > 5) {
        FormUtils.showToast("最大5枚まで選択できます");
        files = files.slice(0, 5);
      }
      // 1枚目を即処理、残りをキューに入れる
      ocrQueue = files.slice(1);
      processOneFile(files[0]);
    });
  }

  function processOneFile(file) {
    var queueInfo = ocrQueue.length > 0 ? "（残り" + ocrQueue.length + "枚）" : "";
    showSpinner("レシートを読み取り中..." + queueInfo);
    compressImage(file, function (base64, mimeType) {
      fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          action: "kakeibo_scan",
          userId: userId,
          imageBase64: base64,
          mimeType: mimeType
        })
      })
      .then(function (r) { return r.text(); })
      .then(function (text) {
        hideSpinner();
        try {
          var res = JSON.parse(text);
          if (res.ok && res.receipt) {
            showOcrResult(res.receipt);
          } else {
            FormUtils.showToast(res.error || "読み取りに失敗しました");
            processNextInQueue();
          }
        } catch (err) {
          FormUtils.showToast("レスポンスの解析に失敗しました");
          processNextInQueue();
        }
      })
      .catch(function () {
        hideSpinner();
        FormUtils.showToast("通信エラーが発生しました");
        processNextInQueue();
      });
    });
  }

  function processNextInQueue() {
    if (ocrQueue.length > 0) {
      var next = ocrQueue.shift();
      processOneFile(next);
    }
  }

  function compressImage(file, callback) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement("canvas");
        var maxW = 1200;
        var w = img.width;
        var h = img.height;
        if (w > maxW) {
          h = Math.round(h * maxW / w);
          w = maxW;
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        var base64 = dataUrl.split(",")[1];
        callback(base64, "image/jpeg");
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function showOcrResult(receipt) {
    editingId = null;
    document.getElementById("btn-delete-tx").classList.add("hidden");

    // キュー残数表示
    var queueLabel = document.getElementById("queue-label");
    if (ocrQueue.length > 0) {
      queueLabel.textContent = "残り " + ocrQueue.length + " 枚";
      queueLabel.classList.remove("hidden");
    } else {
      queueLabel.classList.add("hidden");
    }

    document.getElementById("edit-date").value = receipt.date || todayStr();
    document.getElementById("edit-store").value = receipt.store || "";
    document.getElementById("edit-amount").value = receipt.total || "";
    document.getElementById("edit-category").value = receipt.category || "食費";
    document.getElementById("edit-memo").value = "";

    // 品目リスト
    var itemsEl = document.getElementById("edit-items");
    itemsEl.innerHTML = "";
    if (receipt.items && receipt.items.length > 0) {
      receipt.items.forEach(function (item) {
        addItemRow(item.name, item.price, item.quantity);
      });
    }

    FormUtils.showScreen("edit-screen");
  }

  function addItemRow(name, price, qty) {
    var itemsEl = document.getElementById("edit-items");
    var row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML =
      '<input type="text" class="form-input item-name" placeholder="品名" value="' + (name || "") + '" style="flex:3">' +
      '<input type="number" class="form-input item-price" placeholder="金額" value="' + (price || "") + '" style="flex:2">' +
      '<input type="number" class="form-input item-qty" placeholder="数" value="' + (qty || 1) + '" style="flex:1;min-width:50px">' +
      '<button type="button" class="data-card-delete" onclick="this.parentElement.remove();KakeiboApp.recalcTotal()">&times;</button>';

    // 金額変更時に合計再計算
    var priceInput = row.querySelector(".item-price");
    var qtyInput = row.querySelector(".item-qty");
    priceInput.addEventListener("input", recalcTotal);
    qtyInput.addEventListener("input", recalcTotal);

    itemsEl.appendChild(row);
  }

  function recalcTotal() {
    var rows = document.querySelectorAll("#edit-items .item-row");
    var sum = 0;
    rows.forEach(function (row) {
      var p = parseInt(row.querySelector(".item-price").value, 10) || 0;
      var q = parseInt(row.querySelector(".item-qty").value, 10) || 1;
      sum += p * q;
    });
    if (sum > 0) {
      document.getElementById("edit-amount").value = sum;
    }
  }

  function saveEdit() {
    var date = document.getElementById("edit-date").value;
    var amount = parseInt(document.getElementById("edit-amount").value, 10);
    var category = document.getElementById("edit-category").value;

    if (!date || !amount || amount <= 0) {
      FormUtils.showToast("日付と金額を入力してください");
      return;
    }

    // 品目収集
    var items = [];
    document.querySelectorAll("#edit-items .item-row").forEach(function (row) {
      var name = row.querySelector(".item-name").value.trim();
      var price = parseInt(row.querySelector(".item-price").value, 10) || 0;
      var qty = parseInt(row.querySelector(".item-qty").value, 10) || 1;
      if (name || price > 0) {
        items.push({ name: name, price: price, quantity: qty });
      }
    });

    var tx = {
      id: editingId || (FormUtils.generateId() + "_" + Date.now()),
      date: date,
      store: document.getElementById("edit-store").value.trim(),
      items: items,
      total: amount,
      category: category,
      memo: document.getElementById("edit-memo").value.trim(),
      inputType: editingId ? "edited" : "ocr",
      createdAt: new Date().toISOString()
    };

    KakeiboDB.addTransaction(tx).then(function () {
      FormUtils.showToast("保存しました");
      editingId = null;
      loadTodayTotal();
      if (ocrQueue.length > 0) {
        processNextInQueue();
      } else {
        FormUtils.showScreen("main-screen");
      }
    });
  }

  function cancelEdit() {
    editingId = null;
    if (ocrQueue.length > 0) {
      processNextInQueue();
    } else {
      FormUtils.showScreen("main-screen");
    }
  }

  // === 履歴タブ ===
  function loadHistory() {
    updateMonthSelector("history");

    KakeiboDB.getTransactionsByMonth(currentMonth).then(function (txs) {
      var container = document.getElementById("history-list");

      if (txs.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📝</div><div class="empty-state-text">この月のデータはありません</div></div>';
        document.getElementById("history-month-total").textContent = "0円";
        return;
      }

      // 日付降順ソート
      txs.sort(function (a, b) { return b.date > a.date ? 1 : b.date < a.date ? -1 : 0; });

      var total = 0;
      var html = "";
      var lastDate = "";

      txs.forEach(function (tx) {
        total += tx.total;
        if (tx.date !== lastDate) {
          lastDate = tx.date;
          html += '<div class="section-title">' + FormUtils.formatDate(tx.date) + '</div>';
        }
        var icon = CATEGORY_ICONS[tx.category] || "📦";
        var color = KakeiboChart.getColor(tx.category);
        html += '<div class="data-card" data-id="' + tx.id + '" onclick="KakeiboApp.openDetail(\'' + tx.id + '\')">' +
          '<div class="data-card-icon" style="background:' + color + '20">' + icon + '</div>' +
          '<div class="data-card-body">' +
            '<div class="data-card-title">' + escapeHtml(tx.memo || tx.store || tx.category) + '</div>' +
            '<div class="data-card-sub">' + tx.category + '</div>' +
          '</div>' +
          '<div class="data-card-right">' +
            '<div class="data-card-amount">' + tx.total.toLocaleString() + '円</div>' +
          '</div>' +
        '</div>';
      });

      container.innerHTML = html;
      document.getElementById("history-month-total").textContent = total.toLocaleString() + "円";
    });
  }

  function openDetail(id) {
    KakeiboDB.getTransaction(id).then(function (tx) {
      if (!tx) return;
      editingId = tx.id;
      document.getElementById("edit-date").value = tx.date;
      document.getElementById("edit-store").value = tx.store || "";
      document.getElementById("edit-amount").value = tx.total;
      document.getElementById("edit-category").value = tx.category;
      document.getElementById("edit-memo").value = tx.memo || "";

      var itemsEl = document.getElementById("edit-items");
      itemsEl.innerHTML = "";
      if (tx.items && tx.items.length > 0) {
        tx.items.forEach(function (item) {
          addItemRow(item.name, item.price, item.quantity);
        });
      }

      // 削除ボタン表示
      document.getElementById("btn-delete-tx").classList.remove("hidden");
      FormUtils.showScreen("edit-screen");
    });
  }

  function deleteCurrentTx() {
    if (!editingId) return;
    if (!confirm("この記録を削除しますか？")) return;

    KakeiboDB.deleteTransaction(editingId).then(function () {
      FormUtils.showToast("削除しました");
      editingId = null;
      FormUtils.showScreen("main-screen");
      loadHistory();
      loadTodayTotal();
    });
  }

  // === レポートタブ ===
  function loadReport() {
    updateMonthSelector("report");

    KakeiboDB.getTransactionsByMonth(currentMonth).then(function (txs) {
      if (txs.length === 0) {
        document.getElementById("report-content").innerHTML =
          '<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">この月のデータはありません</div></div>';
        return;
      }

      var total = 0;
      var categoryMap = {};
      var dailyMap = {};

      txs.forEach(function (tx) {
        total += tx.total;
        categoryMap[tx.category] = (categoryMap[tx.category] || 0) + tx.total;
        var day = parseInt(tx.date.split("-")[2], 10);
        dailyMap[day] = (dailyMap[day] || 0) + tx.total;
      });

      // カテゴリデータ
      var categoryData = [];
      for (var cat in categoryMap) {
        categoryData.push({ category: cat, total: categoryMap[cat] });
      }
      categoryData.sort(function (a, b) { return b.total - a.total; });

      // 日別データ
      var daysInMonth = new Date(parseInt(currentMonth.split("-")[0]), parseInt(currentMonth.split("-")[1]), 0).getDate();
      var dailyData = [];
      for (var d = 1; d <= daysInMonth; d++) {
        dailyData.push({ label: d + "日", total: dailyMap[d] || 0 });
      }

      var avg = Math.round(total / txs.length);

      // 統計カード
      var statsHtml =
        '<div class="stat-row">' +
          '<div class="stat-card"><div class="stat-label">合計</div><div class="stat-value">' + total.toLocaleString() + '円</div></div>' +
          '<div class="stat-card"><div class="stat-label">件数</div><div class="stat-value">' + txs.length + '<span class="stat-unit">件</span></div></div>' +
          '<div class="stat-card"><div class="stat-label">平均</div><div class="stat-value">' + avg.toLocaleString() + '円</div></div>' +
        '</div>';

      // 予算比較
      KakeiboDB.getBudgetsByMonth(currentMonth).then(function (budgets) {
        var budgetTotal = 0;
        budgets.forEach(function (b) { budgetTotal += b.amount; });

        var budgetHtml = "";
        if (budgetTotal > 0) {
          var remaining = budgetTotal - total;
          var pct = Math.round(total / budgetTotal * 100);
          var barColor = pct > 100 ? "var(--danger)" : pct > 80 ? "#FF9F40" : "var(--success)";
          budgetHtml =
            '<div class="stat-row">' +
              '<div class="stat-card" style="flex:1">' +
                '<div class="stat-label">予算残り</div>' +
                '<div class="stat-value" style="color:' + (remaining < 0 ? "var(--danger)" : "var(--success)") + '">' + remaining.toLocaleString() + '円</div>' +
                '<div style="margin-top:8px;height:8px;background:#f0ebe4;border-radius:4px;overflow:hidden">' +
                  '<div style="height:100%;width:' + Math.min(pct, 100) + '%;background:' + barColor + ';border-radius:4px"></div>' +
                '</div>' +
                '<div class="form-hint">' + pct + '% 使用</div>' +
              '</div>' +
            '</div>';
        }

        var chartHtml =
          '<div class="section-title">カテゴリ別</div>' +
          '<div style="max-width:280px;margin:0 auto"><canvas id="chart-pie"></canvas></div>' +
          '<div class="section-title" style="margin-top:24px">日別推移</div>' +
          '<canvas id="chart-bar"></canvas>' +
          '<div class="section-title" style="margin-top:24px">累計推移</div>' +
          '<canvas id="chart-line"></canvas>';

        // カテゴリ内訳リスト
        var breakdownHtml = '<div class="section-title" style="margin-top:24px">内訳</div>';
        categoryData.forEach(function (cd) {
          var icon = CATEGORY_ICONS[cd.category] || "📦";
          var pctCat = Math.round(cd.total / total * 100);
          breakdownHtml +=
            '<div class="bar-row">' +
              '<div class="bar-label">' + icon + '</div>' +
              '<div class="bar-track"><div class="bar-fill" style="width:' + pctCat + '%;background:' + KakeiboChart.getColor(cd.category) + '"></div></div>' +
              '<div class="bar-value">' + cd.total.toLocaleString() + '円</div>' +
            '</div>';
        });

        document.getElementById("report-content").innerHTML = statsHtml + budgetHtml + chartHtml + breakdownHtml;

        // グラフ描画（DOMが更新された後）
        setTimeout(function () {
          KakeiboChart.renderPie("chart-pie", categoryData);
          KakeiboChart.renderBar("chart-bar", dailyData);
          KakeiboChart.renderLine("chart-line", dailyData, budgetTotal);
        }, 50);
      });
    });
  }

  // === 設定タブ ===
  function loadSettings() {
    // 予算設定を読み込み
    KakeiboDB.getBudgetsByMonth(currentMonth).then(function (budgets) {
      var container = document.getElementById("budget-list");
      container.innerHTML = "";

      var budgetMap = {};
      budgets.forEach(function (b) { budgetMap[b.category] = b.amount; });

      CATEGORIES.forEach(function (cat) {
        var row = document.createElement("div");
        row.className = "form-row";
        row.style.marginBottom = "8px";
        row.innerHTML =
          '<div class="form-group" style="flex:2;margin-bottom:0">' +
            '<span style="font-size:13px">' + (CATEGORY_ICONS[cat] || "") + " " + cat + '</span>' +
          '</div>' +
          '<div class="form-group" style="flex:1;margin-bottom:0">' +
            '<input type="number" class="form-input budget-input" data-category="' + cat + '" placeholder="0" value="' + (budgetMap[cat] || "") + '" style="padding:8px;font-size:13px;text-align:right">' +
          '</div>';
        container.appendChild(row);
      });
    });
  }

  function saveBudgets() {
    var inputs = document.querySelectorAll(".budget-input");
    var promises = [];
    inputs.forEach(function (input) {
      var cat = input.dataset.category;
      var amount = parseInt(input.value, 10) || 0;
      if (amount > 0) {
        promises.push(KakeiboDB.saveBudget(currentMonth, cat, amount));
      }
    });
    Promise.all(promises).then(function () {
      FormUtils.showToast("予算を保存しました");
    });
  }

  // エクスポート
  function exportData() {
    KakeiboDB.exportAll().then(function (data) {
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "kakeibo_backup_" + todayStr() + ".json";
      a.click();
      URL.revokeObjectURL(url);
      FormUtils.showToast("エクスポートしました");
    });
  }

  function exportCSV() {
    KakeiboDB.getAllTransactions().then(function (txs) {
      txs.sort(function (a, b) { return a.date > b.date ? 1 : -1; });
      var lines = ["日付,カテゴリ,金額,メモ,店名"];
      txs.forEach(function (tx) {
        lines.push([
          tx.date,
          tx.category,
          tx.total,
          '"' + (tx.memo || "").replace(/"/g, '""') + '"',
          '"' + (tx.store || "").replace(/"/g, '""') + '"'
        ].join(","));
      });
      var bom = "\uFEFF";
      var blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "kakeibo_" + todayStr() + ".csv";
      a.click();
      URL.revokeObjectURL(url);
      FormUtils.showToast("CSVエクスポートしました");
    });
  }

  function importData() {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var data = JSON.parse(ev.target.result);
          KakeiboDB.importAll(data).then(function () {
            FormUtils.showToast("インポートしました");
            loadHistory();
            loadTodayTotal();
          });
        } catch (err) {
          FormUtils.showToast("ファイルの読み込みに失敗しました");
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  function clearAllData() {
    if (!confirm("全てのデータを削除しますか？\nこの操作は取り消せません。")) return;
    if (!confirm("本当に削除しますか？")) return;
    KakeiboDB.clearAll().then(function () {
      FormUtils.showToast("全データを削除しました");
      loadHistory();
      loadTodayTotal();
    });
  }

  // === 月セレクター ===
  function updateMonthSelector(section) {
    var label = document.getElementById(section + "-month-label");
    if (label) {
      var parts = currentMonth.split("-");
      label.textContent = parts[0] + "年" + parseInt(parts[1]) + "月";
    }
  }

  function changeMonth(section, delta) {
    var parts = currentMonth.split("-");
    var y = parseInt(parts[0]);
    var m = parseInt(parts[1]) + delta;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    currentMonth = y + "-" + String(m).padStart(2, "0");

    if (section === "history") loadHistory();
    if (section === "report") loadReport();
    if (section === "settings") loadSettings();
  }

  // === ユーティリティ ===
  function showSpinner(text) {
    document.getElementById("spinner-text").textContent = text || "処理中...";
    document.getElementById("spinner").classList.remove("hidden");
  }

  function hideSpinner() {
    document.getElementById("spinner").classList.add("hidden");
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // === Public API ===
  return {
    init: init,
    switchTab: switchTab,
    saveEdit: saveEdit,
    cancelEdit: cancelEdit,
    addItemRow: function () { addItemRow("", "", 1); },
    recalcTotal: recalcTotal,
    openDetail: openDetail,
    deleteCurrentTx: deleteCurrentTx,
    changeMonth: changeMonth,
    saveBudgets: saveBudgets,
    exportData: exportData,
    exportCSV: exportCSV,
    importData: importData,
    clearAllData: clearAllData
  };
})();

// 起動
document.addEventListener("DOMContentLoaded", KakeiboApp.init);
