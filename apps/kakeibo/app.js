/**
 * かんたん家計簿 メインアプリ
 * IndexedDB ローカル保存 + GAS OCR連携
 * 電子帳簿保存法対応: レシート画像保存・変更履歴・検索機能
 */
var KakeiboApp = (function () {
  "use strict";

  var GAS_URL = "https://script.google.com/macros/s/AKfycbwvemxonI88X44s0mgJ-mkLCHDvXnhqieExvsv026ZKaQU_462bePBPQqucu1mPslhFPA/exec";
  var userId = null;
  var currentTab = "input";
  var currentMonth = null;
  var editingId = null;
  var ocrQueue = [];
  var dbReady = false;
  var pendingImageBase64 = null; // OCR時のレシート画像を一時保持
  var businessMode = false; // 事業用モード（クラウド同期ON）

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
    try {
      userId = FormUtils.getUserId();
    } catch (e) {
      userId = "browser_" + Math.random().toString(36).substr(2, 9);
    }
    var now = new Date();
    currentMonth = now.getFullYear() + "-" + padZero(now.getMonth() + 1);

    setupTabs();
    setupInputForm();
    setupCamera();
    setupSearch();

    KakeiboDB.open().then(function () {
      dbReady = true;
      return KakeiboDB.getSetting("mode");
    }).then(function (mode) {
      if (!mode) {
        // 初回起動: モード選択画面を表示
        FormUtils.showScreen("mode-select-screen");
        return;
      }
      businessMode = (mode === "business");
      updateModeDisplay();
      loadTodayTotal();
      loadHistory();
    }).catch(function (err) {
      dbReady = true;
      console.error("IndexedDB初期化エラー:", err);
      FormUtils.showToast("データベースの初期化に失敗しました。ページを再読み込みしてください。");
    });
  }

  function padZero(n) {
    return n < 10 ? "0" + n : "" + n;
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
    var sel = document.getElementById("input-category");
    if (sel) {
      for (var i = 0; i < CATEGORIES.length; i++) {
        var opt = document.createElement("option");
        opt.value = CATEGORIES[i];
        opt.textContent = (CATEGORY_ICONS[CATEGORIES[i]] || "") + " " + CATEGORIES[i];
        sel.appendChild(opt);
      }
    }

    var dateInput = document.getElementById("input-date");
    if (dateInput) {
      dateInput.value = todayStr();
    }

    var saveBtn = document.getElementById("btn-save-manual");
    if (saveBtn) {
      saveBtn.addEventListener("click", saveManualInput);
    }
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + padZero(d.getMonth() + 1) + "-" + padZero(d.getDate());
  }

  function saveManualInput() {
    var date = document.getElementById("input-date").value;
    var amountStr = document.getElementById("input-amount").value;
    var amount = parseInt(amountStr, 10);
    var category = document.getElementById("input-category").value;
    var memo = document.getElementById("input-memo").value.trim();

    if (!date || !amountStr || isNaN(amount) || amount <= 0) {
      FormUtils.showToast("日付と金額を入力してください");
      return;
    }

    var tx = {
      id: generateUniqueId(),
      date: date,
      store: "",
      items: [],
      total: amount,
      category: category || "食費",
      memo: memo,
      inputType: "manual",
      createdAt: new Date().toISOString()
    };

    KakeiboDB.addTransaction(tx).then(function () {
      // 監査ログ
      return KakeiboDB.addAuditLog({
        transactionId: tx.id,
        action: "create",
        inputType: "manual",
        snapshot: JSON.parse(JSON.stringify(tx))
      });
    }).then(function () {
      // 事業用モード: クラウド同期
      return syncToGas("kakeibo_save", { transaction: tx });
    }).then(function () {
      FormUtils.showToast("保存しました");
      document.getElementById("input-amount").value = "";
      document.getElementById("input-memo").value = "";
      loadTodayTotal();
    }).catch(function (err) {
      console.error("保存エラー:", err);
      FormUtils.showToast("保存に失敗しました: " + err.message);
    });
  }

  function generateUniqueId() {
    return Math.random().toString(36).substr(2, 8) + "_" + Date.now();
  }

  function loadTodayTotal() {
    var today = todayStr();
    KakeiboDB.getAllTransactions().then(function (all) {
      var total = 0;
      var count = 0;
      for (var i = 0; i < all.length; i++) {
        if (all[i].date === today) {
          total += all[i].total;
          count++;
        }
      }
      document.getElementById("today-total").textContent = total.toLocaleString() + "円";
      document.getElementById("today-count").textContent = count + "件";
    }).catch(function (err) {
      console.error("今日の合計読み込みエラー:", err);
    });
  }

  // === カメラ / OCR ===
  function setupCamera() {
    var cameraInput = document.getElementById("camera-input");
    var libraryInput = document.getElementById("library-input");
    var btnCamera = document.getElementById("btn-camera");
    var btnLibrary = document.getElementById("btn-library");

    if (btnCamera && cameraInput) {
      btnCamera.addEventListener("click", function () {
        cameraInput.click();
      });
      cameraInput.addEventListener("change", function (e) {
        var file = e.target.files[0];
        if (!file) return;
        e.target.value = "";
        ocrQueue = [];
        processOneFile(file);
      });
    }

    if (btnLibrary && libraryInput) {
      btnLibrary.addEventListener("click", function () {
        libraryInput.click();
      });
      libraryInput.addEventListener("change", function (e) {
        var fileList = e.target.files;
        var files = [];
        for (var i = 0; i < fileList.length && i < 5; i++) {
          files.push(fileList[i]);
        }
        e.target.value = "";
        if (files.length === 0) return;
        if (fileList.length > 5) {
          FormUtils.showToast("最大5枚まで選択できます");
        }
        ocrQueue = files.slice(1);
        processOneFile(files[0]);
      });
    }
  }

  function processOneFile(file) {
    var queueInfo = ocrQueue.length > 0 ? "（残り" + ocrQueue.length + "枚）" : "";
    showSpinner("レシートを読み取り中..." + queueInfo);
    compressImage(file, function (base64, mimeType) {
      // 電子帳簿保存法: 原本画像を一時保持
      pendingImageBase64 = base64;

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
            pendingImageBase64 = null;
            processNextInQueue();
          }
        } catch (err) {
          console.error("OCRレスポンスパースエラー:", err, text);
          FormUtils.showToast("レスポンスの解析に失敗しました");
          pendingImageBase64 = null;
          processNextInQueue();
        }
      })
      .catch(function (err) {
        hideSpinner();
        console.error("OCR通信エラー:", err);
        FormUtils.showToast("通信エラーが発生しました");
        pendingImageBase64 = null;
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
      img.onerror = function () {
        FormUtils.showToast("画像の読み込みに失敗しました");
        hideSpinner();
      };
      img.src = e.target.result;
    };
    reader.onerror = function () {
      FormUtils.showToast("ファイルの読み込みに失敗しました");
      hideSpinner();
    };
    reader.readAsDataURL(file);
  }

  function showOcrResult(receipt) {
    editingId = null;
    document.getElementById("btn-delete-tx").classList.add("hidden");

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

    // 画像プレビュー表示
    var previewArea = document.getElementById("edit-image-preview");
    if (previewArea && pendingImageBase64) {
      previewArea.innerHTML = '<img src="data:image/jpeg;base64,' + pendingImageBase64 + '" style="max-width:100%;border-radius:8px;margin-top:8px">';
      previewArea.classList.remove("hidden");
    } else if (previewArea) {
      previewArea.innerHTML = "";
      previewArea.classList.add("hidden");
    }

    var itemsEl = document.getElementById("edit-items");
    itemsEl.innerHTML = "";
    if (receipt.items && receipt.items.length > 0) {
      for (var i = 0; i < receipt.items.length; i++) {
        addItemRow(receipt.items[i].name, receipt.items[i].price, receipt.items[i].quantity);
      }
    }

    FormUtils.showScreen("edit-screen");
  }

  function addItemRow(name, price, qty) {
    var itemsEl = document.getElementById("edit-items");
    var row = document.createElement("div");
    row.className = "item-row";

    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "form-input item-name";
    nameInput.placeholder = "品名";
    nameInput.value = name || "";
    nameInput.style.flex = "3";

    var priceInput = document.createElement("input");
    priceInput.type = "number";
    priceInput.className = "form-input item-price";
    priceInput.placeholder = "金額";
    priceInput.value = price || "";
    priceInput.style.flex = "2";
    priceInput.addEventListener("input", recalcTotal);

    var qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.className = "form-input item-qty";
    qtyInput.placeholder = "数";
    qtyInput.value = qty || 1;
    qtyInput.style.flex = "1";
    qtyInput.style.minWidth = "50px";
    qtyInput.addEventListener("input", recalcTotal);

    var delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "data-card-delete";
    delBtn.textContent = "×";
    delBtn.addEventListener("click", function () {
      row.remove();
      recalcTotal();
    });

    row.appendChild(nameInput);
    row.appendChild(priceInput);
    row.appendChild(qtyInput);
    row.appendChild(delBtn);
    itemsEl.appendChild(row);
  }

  function recalcTotal() {
    var rows = document.querySelectorAll("#edit-items .item-row");
    var sum = 0;
    for (var i = 0; i < rows.length; i++) {
      var p = parseInt(rows[i].querySelector(".item-price").value, 10) || 0;
      var q = parseInt(rows[i].querySelector(".item-qty").value, 10) || 1;
      sum += p * q;
    }
    if (sum > 0) {
      document.getElementById("edit-amount").value = sum;
    }
  }

  function saveEdit() {
    var date = document.getElementById("edit-date").value;
    var amountStr = document.getElementById("edit-amount").value;
    var amount = parseInt(amountStr, 10);
    var category = document.getElementById("edit-category").value;

    if (!date || !amountStr || isNaN(amount) || amount <= 0) {
      FormUtils.showToast("日付と金額を入力してください");
      return;
    }

    var items = [];
    var itemRows = document.querySelectorAll("#edit-items .item-row");
    for (var i = 0; i < itemRows.length; i++) {
      var name = itemRows[i].querySelector(".item-name").value.trim();
      var price = parseInt(itemRows[i].querySelector(".item-price").value, 10) || 0;
      var qty = parseInt(itemRows[i].querySelector(".item-qty").value, 10) || 1;
      if (name || price > 0) {
        items.push({ name: name, price: price, quantity: qty });
      }
    }

    var isEditing = !!editingId;
    var txId = editingId || generateUniqueId();
    var tx = {
      id: txId,
      date: date,
      store: document.getElementById("edit-store").value.trim(),
      items: items,
      total: amount,
      category: category || "食費",
      memo: document.getElementById("edit-memo").value.trim(),
      inputType: isEditing ? "edited" : "ocr",
      createdAt: new Date().toISOString(),
      hasImage: !!pendingImageBase64 || false
    };

    // 重複チェック（編集時はスキップ）
    KakeiboDB.getAllTransactions().then(function (all) {
      if (!isEditing) {
        for (var d = 0; d < all.length; d++) {
          var existing = all[d];
          if (existing.date === tx.date && existing.total === tx.total && existing.store === tx.store) {
            FormUtils.showToast("この内容は既に登録済みです");
            return Promise.reject("duplicate");
          }
        }
      }

      // 編集の場合、変更前のスナップショットを取得
      if (isEditing) {
        var oldTx = null;
        for (var o = 0; o < all.length; o++) {
          if (all[o].id === txId) { oldTx = all[o]; break; }
        }
        if (oldTx) {
          // 既存画像がある場合はhasImageを保持
          if (oldTx.hasImage && !pendingImageBase64) {
            tx.hasImage = true;
          }
          return KakeiboDB.addAuditLog({
            transactionId: txId,
            action: "update",
            before: JSON.parse(JSON.stringify(oldTx)),
            after: JSON.parse(JSON.stringify(tx))
          }).then(function () {
            return KakeiboDB.addTransaction(tx);
          });
        }
      }

      return KakeiboDB.addTransaction(tx);
    }).then(function () {
      // 新規作成の監査ログ
      if (!isEditing) {
        return KakeiboDB.addAuditLog({
          transactionId: txId,
          action: "create",
          inputType: tx.inputType,
          snapshot: JSON.parse(JSON.stringify(tx))
        });
      }
    }).then(function () {
      // 電子帳簿保存法: レシート画像を保存
      if (pendingImageBase64) {
        return KakeiboDB.saveImage(txId, pendingImageBase64, "image/jpeg");
      }
    }).then(function () {
      // 事業用モード: クラウド同期（画像付き）
      return syncToGas("kakeibo_save", {
        transaction: tx,
        imageBase64: pendingImageBase64,
        mimeType: "image/jpeg"
      });
    }).then(function () {
      FormUtils.showToast("保存しました");
      pendingImageBase64 = null;
      editingId = null;
      loadTodayTotal();
      if (ocrQueue.length > 0) {
        processNextInQueue();
      } else {
        FormUtils.showScreen("main-screen");
        switchTab("history");
      }
    }).catch(function (err) {
      if (err === "duplicate") return;
      console.error("保存エラー:", err);
      FormUtils.showToast("保存に失敗しました: " + (err.message || err));
    });
  }

  function cancelEdit() {
    editingId = null;
    pendingImageBase64 = null;
    if (ocrQueue.length > 0) {
      processNextInQueue();
    } else {
      FormUtils.showScreen("main-screen");
    }
  }

  // === 履歴タブ ===
  function loadHistory() {
    updateMonthSelector("history");

    KakeiboDB.getAllTransactions().then(function (allTxs) {
      var txs = allTxs.filter(function (tx) {
        return tx.date && tx.date.substring(0, 7) === currentMonth;
      });

      var container = document.getElementById("history-list");

      if (txs.length === 0) {
        var debugMsg = allTxs.length > 0
          ? "全" + allTxs.length + "件ありますが、" + currentMonth + "のデータはありません"
          : "データはまだありません";
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📝</div><div class="empty-state-text">' + debugMsg + '</div></div>';
        document.getElementById("history-month-total").textContent = "0円";
        return;
      }

      txs.sort(function (a, b) { return b.date > a.date ? 1 : b.date < a.date ? -1 : 0; });

      var total = 0;
      var html = "";
      var lastDate = "";

      for (var i = 0; i < txs.length; i++) {
        var tx = txs[i];
        total += tx.total;
        if (tx.date !== lastDate) {
          lastDate = tx.date;
          html += '<div class="section-title">' + FormUtils.formatDate(tx.date) + '</div>';
        }
        var icon = CATEGORY_ICONS[tx.category] || "📦";
        var color = safeGetColor(tx.category);
        var imgBadge = tx.hasImage ? '<span style="font-size:10px;margin-left:4px">📷</span>' : '';
        html += '<div class="data-card" data-id="' + tx.id + '" onclick="KakeiboApp.openDetail(\'' + tx.id + '\')">' +
          '<div class="data-card-icon" style="background:' + color + '20">' + icon + '</div>' +
          '<div class="data-card-body">' +
            '<div class="data-card-title">' + escapeHtml(tx.memo || tx.store || tx.category) + imgBadge + '</div>' +
            '<div class="data-card-sub">' + tx.category + '</div>' +
          '</div>' +
          '<div class="data-card-right">' +
            '<div class="data-card-amount">' + tx.total.toLocaleString() + '円</div>' +
          '</div>' +
        '</div>';
      }

      container.innerHTML = html;
      document.getElementById("history-month-total").textContent = total.toLocaleString() + "円";
    }).catch(function (err) {
      console.error("履歴読み込みエラー:", err);
    });
  }

  function openDetail(id) {
    KakeiboDB.getTransaction(id).then(function (tx) {
      if (!tx) return;
      editingId = tx.id;
      pendingImageBase64 = null; // 既存画像は別途読み込む
      document.getElementById("edit-date").value = tx.date;
      document.getElementById("edit-store").value = tx.store || "";
      document.getElementById("edit-amount").value = tx.total;
      document.getElementById("edit-category").value = tx.category;
      document.getElementById("edit-memo").value = tx.memo || "";

      var itemsEl = document.getElementById("edit-items");
      itemsEl.innerHTML = "";
      if (tx.items && tx.items.length > 0) {
        for (var i = 0; i < tx.items.length; i++) {
          addItemRow(tx.items[i].name, tx.items[i].price, tx.items[i].quantity);
        }
      }

      // 画像プレビュー読み込み
      var previewArea = document.getElementById("edit-image-preview");
      if (previewArea) {
        previewArea.innerHTML = "";
        previewArea.classList.add("hidden");
        if (tx.hasImage) {
          KakeiboDB.getImage(id).then(function (imgData) {
            if (imgData && imgData.imageBase64) {
              previewArea.innerHTML =
                '<div style="position:relative">' +
                  '<img src="data:' + (imgData.mimeType || "image/jpeg") + ';base64,' + imgData.imageBase64 + '" style="max-width:100%;border-radius:8px;cursor:pointer" onclick="KakeiboApp.showImageViewer(\'' + id + '\')">' +
                  '<div style="position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,0.6);color:#fff;font-size:10px;padding:2px 8px;border-radius:4px">タップで拡大</div>' +
                '</div>';
              previewArea.classList.remove("hidden");
            }
          }).catch(function () {});
        }
      }

      // 変更履歴を表示
      var auditArea = document.getElementById("edit-audit-log");
      if (auditArea) {
        auditArea.innerHTML = "";
        auditArea.classList.add("hidden");
        KakeiboDB.getAuditLogByTransaction(id).then(function (logs) {
          if (logs.length > 0) {
            var html = '<div style="font-size:12px;font-weight:700;color:var(--text-light);margin-bottom:6px">変更履歴</div>';
            for (var l = 0; l < logs.length; l++) {
              var log = logs[l];
              var actionLabel = log.action === "create" ? "作成" : log.action === "update" ? "編集" : log.action === "delete" ? "削除" : log.action;
              var ts = log.timestamp ? log.timestamp.substring(0, 16).replace("T", " ") : "";
              html += '<div style="font-size:11px;color:var(--text-light);padding:2px 0">' + ts + ' — ' + actionLabel + '</div>';
            }
            auditArea.innerHTML = html;
            auditArea.classList.remove("hidden");
          }
        }).catch(function () {});
      }

      document.getElementById("btn-delete-tx").classList.remove("hidden");
      document.getElementById("queue-label").classList.add("hidden");
      FormUtils.showScreen("edit-screen");
    }).catch(function (err) {
      console.error("詳細読み込みエラー:", err);
    });
  }

  function deleteCurrentTx() {
    if (!editingId) return;
    if (!confirm("この記録を削除しますか？")) return;

    var txId = editingId;

    // 削除前のスナップショットを取得して監査ログに記録
    KakeiboDB.getTransaction(txId).then(function (tx) {
      return KakeiboDB.addAuditLog({
        transactionId: txId,
        action: "delete",
        snapshot: tx ? JSON.parse(JSON.stringify(tx)) : null
      });
    }).then(function () {
      return KakeiboDB.deleteTransaction(txId);
    }).then(function () {
      // 画像も削除（監査ログには残る）
      return KakeiboDB.deleteImage(txId);
    }).then(function () {
      // 事業用モード: クラウド同期
      return syncToGas("kakeibo_delete", { transactionId: txId });
    }).then(function () {
      FormUtils.showToast("削除しました");
      editingId = null;
      pendingImageBase64 = null;
      FormUtils.showScreen("main-screen");
      loadHistory();
      loadTodayTotal();
    }).catch(function (err) {
      console.error("削除エラー:", err);
      FormUtils.showToast("削除に失敗しました");
    });
  }

  // === 画像ビューア ===
  function showImageViewer(transactionId) {
    KakeiboDB.getImage(transactionId).then(function (imgData) {
      if (!imgData || !imgData.imageBase64) {
        FormUtils.showToast("画像が見つかりません");
        return;
      }
      var viewer = document.getElementById("image-viewer");
      var img = document.getElementById("viewer-image");
      if (viewer && img) {
        img.src = "data:" + (imgData.mimeType || "image/jpeg") + ";base64," + imgData.imageBase64;
        viewer.classList.remove("hidden");
      }
    }).catch(function (err) {
      console.error("画像読み込みエラー:", err);
    });
  }

  function closeImageViewer() {
    var viewer = document.getElementById("image-viewer");
    if (viewer) {
      viewer.classList.add("hidden");
      document.getElementById("viewer-image").src = "";
    }
  }

  // === 検索機能 (電子帳簿保存法: 日付・金額・取引先検索) ===
  function setupSearch() {
    var searchBtn = document.getElementById("btn-search");
    var clearBtn = document.getElementById("btn-search-clear");
    if (searchBtn) {
      searchBtn.addEventListener("click", executeSearch);
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        document.getElementById("search-store").value = "";
        document.getElementById("search-date-from").value = "";
        document.getElementById("search-date-to").value = "";
        document.getElementById("search-amount-min").value = "";
        document.getElementById("search-amount-max").value = "";
        document.getElementById("search-results").innerHTML = "";
        document.getElementById("search-results").classList.add("hidden");
      });
    }
  }

  function executeSearch() {
    var query = {
      store: document.getElementById("search-store").value.trim(),
      dateFrom: document.getElementById("search-date-from").value,
      dateTo: document.getElementById("search-date-to").value,
      amountMin: document.getElementById("search-amount-min").value,
      amountMax: document.getElementById("search-amount-max").value
    };

    if (!query.store && !query.dateFrom && !query.dateTo && !query.amountMin && !query.amountMax) {
      FormUtils.showToast("検索条件を入力してください");
      return;
    }

    KakeiboDB.searchTransactions(query).then(function (results) {
      var container = document.getElementById("search-results");
      container.classList.remove("hidden");

      if (results.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-text">該当する取引はありません</div></div>';
        return;
      }

      var total = 0;
      var html = '<div style="font-size:13px;font-weight:700;color:var(--text-light);margin-bottom:8px">' + results.length + '件ヒット</div>';

      for (var i = 0; i < results.length; i++) {
        var tx = results[i];
        total += tx.total;
        var icon = CATEGORY_ICONS[tx.category] || "📦";
        var color = safeGetColor(tx.category);
        var imgBadge = tx.hasImage ? '<span style="font-size:10px;margin-left:4px">📷</span>' : '';
        html += '<div class="data-card" data-id="' + tx.id + '" onclick="KakeiboApp.openDetail(\'' + tx.id + '\')">' +
          '<div class="data-card-icon" style="background:' + color + '20">' + icon + '</div>' +
          '<div class="data-card-body">' +
            '<div class="data-card-title">' + escapeHtml(tx.memo || tx.store || tx.category) + imgBadge + '</div>' +
            '<div class="data-card-sub">' + tx.date + ' / ' + tx.category + '</div>' +
          '</div>' +
          '<div class="data-card-right">' +
            '<div class="data-card-amount">' + tx.total.toLocaleString() + '円</div>' +
          '</div>' +
        '</div>';
      }
      html += '<div style="text-align:right;font-size:13px;font-weight:700;color:var(--secondary);margin-top:8px">合計: ' + total.toLocaleString() + '円</div>';

      container.innerHTML = html;
    }).catch(function (err) {
      console.error("検索エラー:", err);
      FormUtils.showToast("検索に失敗しました");
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

      for (var i = 0; i < txs.length; i++) {
        total += txs[i].total;
        categoryMap[txs[i].category] = (categoryMap[txs[i].category] || 0) + txs[i].total;
        var day = parseInt(txs[i].date.split("-")[2], 10);
        dailyMap[day] = (dailyMap[day] || 0) + txs[i].total;
      }

      var categoryData = [];
      for (var cat in categoryMap) {
        categoryData.push({ category: cat, total: categoryMap[cat] });
      }
      categoryData.sort(function (a, b) { return b.total - a.total; });

      var parts = currentMonth.split("-");
      var daysInMonth = new Date(parseInt(parts[0]), parseInt(parts[1]), 0).getDate();
      var dailyData = [];
      for (var d = 1; d <= daysInMonth; d++) {
        dailyData.push({ label: d + "日", total: dailyMap[d] || 0 });
      }

      var avg = Math.round(total / txs.length);

      var statsHtml =
        '<div class="stat-row">' +
          '<div class="stat-card"><div class="stat-label">合計</div><div class="stat-value">' + total.toLocaleString() + '円</div></div>' +
          '<div class="stat-card"><div class="stat-label">件数</div><div class="stat-value">' + txs.length + '<span class="stat-unit">件</span></div></div>' +
          '<div class="stat-card"><div class="stat-label">平均</div><div class="stat-value">' + avg.toLocaleString() + '円</div></div>' +
        '</div>';

      KakeiboDB.getBudgetsByMonth(currentMonth).then(function (budgets) {
        var budgetTotal = 0;
        for (var b = 0; b < budgets.length; b++) { budgetTotal += budgets[b].amount; }

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

        var breakdownHtml = '<div class="section-title" style="margin-top:24px">内訳</div>';
        for (var c = 0; c < categoryData.length; c++) {
          var cd = categoryData[c];
          var cdIcon = CATEGORY_ICONS[cd.category] || "📦";
          var pctCat = Math.round(cd.total / total * 100);
          breakdownHtml +=
            '<div class="bar-row">' +
              '<div class="bar-label">' + cdIcon + '</div>' +
              '<div class="bar-track"><div class="bar-fill" style="width:' + pctCat + '%;background:' + safeGetColor(cd.category) + '"></div></div>' +
              '<div class="bar-value">' + cd.total.toLocaleString() + '円</div>' +
            '</div>';
        }

        document.getElementById("report-content").innerHTML = statsHtml + budgetHtml + chartHtml + breakdownHtml;

        setTimeout(function () {
          KakeiboChart.renderPie("chart-pie", categoryData);
          KakeiboChart.renderBar("chart-bar", dailyData);
          KakeiboChart.renderLine("chart-line", dailyData, budgetTotal);
        }, 50);
      }).catch(function (err) {
        console.error("予算読み込みエラー:", err);
      });
    }).catch(function (err) {
      console.error("レポート読み込みエラー:", err);
    });
  }

  // === 設定タブ ===
  function loadSettings() {
    updateMonthSelector("settings");

    KakeiboDB.getBudgetsByMonth(currentMonth).then(function (budgets) {
      var container = document.getElementById("budget-list");
      container.innerHTML = "";

      var budgetMap = {};
      for (var b = 0; b < budgets.length; b++) { budgetMap[budgets[b].category] = budgets[b].amount; }

      for (var i = 0; i < CATEGORIES.length; i++) {
        var cat = CATEGORIES[i];
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
      }
    }).catch(function (err) {
      console.error("設定読み込みエラー:", err);
    });
  }

  function saveBudgets() {
    var inputs = document.querySelectorAll(".budget-input");
    var promises = [];
    for (var i = 0; i < inputs.length; i++) {
      var cat = inputs[i].dataset.category;
      var amount = parseInt(inputs[i].value, 10) || 0;
      if (amount > 0) {
        promises.push(KakeiboDB.saveBudget(currentMonth, cat, amount));
      }
    }
    Promise.all(promises).then(function () {
      FormUtils.showToast("予算を保存しました");
    }).catch(function (err) {
      console.error("予算保存エラー:", err);
      FormUtils.showToast("予算の保存に失敗しました");
    });
  }

  function exportData(includeImages) {
    if (includeImages) {
      showSpinner("画像付きバックアップを作成中...");
    }
    KakeiboDB.exportAll(!!includeImages).then(function (data) {
      hideSpinner();
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      var suffix = includeImages ? "_full" : "";
      a.download = "kakeibo_backup" + suffix + "_" + todayStr() + ".json";
      a.click();
      URL.revokeObjectURL(url);
      FormUtils.showToast("エクスポートしました");
    }).catch(function (err) {
      hideSpinner();
      console.error("エクスポートエラー:", err);
      FormUtils.showToast("エクスポートに失敗しました");
    });
  }

  function exportCSV() {
    KakeiboDB.getAllTransactions().then(function (txs) {
      txs.sort(function (a, b) { return a.date > b.date ? 1 : -1; });
      var lines = ["日付,カテゴリ,金額,メモ,店名"];
      for (var i = 0; i < txs.length; i++) {
        lines.push([
          txs[i].date,
          txs[i].category,
          txs[i].total,
          '"' + (txs[i].memo || "").replace(/"/g, '""') + '"',
          '"' + (txs[i].store || "").replace(/"/g, '""') + '"'
        ].join(","));
      }
      var bom = "\uFEFF";
      var blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "kakeibo_" + todayStr() + ".csv";
      a.click();
      URL.revokeObjectURL(url);
      FormUtils.showToast("CSVエクスポートしました");
    }).catch(function (err) {
      console.error("CSVエクスポートエラー:", err);
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
          }).catch(function (err) {
            FormUtils.showToast("インポートに失敗しました: " + err.message);
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
    }).catch(function (err) {
      console.error("全削除エラー:", err);
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
    currentMonth = y + "-" + padZero(m);

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

  function safeGetColor(category) {
    try {
      if (typeof KakeiboChart !== "undefined") return KakeiboChart.getColor(category);
      return "#999";
    } catch (e) {
      return "#999";
    }
  }

  // === モード選択・切替 ===
  function selectMode(mode) {
    businessMode = (mode === "business");
    KakeiboDB.setSetting("mode", mode).then(function () {
      updateModeDisplay();
      FormUtils.showScreen("main-screen");
      loadTodayTotal();
      loadHistory();
      if (businessMode) {
        FormUtils.showToast("事業用モード: クラウド同期ON");
      } else {
        FormUtils.showToast("個人用モード: ローカル保存のみ");
      }
    }).catch(function (err) {
      console.error("モード設定エラー:", err);
    });
  }

  function switchMode() {
    var newMode = businessMode ? "personal" : "business";
    var msg = businessMode
      ? "個人用モードに切り替えますか？\nクラウド同期が停止します。"
      : "事業用モードに切り替えますか？\nデータがクラウドに同期されます。";
    if (!confirm(msg)) return;
    selectMode(newMode);
  }

  function updateModeDisplay() {
    var display = document.getElementById("current-mode-display");
    if (display) {
      if (businessMode) {
        display.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:10px;background:#E8F5E9;border-radius:10px;margin-bottom:10px"><span style="font-size:20px">☁️</span><div><div style="font-size:13px;font-weight:700;color:#2E7D32">事業用モード</div><div style="font-size:11px;color:#666">クラウド同期ON・電子帳簿保存法対応</div></div></div>';
      } else {
        display.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:10px;background:#E3F2FD;border-radius:10px;margin-bottom:10px"><span style="font-size:20px">🔒</span><div><div style="font-size:13px;font-weight:700;color:#1565C0">個人用モード</div><div style="font-size:11px;color:#666">ローカル保存のみ・プライバシー重視</div></div></div>';
      }
    }
    // 同期ボタンの表示切替
    var syncBtn = document.getElementById("btn-sync-from-gas");
    if (syncBtn) {
      syncBtn.style.display = businessMode ? "block" : "none";
    }
    // ヘッダーバッジ
    var badge = document.getElementById("mode-badge");
    if (badge) {
      if (businessMode) {
        badge.textContent = "☁️ 事業用";
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    }
  }

  // === GAS同期（事業用モードのみ） ===
  function syncToGas(action, data) {
    if (!businessMode) return Promise.resolve();

    var body = {
      action: action,
      userId: userId
    };
    if (data.transaction) body.transaction = data.transaction;
    if (data.imageBase64) body.imageBase64 = data.imageBase64;
    if (data.mimeType) body.mimeType = data.mimeType;
    if (data.transactionId) body.transactionId = data.transactionId;

    return fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(body)
    }).then(function (r) { return r.text(); })
    .then(function (text) {
      try {
        var res = JSON.parse(text);
        if (!res.ok) {
          console.error("GAS同期エラー:", res.error);
        }
      } catch (e) {
        console.error("GAS同期レスポンスパースエラー:", e);
      }
    }).catch(function (err) {
      console.error("GAS同期通信エラー:", err);
      // 同期失敗してもローカル保存は成功しているのでエラーにしない
    });
  }

  function syncFromGas() {
    if (!businessMode) {
      FormUtils.showToast("事業用モードでのみ利用できます");
      return;
    }
    showSpinner("クラウドから同期中...");

    fetch(GAS_URL + "?action=kakeibo_list&userId=" + encodeURIComponent(userId))
    .then(function (r) { return r.text(); })
    .then(function (text) {
      var res = JSON.parse(text);
      if (!res.ok) {
        hideSpinner();
        FormUtils.showToast("同期に失敗しました: " + (res.error || ""));
        return;
      }
      var txs = res.transactions || [];
      var promises = [];
      for (var i = 0; i < txs.length; i++) {
        promises.push(KakeiboDB.addTransaction(txs[i]));
      }
      return Promise.all(promises);
    }).then(function () {
      hideSpinner();
      FormUtils.showToast("同期完了");
      loadHistory();
      loadTodayTotal();
    }).catch(function (err) {
      hideSpinner();
      console.error("同期エラー:", err);
      FormUtils.showToast("同期に失敗しました");
    });
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

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
    clearAllData: clearAllData,
    showImageViewer: showImageViewer,
    closeImageViewer: closeImageViewer,
    executeSearch: executeSearch,
    selectMode: selectMode,
    switchMode: switchMode,
    syncFromGas: syncFromGas
  };
})();

document.addEventListener("DOMContentLoaded", KakeiboApp.init);
