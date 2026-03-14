/**
 * 請求書ツール フロントエンド
 * データはすべてlocalStorageに保存（GAS不要）
 */
var InvoiceApp = (function () {
  "use strict";

  // ユーザースコープ: 同一端末の複数ユーザーを分離
  var scopeId = "";
  var STORAGE_KEY_INVOICES = "";
  var STORAGE_KEY_PROFILE = "";
  var STORAGE_KEY_NEXT_SEQ = "";
  var STORAGE_KEY_MIGRATED = "";

  var GAS_URL = "https://script.google.com/macros/s/AKfycbyQEYHQP1Ckyh58CC2xcIxIzKukX-PEOXgoqkKiAzPBaV3Io1avF1o1kVT3wRgTHEl7eA/exec";
  var API_KEY = "f483df285fb18aec408865039230d05cce79507f0aeacc9e";

  function initStorageKeys() {
    scopeId = FormUtils.getUserId();
    STORAGE_KEY_INVOICES = "invoice_invoices:" + scopeId;
    STORAGE_KEY_PROFILE = "invoice_profile:" + scopeId;
    STORAGE_KEY_NEXT_SEQ = "invoice_next_seq:" + scopeId;
    STORAGE_KEY_MIGRATED = "invoice_migrated:" + scopeId;
  }

  var currentTaxRate = 10;
  var editingInvoiceId = null;
  var currentInvoice = null;
  var cachedProfile = null;
  var itemCounter = 0;

  // === localStorage ヘルパー ===
  // TODO: Step 3 で Web Crypto API AES-256 暗号化を追加し、平文保存を解消する
  function getInvoicesFromStorage() {
    try {
      var data = localStorage.getItem(STORAGE_KEY_INVOICES);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  function saveInvoicesToStorage(invoices) {
    localStorage.setItem(STORAGE_KEY_INVOICES, JSON.stringify(invoices));
  }

  function getProfileFromStorage() {
    try {
      var data = localStorage.getItem(STORAGE_KEY_PROFILE);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  function saveProfileToStorage(profile) {
    localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(profile));
  }

  function generateInvoiceNumber() {
    var now = new Date();
    var y = now.getFullYear();
    var m = ("0" + (now.getMonth() + 1)).slice(-2);
    var prefix = "INV-" + y + m + "-";
    var seqKey = STORAGE_KEY_NEXT_SEQ + ":" + y + m;

    var seq = Number(localStorage.getItem(seqKey)) || 0;

    // 未初期化 or 月替わり → 既存データから最大値を再計算
    if (seq === 0) {
      seq = recalcSeqFromStorage(prefix);
    }

    var number = prefix + ("000" + seq).slice(-3);
    localStorage.setItem(seqKey, String(seq + 1));
    return number;
  }

  function recalcSeqFromStorage(prefix) {
    var invoices = getInvoicesFromStorage();
    var maxSeq = 0;
    for (var i = 0; i < invoices.length; i++) {
      var num = invoices[i].invoiceNumber || "";
      if (num.indexOf(prefix) === 0) {
        var tail = Number(num.replace(prefix, ""));
        if (tail > maxSeq) maxSeq = tail;
      }
    }
    return maxSeq + 1;
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  // === 初期化 ===
  function init() {
    initStorageKeys();
    migrateFromGas().then(function () {
      loadInvoices();
      loadProfile();
    });
  }

  // === GASからの一回限り移行 ===
  function migrateFromGas() {
    if (localStorage.getItem(STORAGE_KEY_MIGRATED)) {
      return Promise.resolve();
    }
    var hasFailed = false;
    var expectedCount = 0;
    // GASから既存データをインポート（ローカルデータとマージ）
    return fetch(GAS_URL + "?action=list&userId=" + encodeURIComponent(scopeId) + "&apiKey=" + API_KEY)
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) {
          hasFailed = true;
          return [];
        }
        if (res.invoices && res.invoices.length > 0) {
          expectedCount = res.invoices.length;
          var promises = res.invoices.map(function (inv) {
            return fetch(GAS_URL + "?action=get&userId=" + encodeURIComponent(scopeId) + "&id=" + encodeURIComponent(inv.id) + "&apiKey=" + API_KEY)
              .then(function (r) { return r.json(); })
              .then(function (detail) {
                if (detail.ok && detail.invoice) return detail.invoice;
                return null;
              })
              .catch(function () { return null; });
          });
          return Promise.all(promises);
        }
        return [];
      })
      .then(function (gasInvoices) {
        var valid = gasInvoices.filter(function (i) { return i !== null; });
        // 1件でも取得失敗があれば次回再試行
        if (expectedCount > 0 && valid.length < expectedCount) {
          hasFailed = true;
        }
        if (valid.length > 0) {
          var now = new Date().toISOString();
          for (var i = 0; i < valid.length; i++) {
            if (!valid[i].createdAt) valid[i].createdAt = now;
            if (!valid[i].updatedAt) valid[i].updatedAt = now;
            if (!valid[i].status) valid[i].status = "draft";
          }
          // ローカル既存データとマージ（IDが重複しないもののみ追加）
          var existing = getInvoicesFromStorage();
          var existingIds = {};
          for (var e = 0; e < existing.length; e++) {
            existingIds[existing[e].id] = true;
          }
          for (var v = 0; v < valid.length; v++) {
            if (!existingIds[valid[v].id]) {
              existing.push(valid[v]);
            }
          }
          saveInvoicesToStorage(existing);
          // 移行データから月別採番シーケンスを初期化
          var now2 = new Date();
          var ym = now2.getFullYear() + ("0" + (now2.getMonth() + 1)).slice(-2);
          var prefix = "INV-" + ym + "-";
          var maxSeq = 0;
          for (var j = 0; j < existing.length; j++) {
            var num = existing[j].invoiceNumber || "";
            if (num.indexOf(prefix) === 0) {
              var tail = Number(num.replace(prefix, ""));
              if (tail > maxSeq) maxSeq = tail;
            }
          }
          if (maxSeq > 0) {
            localStorage.setItem(STORAGE_KEY_NEXT_SEQ + ":" + ym, String(maxSeq + 1));
          }
        }
        return fetch(GAS_URL + "?action=profile&userId=" + encodeURIComponent(scopeId) + "&apiKey=" + API_KEY);
      })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok && res.profile) {
          if (!getProfileFromStorage()) {
            saveProfileToStorage(res.profile);
          }
        } else {
          hasFailed = true;
        }
        // 全取得成功時のみ移行完了フラグを立てる
        if (!hasFailed) {
          localStorage.setItem(STORAGE_KEY_MIGRATED, "1");
        }
      })
      .catch(function () {
        // GAS接続失敗 → 移行スキップ（次回再試行）
      });
  }

  function setDefaultDates() {
    var today = new Date();
    var yyyy = today.getFullYear();
    var mm = ("0" + (today.getMonth() + 1)).slice(-2);
    var dd = ("0" + today.getDate()).slice(-2);
    document.getElementById("inv-issue-date").value = yyyy + "-" + mm + "-" + dd;

    // 支払期限: 発行日の1ヶ月後（同日）
    updateDueDate(today);
  }

  function onIssueDateChange() {
    var issueDate = document.getElementById("inv-issue-date").value;
    if (issueDate) {
      updateDueDate(new Date(issueDate));
    }
  }

  function updateDueDate(baseDate) {
    var base = new Date(baseDate);
    var targetMonth = base.getMonth() + 1;
    var targetYear = base.getFullYear();
    if (targetMonth > 11) {
      targetMonth = 0;
      targetYear++;
    }
    // 翌月の末日を求める
    var lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    var day = Math.min(base.getDate(), lastDayOfTargetMonth);
    var dy = targetYear;
    var dm = ("0" + (targetMonth + 1)).slice(-2);
    var dd = ("0" + day).slice(-2);
    document.getElementById("inv-due-date").value = dy + "-" + dm + "-" + dd;
  }

  // === 事業者情報画面 ===
  function showProfile() {
    FormUtils.showScreen("profile-screen");
  }

  // === 品目行 ===
  function addItemRow(item) {
    itemCounter++;
    var container = document.getElementById("items-container");
    var div = document.createElement("div");
    div.className = "item-row";
    div.id = "item-" + itemCounter;
    var idx = itemCounter;

    div.innerHTML =
      '<div class="item-row-header">' +
        '<strong>品目 ' + idx + '</strong>' +
        '<button class="item-remove-btn" onclick="InvoiceApp.removeItem(' + idx + ')">×</button>' +
      '</div>' +
      '<div class="item-fields">' +
        '<div style="grid-column:1/-1;display:flex;gap:8px;">' +
          '<div style="flex:1;"><label>納品日</label>' +
          '<input type="date" id="item-date-' + idx + '" value="' + ((item && item.deliveryDate) || '') + '"></div>' +
          '<div style="flex:2;"><label>品名</label>' +
          '<input type="text" id="item-name-' + idx + '" placeholder="例：サポート費" value="' + ((item && item.name) || '') + '" oninput="InvoiceApp.calcTotal()"></div>' +
        '</div>' +
        '<div>' +
          '<label>単価</label>' +
          '<div style="display:flex;align-items:center;gap:2px;"><input type="number" id="item-price-' + idx + '" value="' + ((item && item.unitPrice) || '') + '" placeholder="0" oninput="InvoiceApp.calcTotal()" style="flex:1;"><span style="font-size:13px;">円</span></div>' +
        '</div>' +
        '<div>' +
          '<label>数量</label>' +
          '<input type="number" id="item-qty-' + idx + '" value="' + ((item && item.quantity) || 1) + '" min="1" oninput="InvoiceApp.calcTotal()">' +
        '</div>' +
        '<div>' +
          '<label>単位</label>' +
          (function() {
            var unitVal = (item && item.unit) || '式';
            var units = ['式','個','本','枚','台','件','時間','日','月','回','セット','kg'];
            var opts = '';
            var found = false;
            for (var u = 0; u < units.length; u++) {
              var sel = (unitVal === units[u]) ? ' selected' : '';
              if (sel) found = true;
              opts += '<option value="' + units[u] + '"' + sel + '>' + units[u] + '</option>';
            }
            if (!found) {
              opts = '<option value="' + unitVal + '" selected>' + unitVal + '</option>' + opts;
            }
            return '<select id="item-unit-' + idx + '">' + opts + '</select>';
          })() +
        '</div>' +
      '</div>';

    container.appendChild(div);
    calcTotal();
  }

  function removeItem(idx) {
    var el = document.getElementById("item-" + idx);
    if (el) el.remove();
    calcTotal();
  }

  function getItems() {
    var container = document.getElementById("items-container");
    var rows = container.querySelectorAll(".item-row");
    var items = [];
    for (var i = 0; i < rows.length; i++) {
      var id = rows[i].id.replace("item-", "");
      var name = document.getElementById("item-name-" + id).value.trim();
      var qty = Number(document.getElementById("item-qty-" + id).value) || 0;
      var unit = document.getElementById("item-unit-" + id).value.trim() || "式";
      var price = Number(document.getElementById("item-price-" + id).value) || 0;
      var deliveryDate = document.getElementById("item-date-" + id).value || "";
      if (name || price > 0) {
        items.push({
          name: name,
          quantity: qty,
          unit: unit,
          unitPrice: price,
          amount: qty * price,
          deliveryDate: deliveryDate
        });
      }
    }
    return items;
  }

  // === 金額計算 ===
  function calcTotal() {
    var items = getItems();
    var subtotal = 0;
    for (var i = 0; i < items.length; i++) {
      subtotal += items[i].amount;
    }
    var taxAmount = Math.floor(subtotal * currentTaxRate / 100);
    var total = subtotal + taxAmount;

    document.getElementById("sum-subtotal").textContent = "¥" + subtotal.toLocaleString();
    document.getElementById("sum-tax").textContent = "¥" + taxAmount.toLocaleString();
    document.getElementById("sum-total").textContent = "¥" + total.toLocaleString();
  }

  function setTaxRate(rate, btn) {
    currentTaxRate = rate;
    var btns = document.querySelectorAll(".tax-rate-btn");
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove("active");
    btn.classList.add("active");
    calcTotal();
  }

  // === 画面遷移 ===
  function showCreate() {
    editingInvoiceId = null;
    clearForm();
    setDefaultDates();
    addItemRow();
    FormUtils.showScreen("create-screen");
  }

  function backToMain() {
    FormUtils.showScreen("main-screen");
    loadInvoices();
  }

  function backToCreate() {
    FormUtils.showScreen("create-screen");
  }

  function clearForm() {
    document.getElementById("inv-client").value = "";
    document.getElementById("inv-client-zip").value = "";
    document.getElementById("inv-client-address").value = "";
    document.getElementById("inv-client-building").value = "";
    document.getElementById("inv-client-person").value = "";
    document.getElementById("inv-client-honorific").value = "様";
    document.getElementById("inv-notes").value = "";
    document.getElementById("items-container").innerHTML = "";
    itemCounter = 0;
    currentTaxRate = 10;
    var btns = document.querySelectorAll(".tax-rate-btn");
    if (btns.length > 0) {
      for (var i = 0; i < btns.length; i++) btns[i].classList.remove("active");
      btns[0].classList.add("active");
    }
  }

  // === プレビュー ===
  function preview() {
    var client = document.getElementById("inv-client").value.trim();
    if (!client) {
      FormUtils.showToast("請求先を入力してください");
      document.getElementById("inv-client").focus();
      return;
    }

    var items = getItems();
    if (items.length === 0) {
      FormUtils.showToast("品目を1つ以上入力してください");
      return;
    }

    var subtotal = 0;
    for (var i = 0; i < items.length; i++) subtotal += items[i].amount;
    var taxAmount = Math.floor(subtotal * currentTaxRate / 100);
    var total = subtotal + taxAmount;

    var issueDate = document.getElementById("inv-issue-date").value;
    var dueDate = document.getElementById("inv-due-date").value;

    var clientZip = document.getElementById("inv-client-zip").value.trim();
    var clientBuilding = document.getElementById("inv-client-building").value.trim();
    var personName = document.getElementById("inv-client-person").value.trim();
    var honorific = document.getElementById("inv-client-honorific").value;
    var clientPerson = personName ? (personName + (honorific ? " " + honorific : "")) : "";
    var clientAddr = document.getElementById("inv-client-address").value.trim();

    document.getElementById("prev-number").textContent = editingInvoiceId ? "(既存)" : "(保存時に自動採番)";
    document.getElementById("prev-dates").textContent = "請求日:" + issueDate + " / 期限: " + dueDate;
    document.getElementById("prev-client").textContent = client + " 御中";

    var addrParts = [];
    if (clientZip) addrParts.push("〒" + clientZip);
    if (clientAddr) addrParts.push(clientAddr);
    if (clientBuilding) addrParts.push(clientBuilding);
    document.getElementById("prev-client-address").textContent = addrParts.join(" ");
    document.getElementById("prev-client-person").textContent = clientPerson ? clientPerson : "";

    document.getElementById("prev-total").textContent = "¥" + total.toLocaleString();
    document.getElementById("prev-subtotal").textContent = "¥" + subtotal.toLocaleString();
    document.getElementById("prev-tax").textContent = currentTaxRate === 0
      ? "なし（非課税）"
      : "¥" + taxAmount.toLocaleString() + "（" + currentTaxRate + "%）";
    document.getElementById("prev-total2").textContent = "¥" + total.toLocaleString();

    // 品目テーブル
    var tbody = document.getElementById("prev-items");
    tbody.innerHTML = "";
    for (var j = 0; j < items.length; j++) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + escapeHtml(items[j].deliveryDate || "") + "</td>" +
        "<td>" + escapeHtml(items[j].name) + "</td>" +
        "<td>" + items[j].quantity + " " + escapeHtml(items[j].unit) + "</td>" +
        "<td>¥" + items[j].unitPrice.toLocaleString() + "</td>" +
        "<td>¥" + items[j].amount.toLocaleString() + "</td>";
      tbody.appendChild(tr);
    }

    // 振込先
    var bankSection = document.getElementById("prev-bank-section");
    if (cachedProfile && cachedProfile.bankInfo) {
      bankSection.classList.remove("hidden");
      document.getElementById("prev-bank").textContent = cachedProfile.bankInfo;
    } else {
      bankSection.classList.add("hidden");
    }

    // 備考
    var notes = document.getElementById("inv-notes").value.trim();
    var notesSection = document.getElementById("prev-notes-section");
    if (notes) {
      notesSection.classList.remove("hidden");
      document.getElementById("prev-notes").textContent = notes;
    } else {
      notesSection.classList.add("hidden");
    }

    FormUtils.showScreen("preview-screen");
  }

  // === 保存 ===
  function buildInvoiceData() {
    var items = getItems();
    var subtotal = 0;
    for (var i = 0; i < items.length; i++) subtotal += items[i].amount;
    var taxAmount = Math.floor(subtotal * currentTaxRate / 100);
    var total = subtotal + taxAmount;

    return {
      id: editingInvoiceId || "",
      clientName: document.getElementById("inv-client").value.trim(),
      clientZip: document.getElementById("inv-client-zip").value.trim(),
      clientAddress: document.getElementById("inv-client-address").value.trim(),
      clientBuilding: document.getElementById("inv-client-building").value.trim(),
      clientPerson: (function() {
        var n = document.getElementById("inv-client-person").value.trim();
        var h = document.getElementById("inv-client-honorific").value;
        return n ? (n + (h ? " " + h : "")) : "";
      })(),
      issueDate: document.getElementById("inv-issue-date").value,
      dueDate: document.getElementById("inv-due-date").value,
      items: items,
      subtotal: subtotal,
      taxRate: currentTaxRate,
      taxAmount: taxAmount,
      total: total,
      notes: document.getElementById("inv-notes").value.trim()
    };
  }

  function saveAsDraft() {
    var data = buildInvoiceData();
    data.status = "draft";
    saveInvoiceToLocal(data);
    FormUtils.showToast("下書き保存しました");
    backToMain();
  }

  function saveInvoiceToLocal(data) {
    var invoices = getInvoicesFromStorage();
    var now = new Date().toISOString();

    if (data.id) {
      // 既存の更新
      for (var i = 0; i < invoices.length; i++) {
        if (invoices[i].id === data.id) {
          data.invoiceNumber = invoices[i].invoiceNumber;
          data.updatedAt = now;
          data.createdAt = invoices[i].createdAt;
          invoices[i] = data;
          saveInvoicesToStorage(invoices);
          return data;
        }
      }
    }

    // 新規作成
    data.id = generateId();
    data.invoiceNumber = generateInvoiceNumber();
    data.createdAt = now;
    data.updatedAt = now;
    invoices.push(data);
    saveInvoicesToStorage(invoices);
    editingInvoiceId = data.id;
    return data;
  }

  function saveAndGenerate() {
    var data = buildInvoiceData();
    data.status = "draft";
    var saved = saveInvoiceToLocal(data);
    currentInvoice = saved;
    generatePdfFromData(saved);
  }

  // === 一覧読み込み ===
  function loadInvoices() {
    var invoices = getInvoicesFromStorage();
    // 発行日降順
    invoices.sort(function (a, b) {
      return (b.issueDate || "").localeCompare(a.issueDate || "");
    });
    renderInvoiceList(invoices);
  }

  function renderInvoiceList(invoices) {
    var container = document.getElementById("invoice-list");
    if (!invoices || invoices.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><div class="empty-state-icon">📄</div>' +
        '<div class="empty-state-text">請求書がまだありません<br>「+ 新規作成」から作成しましょう</div></div>';
      return;
    }

    var html = "";
    for (var i = 0; i < invoices.length; i++) {
      var inv = invoices[i];
      var statusClass = "status-" + inv.status;
      var statusText = inv.status === "draft" ? "下書き" : inv.status === "sent" ? "送付済" : "入金済";
      html +=
        '<div class="invoice-card" onclick="InvoiceApp.showDetail(\'' + inv.id + '\')">' +
          '<div class="invoice-card-top">' +
            '<span class="invoice-card-number">' + escapeHtml(inv.invoiceNumber) + '</span>' +
            '<span class="status-badge ' + statusClass + '">' + statusText + '</span>' +
          '</div>' +
          '<div class="invoice-card-client">' + escapeHtml(inv.clientName) + '</div>' +
          '<div class="invoice-card-bottom">' +
            '<span>' + inv.issueDate + '</span>' +
            '<span class="invoice-card-amount">¥' + Number(inv.total).toLocaleString() + '</span>' +
          '</div>' +
        '</div>';
    }
    container.innerHTML = html;
  }

  // === 詳細表示 ===
  function showDetail(id) {
    var invoices = getInvoicesFromStorage();
    for (var i = 0; i < invoices.length; i++) {
      if (invoices[i].id === id) {
        currentInvoice = invoices[i];
        renderDetail(invoices[i]);
        FormUtils.showScreen("detail-screen");
        return;
      }
    }
    FormUtils.showToast("請求書が見つかりません");
  }

  function renderDetail(inv) {
    document.getElementById("detail-title").textContent = inv.invoiceNumber;

    var items = inv.items || [];
    var itemRows = "";
    for (var i = 0; i < items.length; i++) {
      itemRows +=
        "<tr><td>" + escapeHtml(items[i].deliveryDate || "") + "</td>" +
        "<td>" + escapeHtml(items[i].name) + "</td>" +
        "<td>" + items[i].quantity + " " + escapeHtml(items[i].unit || "") + "</td>" +
        "<td>¥" + Number(items[i].unitPrice).toLocaleString() + "</td>" +
        "<td>¥" + Number(items[i].amount).toLocaleString() + "</td></tr>";
    }

    var statusText = inv.status === "draft" ? "下書き" : inv.status === "sent" ? "送付済" : "入金済";
    var statusClass = "status-" + inv.status;

    var detailAddr = [];
    if (inv.clientZip) detailAddr.push("〒" + inv.clientZip);
    if (inv.clientAddress) detailAddr.push(inv.clientAddress);
    if (inv.clientBuilding) detailAddr.push(inv.clientBuilding);
    var detailAddrHtml = detailAddr.length > 0
      ? '<div style="font-size:13px;color:var(--text-light);margin-bottom:2px;">' + escapeHtml(detailAddr.join(" ")) + '</div>'
      : '';
    var detailPersonHtml = inv.clientPerson
      ? '<div style="font-size:13px;color:var(--text-light);margin-bottom:12px;">' + escapeHtml(inv.clientPerson) + '</div>'
      : '';

    document.getElementById("detail-preview").innerHTML =
      '<div class="preview-meta">' +
        '<span>請求日:' + inv.issueDate + '</span>' +
        '<span class="status-badge ' + statusClass + '">' + statusText + '</span>' +
      '</div>' +
      '<div class="preview-client">' + escapeHtml(inv.clientName) + ' 御中</div>' +
      detailAddrHtml + detailPersonHtml +
      '<div class="preview-total-box">' +
        '<div class="preview-total-label">ご請求金額</div>' +
        '<div class="preview-total-amount">¥' + Number(inv.total).toLocaleString() + '</div>' +
      '</div>' +
      '<table class="preview-table"><thead><tr><th>納品日</th><th>品目</th><th>数量</th><th>単価</th><th>金額</th></tr></thead>' +
      '<tbody>' + itemRows + '</tbody></table>' +
      '<div class="amount-summary">' +
        '<div class="amount-row"><span>小計</span><span>¥' + Number(inv.subtotal).toLocaleString() + '</span></div>' +
        '<div class="amount-row"><span>消費税額合計' + (inv.taxRate === 0 ? '（なし（非課税））' : '（' + inv.taxRate + '%）') + '</span><span>¥' + Number(inv.taxAmount).toLocaleString() + '</span></div>' +
        '<div class="amount-row total"><span>合計</span><span>¥' + Number(inv.total).toLocaleString() + '</span></div>' +
      '</div>' +
      (inv.notes ? '<div class="preview-section"><div class="preview-section-title">備考</div><div style="font-size:13px;">' + escapeHtml(inv.notes) + '</div></div>' : '');

    // ステータスボタンのテキスト
    var nextStatus = inv.status === "draft" ? "sent" : inv.status === "sent" ? "paid" : "draft";
    var nextLabel = nextStatus === "sent" ? "送付済みにする" : nextStatus === "paid" ? "入金済みにする" : "下書きに戻す";
    document.getElementById("btn-status").textContent = nextLabel;

    document.getElementById("pdf-link-area").classList.add("hidden");
  }

  // === ステータス変更 ===
  function cycleStatus() {
    if (!currentInvoice) return;
    var nextStatus = currentInvoice.status === "draft" ? "sent" : currentInvoice.status === "sent" ? "paid" : "draft";

    var invoices = getInvoicesFromStorage();
    for (var i = 0; i < invoices.length; i++) {
      if (invoices[i].id === currentInvoice.id) {
        invoices[i].status = nextStatus;
        invoices[i].updatedAt = new Date().toISOString();
        saveInvoicesToStorage(invoices);
        currentInvoice = invoices[i];
        renderDetail(currentInvoice);
        FormUtils.showToast("ステータスを更新しました");
        return;
      }
    }
    FormUtils.showToast("請求書が見つかりません");
  }

  // === PDF生成（html2pdf.js） ===
  function generatePdf() {
    if (!currentInvoice) return;
    generatePdfFromData(currentInvoice);
  }

  function generatePdfFromData(inv) {
    showSpinner();
    var profile = cachedProfile || {};
    var items = inv.items || [];
    var itemRows = "";
    for (var i = 0; i < items.length; i++) {
      itemRows +=
        "<tr><td>" + escapeHtml(items[i].deliveryDate || "") + "</td>" +
        "<td>" + escapeHtml(items[i].name) + "</td>" +
        "<td style='text-align:center;'>" + items[i].quantity + " " + escapeHtml(items[i].unit || "") + "</td>" +
        "<td style='text-align:right;'>¥" + Number(items[i].unitPrice).toLocaleString() + "</td>" +
        "<td style='text-align:right;'>¥" + Number(items[i].amount).toLocaleString() + "</td></tr>";
    }

    var addrParts = [];
    if (inv.clientZip) addrParts.push("〒" + inv.clientZip);
    if (inv.clientAddress) addrParts.push(inv.clientAddress);
    if (inv.clientBuilding) addrParts.push(inv.clientBuilding);

    var taxLabel = inv.taxRate === 0
      ? "なし（非課税）"
      : "¥" + Number(inv.taxAmount).toLocaleString() + "（" + inv.taxRate + "%）";

    var html =
      '<div style="font-family:sans-serif;padding:20px;max-width:700px;margin:0 auto;">' +
        '<h1 style="text-align:center;font-size:22px;margin-bottom:24px;">請求書</h1>' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:16px;">' +
          '<div>' +
            '<div style="font-size:16px;font-weight:bold;margin-bottom:4px;">' + escapeHtml(inv.clientName) + ' 御中</div>' +
            (addrParts.length > 0 ? '<div style="font-size:12px;color:#666;">' + escapeHtml(addrParts.join(" ")) + '</div>' : '') +
            (inv.clientPerson ? '<div style="font-size:12px;color:#666;">' + escapeHtml(inv.clientPerson) + '</div>' : '') +
          '</div>' +
          '<div style="text-align:right;font-size:12px;">' +
            '<div>請求番号: ' + escapeHtml(inv.invoiceNumber) + '</div>' +
            '<div>請求日: ' + escapeHtml(inv.issueDate) + '</div>' +
            '<div>お支払期限: ' + escapeHtml(inv.dueDate) + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="background:#FFF8F0;border-radius:8px;padding:12px;text-align:center;margin-bottom:16px;">' +
          '<div style="font-size:11px;color:#888;">ご請求金額</div>' +
          '<div style="font-size:22px;font-weight:bold;">¥' + Number(inv.total).toLocaleString() + '</div>' +
        '</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px;">' +
          '<thead><tr style="background:#F57C00;color:#fff;">' +
            '<th style="padding:6px 8px;text-align:left;">納品日</th>' +
            '<th style="padding:6px 8px;text-align:left;">品目</th>' +
            '<th style="padding:6px 8px;text-align:center;">数量</th>' +
            '<th style="padding:6px 8px;text-align:right;">単価</th>' +
            '<th style="padding:6px 8px;text-align:right;">金額</th>' +
          '</tr></thead>' +
          '<tbody>' + itemRows + '</tbody>' +
        '</table>' +
        '<div style="text-align:right;font-size:13px;margin-bottom:16px;">' +
          '<div>小計: ¥' + Number(inv.subtotal).toLocaleString() + '</div>' +
          '<div>消費税額合計: ' + taxLabel + '</div>' +
          '<div style="font-size:16px;font-weight:bold;border-top:2px solid #F57C00;padding-top:4px;margin-top:4px;">合計: ¥' + Number(inv.total).toLocaleString() + '</div>' +
        '</div>' +
        (profile.bankInfo ? '<div style="border-top:1px solid #ddd;padding-top:8px;margin-bottom:8px;"><div style="font-size:11px;font-weight:bold;color:#888;">振込先</div><div style="font-size:12px;">' + escapeHtml(profile.bankInfo) + '</div></div>' : '') +
        (inv.notes ? '<div style="border-top:1px solid #ddd;padding-top:8px;"><div style="font-size:11px;font-weight:bold;color:#888;">備考</div><div style="font-size:12px;">' + escapeHtml(inv.notes) + '</div></div>' : '') +
        (profile.businessName ? '<div style="border-top:1px solid #ddd;padding-top:8px;margin-top:12px;font-size:12px;">' +
          '<div style="font-weight:bold;">' + escapeHtml(profile.businessName) + '</div>' +
          (profile.businessAddress ? '<div>' + escapeHtml(profile.businessAddress) + '</div>' : '') +
          (profile.phone ? '<div>TEL: ' + escapeHtml(profile.phone) + '</div>' : '') +
          (profile.email ? '<div>Email: ' + escapeHtml(profile.email) + '</div>' : '') +
          (profile.registrationNumber ? '<div>登録番号: ' + escapeHtml(profile.registrationNumber) + '</div>' : '') +
        '</div>' : '') +
      '</div>';

    var container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    var fileName = (inv.invoiceNumber || "invoice") + ".pdf";

    html2pdf().set({
      margin: 10,
      filename: fileName,
      image: { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
    }).from(container).save().then(function () {
      document.body.removeChild(container);
      hideSpinner();
      FormUtils.showToast("PDFをダウンロードしました");
      backToMain();
    }).catch(function () {
      document.body.removeChild(container);
      hideSpinner();
      FormUtils.showToast("PDF作成エラー");
    });
  }

  // === 編集 ===
  function editInvoice() {
    if (!currentInvoice) return;
    clearForm();
    editingInvoiceId = currentInvoice.id;

    document.getElementById("inv-client").value = currentInvoice.clientName || "";
    document.getElementById("inv-client-zip").value = currentInvoice.clientZip || "";
    document.getElementById("inv-client-address").value = currentInvoice.clientAddress || "";
    document.getElementById("inv-client-building").value = currentInvoice.clientBuilding || "";
    // 敬称を分離して復元（スペース有無両対応）
    var personFull = currentInvoice.clientPerson || "";
    var honorifics = ["様", "御中", "殿", "先生"];
    var foundHonorific = "";
    for (var h = 0; h < honorifics.length; h++) {
      var withSpace = new RegExp("\\s" + honorifics[h] + "$");
      var withoutSpace = new RegExp(honorifics[h] + "$");
      if (withSpace.test(personFull)) {
        foundHonorific = honorifics[h];
        personFull = personFull.replace(withSpace, "");
        break;
      } else if (withoutSpace.test(personFull)) {
        foundHonorific = honorifics[h];
        personFull = personFull.replace(withoutSpace, "");
        break;
      }
    }
    document.getElementById("inv-client-person").value = personFull;
    document.getElementById("inv-client-honorific").value = foundHonorific;
    document.getElementById("inv-issue-date").value = currentInvoice.issueDate || "";
    document.getElementById("inv-due-date").value = currentInvoice.dueDate || "";
    document.getElementById("inv-notes").value = currentInvoice.notes || "";

    // 品目復元
    var items = currentInvoice.items || [];
    for (var i = 0; i < items.length; i++) {
      addItemRow(items[i]);
    }
    if (items.length === 0) addItemRow();

    // 税率復元
    currentTaxRate = typeof currentInvoice.taxRate === "number" ? currentInvoice.taxRate : 10;
    var btns = document.querySelectorAll(".tax-rate-btn");
    for (var j = 0; j < btns.length; j++) {
      btns[j].classList.remove("active");
      if ((currentTaxRate === 10 && j === 0) ||
          (currentTaxRate === 8 && j === 1) ||
          (currentTaxRate === 0 && j === 2)) {
        btns[j].classList.add("active");
      }
    }

    calcTotal();
    FormUtils.showScreen("create-screen");
  }

  // === 削除 ===
  function deleteInvoice() {
    if (!currentInvoice) return;
    if (!confirm("この請求書を削除しますか？")) return;

    var invoices = getInvoicesFromStorage();
    invoices = invoices.filter(function (inv) {
      return inv.id !== currentInvoice.id;
    });
    saveInvoicesToStorage(invoices);
    FormUtils.showToast("削除しました");
    backToMain();
  }

  // === プロフィール ===
  function loadProfile() {
    var profile = getProfileFromStorage();
    if (profile) {
      cachedProfile = profile;
      document.getElementById("prof-name").value = profile.businessName || "";
      // 住所: "〒XXX-XXXX 住所" 形式から分離
      var addr = profile.businessAddress || "";
      var zipMatch = addr.match(/^〒?(\d{3}-?\d{4})\s*/);
      if (zipMatch) {
        document.getElementById("prof-zip").value = zipMatch[1];
        document.getElementById("prof-address").value = addr.replace(/^〒?\d{3}-?\d{4}\s*/, "");
      } else {
        document.getElementById("prof-address").value = addr;
      }
      document.getElementById("prof-phone").value = profile.phone || "";
      setEmailFromFull(profile.email || "");
      setBankInfoFromFull(profile.bankInfo || "");
      document.getElementById("prof-reg").value = profile.registrationNumber || "";
    }
  }

  function saveProfile() {
    var zip = document.getElementById("prof-zip").value.trim();
    var address = document.getElementById("prof-address").value.trim();
    var fullAddress = zip ? "〒" + zip + " " + address : address;

    var profile = {
      businessName: document.getElementById("prof-name").value.trim(),
      businessAddress: fullAddress,
      phone: document.getElementById("prof-phone").value.trim(),
      email: getEmailFull(),
      bankInfo: getBankInfoFull(),
      registrationNumber: document.getElementById("prof-reg").value.trim()
    };

    saveProfileToStorage(profile);
    cachedProfile = profile;
    FormUtils.showToast("保存しました");
    backToMain();
  }

  // === 請求先 郵便番号検索 ===
  function onClientZipInput(el) {
    el.value = el.value.replace(/[０-９]/g, function (s) {
      return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
    }).replace(/[^0-9\-]/g, "");
    var digits = el.value.replace(/-/g, "");
    if (digits.length === 7) searchClientZip();
  }

  function searchClientZip() {
    var zip = document.getElementById("inv-client-zip").value.replace(/[^0-9]/g, "");
    if (zip.length !== 7) {
      FormUtils.showToast("7桁の郵便番号を入力してください");
      return;
    }
    fetch("https://zipcloud.ibsnet.co.jp/api/search?zipcode=" + zip)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.results && data.results.length > 0) {
          var r = data.results[0];
          var address = r.address1 + r.address2 + r.address3;
          document.getElementById("inv-client-address").value = address;
          document.getElementById("inv-client-address").focus();
          FormUtils.showToast("住所を取得しました");
        } else {
          FormUtils.showToast("該当する住所が見つかりません");
        }
      })
      .catch(function () {
        FormUtils.showToast("住所検索に失敗しました");
      });
  }

  // === 事業者 郵便番号検索 ===
  function onZipInput(el) {
    // 数字とハイフンのみ許可、全角→半角変換
    el.value = el.value.replace(/[０-９]/g, function (s) {
      return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
    }).replace(/[^0-9\-]/g, "");
    // 7桁入力で自動検索
    var digits = el.value.replace(/-/g, "");
    if (digits.length === 7) searchZip();
  }

  function searchZip() {
    var zip = document.getElementById("prof-zip").value.replace(/[^0-9]/g, "");
    if (zip.length !== 7) {
      FormUtils.showToast("7桁の郵便番号を入力してください");
      return;
    }
    fetch("https://zipcloud.ibsnet.co.jp/api/search?zipcode=" + zip)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.results && data.results.length > 0) {
          var r = data.results[0];
          var address = r.address1 + r.address2 + r.address3;
          document.getElementById("prof-address").value = address;
          document.getElementById("prof-address").focus();
          FormUtils.showToast("住所を取得しました");
        } else {
          FormUtils.showToast("該当する住所が見つかりません");
        }
      })
      .catch(function () {
        FormUtils.showToast("住所検索に失敗しました");
      });
  }

  // === 電話番号フォーマット（自動ハイフン挿入） ===
  function formatPhone(el) {
    // 全角→半角変換
    var val = el.value.replace(/[０-９]/g, function (s) {
      return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
    }).replace(/[^0-9]/g, "");

    // 自動ハイフン挿入
    if (val.length <= 3) {
      el.value = val;
    } else if (val.startsWith("090") || val.startsWith("080") || val.startsWith("070") || val.startsWith("050")) {
      // 携帯・IP: 090-1234-5678
      if (val.length <= 7) {
        el.value = val.slice(0, 3) + "-" + val.slice(3);
      } else {
        el.value = val.slice(0, 3) + "-" + val.slice(3, 7) + "-" + val.slice(7, 11);
      }
    } else if (val.startsWith("0120") || val.startsWith("0800")) {
      // フリーダイヤル: 0120-123-456
      var prefix = val.startsWith("0120") ? 4 : 4;
      if (val.length <= 7) {
        el.value = val.slice(0, prefix) + "-" + val.slice(prefix);
      } else {
        el.value = val.slice(0, prefix) + "-" + val.slice(prefix, 7) + "-" + val.slice(7, 10);
      }
    } else {
      // 固定電話: 0X-XXXX-XXXX or 0XX-XXX-XXXX
      if (val.length <= 4) {
        el.value = val.slice(0, 2) + "-" + val.slice(2);
      } else if (val.length <= 8) {
        el.value = val.slice(0, 2) + "-" + val.slice(2, 6) + "-" + val.slice(6);
      } else {
        el.value = val.slice(0, 2) + "-" + val.slice(2, 6) + "-" + val.slice(6, 10);
      }
    }
  }

  // === メールドメイン選択 ===
  function onDomainChange(sel) {
    var custom = document.getElementById("prof-email-custom");
    if (sel.value === "__custom__") {
      custom.classList.remove("hidden");
      custom.focus();
    } else {
      custom.classList.add("hidden");
      custom.value = "";
    }
  }

  function getEmailFull() {
    var local = document.getElementById("prof-email-local").value.trim();
    if (!local) return "";
    var domainSel = document.getElementById("prof-email-domain").value;
    var domain = domainSel === "__custom__"
      ? document.getElementById("prof-email-custom").value.trim()
      : domainSel;
    if (!domain) return local;
    return local + "@" + domain;
  }

  function setEmailFromFull(email) {
    if (!email) return;
    var parts = email.split("@");
    document.getElementById("prof-email-local").value = parts[0] || "";
    if (parts[1]) {
      var domainSel = document.getElementById("prof-email-domain");
      var found = false;
      for (var i = 0; i < domainSel.options.length; i++) {
        if (domainSel.options[i].value === parts[1]) {
          domainSel.value = parts[1];
          found = true;
          break;
        }
      }
      if (!found) {
        domainSel.value = "__custom__";
        document.getElementById("prof-email-custom").classList.remove("hidden");
        document.getElementById("prof-email-custom").value = parts[1];
      }
    }
  }

  // === 銀行名検索（銀行くんAPI） ===
  var bankSearchTimer = null;
  var selectedBankCode = "";

  function searchBank(query) {
    clearTimeout(bankSearchTimer);
    var suggestEl = document.getElementById("bank-suggest");
    if (!query || query.length < 1) {
      suggestEl.classList.add("hidden");
      return;
    }
    bankSearchTimer = setTimeout(function () {
      fetch("https://bank.teraren.com/banks/search.json?name=" + encodeURIComponent(query))
        .then(function (r) { return r.json(); })
        .then(function (banks) {
          if (!banks || banks.length === 0) {
            suggestEl.classList.add("hidden");
            return;
          }
          var html = "";
          var list = banks.slice(0, 8);
          for (var i = 0; i < list.length; i++) {
            var fullName = (list[i].normalize && list[i].normalize.name) || list[i].name;
            html += '<div class="suggest-item" onclick="InvoiceApp.selectBank(\'' +
              list[i].code + '\',\'' + escapeHtml(fullName) + '\')">' +
              escapeHtml(fullName) +
              '<span class="suggest-code">' + list[i].code + '</span></div>';
          }
          suggestEl.innerHTML = html;
          suggestEl.classList.remove("hidden");
        })
        .catch(function () { suggestEl.classList.add("hidden"); });
    }, 300);
  }

  function selectBank(code, name) {
    selectedBankCode = code;
    document.getElementById("prof-bank-name").value = name;
    document.getElementById("prof-bank-code").value = code;
    document.getElementById("bank-suggest").classList.add("hidden");
    // 支店名にフォーカス
    document.getElementById("prof-branch-name").value = "";
    document.getElementById("prof-branch-code").value = "";
    document.getElementById("prof-branch-name").focus();
  }

  // === 支店名検索 ===
  var branchSearchTimer = null;

  function searchBranch(query) {
    clearTimeout(branchSearchTimer);
    var suggestEl = document.getElementById("branch-suggest");
    if (!query || query.length < 1 || !selectedBankCode) {
      suggestEl.classList.add("hidden");
      return;
    }
    branchSearchTimer = setTimeout(function () {
      fetch("https://bank.teraren.com/banks/" + selectedBankCode + "/branches/search.json?name=" + encodeURIComponent(query))
        .then(function (r) { return r.json(); })
        .then(function (branches) {
          if (!branches || branches.length === 0) {
            suggestEl.classList.add("hidden");
            return;
          }
          var html = "";
          var list = branches.slice(0, 8);
          for (var i = 0; i < list.length; i++) {
            var fullName = (list[i].normalize && list[i].normalize.name) || list[i].name;
            html += '<div class="suggest-item" onclick="InvoiceApp.selectBranch(\'' +
              list[i].code + '\',\'' + escapeHtml(fullName) + '\')">' +
              escapeHtml(fullName) +
              '<span class="suggest-code">' + list[i].code + '</span></div>';
          }
          suggestEl.innerHTML = html;
          suggestEl.classList.remove("hidden");
        })
        .catch(function () { suggestEl.classList.add("hidden"); });
    }, 300);
  }

  function selectBranch(code, name) {
    document.getElementById("prof-branch-name").value = name;
    document.getElementById("prof-branch-code").value = code;
    document.getElementById("branch-suggest").classList.add("hidden");
  }

  // === 口座番号フォーマット（全角→半角、数字のみ） ===
  function formatAccountNumber(el) {
    el.value = el.value.replace(/[０-９]/g, function (s) {
      return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
    }).replace(/[^0-9]/g, "");
  }

  // === 振込先データ組み立て ===
  function getBankInfoFull() {
    var bankName = document.getElementById("prof-bank-name").value.trim();
    var bankCode = document.getElementById("prof-bank-code").value.trim();
    var branchName = document.getElementById("prof-branch-name").value.trim();
    var branchCode = document.getElementById("prof-branch-code").value.trim();
    var accountType = document.getElementById("prof-account-type").value;
    var accountNumber = document.getElementById("prof-account-number").value.trim();
    var accountHolder = document.getElementById("prof-account-holder").value.trim();

    if (!bankName) return "";
    var parts = [bankName];
    if (bankCode) parts[0] += "（" + bankCode + "）";
    parts.push(branchName + (branchCode ? "（" + branchCode + "）" : ""));
    parts.push(accountType + " " + accountNumber);
    if (accountHolder) parts.push(accountHolder);
    return parts.join(" / ");
  }

  function setBankInfoFromFull(bankInfo) {
    // 既存の統合文字列からパースを試みる（完全な復元は難しいため簡易対応）
    if (!bankInfo) return;
    // 新形式: "銀行名（コード） / 支店名（コード） / 普通 1234567 / 名義"
    var parts = bankInfo.split(" / ");
    if (parts.length >= 3) {
      var bankMatch = parts[0].match(/^(.+?)(?:（(\d+)）)?$/);
      if (bankMatch) {
        document.getElementById("prof-bank-name").value = bankMatch[1];
        document.getElementById("prof-bank-code").value = bankMatch[2] || "";
        selectedBankCode = bankMatch[2] || "";
      }
      var branchMatch = parts[1].match(/^(.+?)(?:（(\d+)）)?$/);
      if (branchMatch) {
        document.getElementById("prof-branch-name").value = branchMatch[1];
        document.getElementById("prof-branch-code").value = branchMatch[2] || "";
      }
      var acctParts = parts[2].split(" ");
      if (acctParts.length >= 1) {
        var typeEl = document.getElementById("prof-account-type");
        for (var i = 0; i < typeEl.options.length; i++) {
          if (typeEl.options[i].value === acctParts[0]) {
            typeEl.value = acctParts[0];
            break;
          }
        }
      }
      if (acctParts.length >= 2) {
        document.getElementById("prof-account-number").value = acctParts[1];
      }
      if (parts[3]) {
        document.getElementById("prof-account-holder").value = parts[3];
      }
    }
  }

  // === ユーティリティ ===
  function showSpinner() {
    document.getElementById("spinner").classList.remove("hidden");
  }

  function hideSpinner() {
    document.getElementById("spinner").classList.add("hidden");
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // === DOM Ready ===
  document.addEventListener("DOMContentLoaded", init);

  // === Public API ===
  return {
    showProfile: showProfile,
    showCreate: showCreate,
    backToMain: backToMain,
    backToCreate: backToCreate,
    addItemRow: addItemRow,
    removeItem: removeItem,
    calcTotal: calcTotal,
    setTaxRate: setTaxRate,
    preview: preview,
    saveAsDraft: saveAsDraft,
    saveAndGenerate: saveAndGenerate,
    showDetail: showDetail,
    cycleStatus: cycleStatus,
    generatePdf: generatePdf,
    editInvoice: editInvoice,
    deleteInvoice: deleteInvoice,
    saveProfile: saveProfile,
    onClientZipInput: onClientZipInput,
    searchClientZip: searchClientZip,
    onIssueDateChange: onIssueDateChange,
    onZipInput: onZipInput,
    searchZip: searchZip,
    formatPhone: formatPhone,
    onDomainChange: onDomainChange,
    searchBank: searchBank,
    selectBank: selectBank,
    searchBranch: searchBranch,
    selectBranch: selectBranch,
    formatAccountNumber: formatAccountNumber
  };
})();
