/**
 * 請求書ツール フロントエンド
 */
var InvoiceApp = (function () {
  "use strict";

  var GAS_URL = "https://script.google.com/macros/s/AKfycbyQEYHQP1Ckyh58CC2xcIxIzKukX-PEOXgoqkKiAzPBaV3Io1avF1o1kVT3wRgTHEl7eA/exec";

  var userId = null;
  var currentTaxRate = 10;
  var editingInvoiceId = null;
  var currentInvoice = null;
  var cachedProfile = null;
  var itemCounter = 0;

  // === 初期化 ===
  function init() {
    userId = FormUtils.getUserId();
    setDefaultDates();
    addItemRow();
    loadInvoices();
    loadProfile();
  }

  function setDefaultDates() {
    var today = new Date();
    var yyyy = today.getFullYear();
    var mm = ("0" + (today.getMonth() + 1)).slice(-2);
    var dd = ("0" + today.getDate()).slice(-2);
    document.getElementById("inv-issue-date").value = yyyy + "-" + mm + "-" + dd;

    // 支払期限: 翌月末
    var nextMonth = new Date(today.getFullYear(), today.getMonth() + 2, 0);
    var ny = nextMonth.getFullYear();
    var nm = ("0" + (nextMonth.getMonth() + 1)).slice(-2);
    var nd = ("0" + nextMonth.getDate()).slice(-2);
    document.getElementById("inv-due-date").value = ny + "-" + nm + "-" + nd;
  }

  // === タブ切替 ===
  function switchTab(tabId, btn) {
    var tabs = document.querySelectorAll(".tab-content");
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.add("hidden");
    document.getElementById("tab-" + tabId).classList.remove("hidden");

    var btns = document.querySelectorAll(".tab-btn");
    for (var j = 0; j < btns.length; j++) btns[j].classList.remove("active");
    if (btn) btn.classList.add("active");
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
        '<div class="item-name-field">' +
          '<label>品名</label>' +
          '<input type="text" id="item-name-' + idx + '" placeholder="例：Webサイト制作" value="' + ((item && item.name) || '') + '" oninput="InvoiceApp.calcTotal()">' +
        '</div>' +
        '<div>' +
          '<label>数量</label>' +
          '<input type="number" id="item-qty-' + idx + '" value="' + ((item && item.quantity) || 1) + '" min="1" oninput="InvoiceApp.calcTotal()">' +
        '</div>' +
        '<div>' +
          '<label>単位</label>' +
          '<input type="text" id="item-unit-' + idx + '" value="' + ((item && item.unit) || '式') + '" placeholder="式">' +
        '</div>' +
        '<div>' +
          '<label>単価</label>' +
          '<input type="number" id="item-price-' + idx + '" value="' + ((item && item.unitPrice) || '') + '" placeholder="0" oninput="InvoiceApp.calcTotal()">' +
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
      if (name || price > 0) {
        items.push({
          name: name,
          quantity: qty,
          unit: unit,
          unitPrice: price,
          amount: qty * price
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
    document.getElementById("inv-client-address").value = "";
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

    document.getElementById("prev-number").textContent = editingInvoiceId ? "(既存)" : "(保存時に自動採番)";
    document.getElementById("prev-dates").textContent = "発行: " + issueDate + " / 期限: " + dueDate;
    document.getElementById("prev-client").textContent = client + " 御中";
    document.getElementById("prev-client-address").textContent = document.getElementById("inv-client-address").value;

    document.getElementById("prev-total").textContent = "¥" + total.toLocaleString();
    document.getElementById("prev-subtotal").textContent = "¥" + subtotal.toLocaleString();
    document.getElementById("prev-tax").textContent = "¥" + taxAmount.toLocaleString() + "（" + currentTaxRate + "%）";
    document.getElementById("prev-total2").textContent = "¥" + total.toLocaleString();

    // 品目テーブル
    var tbody = document.getElementById("prev-items");
    tbody.innerHTML = "";
    for (var j = 0; j < items.length; j++) {
      var tr = document.createElement("tr");
      tr.innerHTML =
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
      clientAddress: document.getElementById("inv-client-address").value.trim(),
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
    if (!GAS_URL) {
      FormUtils.showToast("GAS URLが未設定です");
      return;
    }
    showSpinner();
    var data = buildInvoiceData();
    data.status = "draft";

    gasPostJson({ action: "save", userId: userId, invoice: data })
      .then(function (res) {
        hideSpinner();
        if (res.ok) {
          FormUtils.showToast("下書き保存しました");
          backToMain();
        } else {
          FormUtils.showToast("エラー: " + (res.error || "保存失敗"));
        }
      })
      .catch(function () {
        hideSpinner();
        FormUtils.showToast("通信エラー");
      });
  }

  function saveAndGenerate() {
    if (!GAS_URL) {
      FormUtils.showToast("GAS URLが未設定です");
      return;
    }
    showSpinner();
    var data = buildInvoiceData();
    data.status = "draft";

    gasPostJson({ action: "save", userId: userId, invoice: data })
      .then(function (res) {
        if (res.ok) {
          // PDF生成
          return gasPostJson({ action: "generatePdf", userId: userId, id: res.id });
        } else {
          throw new Error(res.error || "保存失敗");
        }
      })
      .then(function (res) {
        hideSpinner();
        if (res.ok) {
          FormUtils.showToast("PDF作成完了");
          window.open(res.pdfUrl, "_blank");
          backToMain();
        } else {
          FormUtils.showToast("PDF作成エラー: " + (res.error || ""));
          backToMain();
        }
      })
      .catch(function (err) {
        hideSpinner();
        FormUtils.showToast("エラー: " + err.message);
      });
  }

  // === 一覧読み込み ===
  function loadInvoices() {
    if (!GAS_URL) {
      document.getElementById("invoice-list").innerHTML =
        '<div class="empty-state"><div class="empty-state-icon">📄</div>' +
        '<div class="empty-state-text">GAS URLが未設定です</div></div>';
      return;
    }

    FormUtils.gasGet(GAS_URL, { action: "list", userId: userId })
      .then(function (res) {
        if (res.ok) {
          renderInvoiceList(res.invoices);
        }
      })
      .catch(function () {
        document.getElementById("invoice-list").innerHTML =
          '<div class="empty-state"><div class="empty-state-icon">⚠️</div>' +
          '<div class="empty-state-text">読み込みエラー</div></div>';
      });
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
    if (!GAS_URL) return;
    showSpinner();

    FormUtils.gasGet(GAS_URL, { action: "get", userId: userId, id: id })
      .then(function (res) {
        hideSpinner();
        if (res.ok) {
          currentInvoice = res.invoice;
          renderDetail(res.invoice);
          FormUtils.showScreen("detail-screen");
        } else {
          FormUtils.showToast("取得エラー");
        }
      })
      .catch(function () {
        hideSpinner();
        FormUtils.showToast("通信エラー");
      });
  }

  function renderDetail(inv) {
    document.getElementById("detail-title").textContent = inv.invoiceNumber;

    var items = inv.items || [];
    var itemRows = "";
    for (var i = 0; i < items.length; i++) {
      itemRows +=
        "<tr><td>" + escapeHtml(items[i].name) + "</td>" +
        "<td>" + items[i].quantity + " " + escapeHtml(items[i].unit || "") + "</td>" +
        "<td>¥" + Number(items[i].unitPrice).toLocaleString() + "</td>" +
        "<td>¥" + Number(items[i].amount).toLocaleString() + "</td></tr>";
    }

    var statusText = inv.status === "draft" ? "下書き" : inv.status === "sent" ? "送付済" : "入金済";
    var statusClass = "status-" + inv.status;

    document.getElementById("detail-preview").innerHTML =
      '<div class="preview-meta">' +
        '<span>発行: ' + inv.issueDate + '</span>' +
        '<span class="status-badge ' + statusClass + '">' + statusText + '</span>' +
      '</div>' +
      '<div class="preview-client">' + escapeHtml(inv.clientName) + ' 御中</div>' +
      (inv.clientAddress ? '<div style="font-size:13px;color:var(--text-light);margin-bottom:12px;">' + escapeHtml(inv.clientAddress) + '</div>' : '') +
      '<div class="preview-total-box">' +
        '<div class="preview-total-label">ご請求金額</div>' +
        '<div class="preview-total-amount">¥' + Number(inv.total).toLocaleString() + '</div>' +
      '</div>' +
      '<table class="preview-table"><thead><tr><th>品目</th><th>数量</th><th>単価</th><th>金額</th></tr></thead>' +
      '<tbody>' + itemRows + '</tbody></table>' +
      '<div class="amount-summary">' +
        '<div class="amount-row"><span>小計</span><span>¥' + Number(inv.subtotal).toLocaleString() + '</span></div>' +
        '<div class="amount-row"><span>消費税（' + inv.taxRate + '%）</span><span>¥' + Number(inv.taxAmount).toLocaleString() + '</span></div>' +
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

    showSpinner();
    gasPostJson({ action: "updateStatus", userId: userId, id: currentInvoice.id, status: nextStatus })
      .then(function (res) {
        hideSpinner();
        if (res.ok) {
          currentInvoice.status = nextStatus;
          renderDetail(currentInvoice);
          FormUtils.showToast("ステータスを更新しました");
        } else {
          FormUtils.showToast("エラー: " + (res.error || ""));
        }
      })
      .catch(function () {
        hideSpinner();
        FormUtils.showToast("通信エラー");
      });
  }

  // === PDF生成 ===
  function generatePdf() {
    if (!currentInvoice) return;
    showSpinner();

    gasPostJson({ action: "generatePdf", userId: userId, id: currentInvoice.id })
      .then(function (res) {
        hideSpinner();
        if (res.ok) {
          FormUtils.showToast("PDF作成完了");
          var linkArea = document.getElementById("pdf-link-area");
          linkArea.classList.remove("hidden");
          document.getElementById("pdf-download-link").href = res.pdfUrl;
        } else {
          FormUtils.showToast("PDF作成エラー: " + (res.error || ""));
        }
      })
      .catch(function () {
        hideSpinner();
        FormUtils.showToast("通信エラー");
      });
  }

  // === 編集 ===
  function editInvoice() {
    if (!currentInvoice) return;
    clearForm();
    editingInvoiceId = currentInvoice.id;

    document.getElementById("inv-client").value = currentInvoice.clientName || "";
    document.getElementById("inv-client-address").value = currentInvoice.clientAddress || "";
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
    currentTaxRate = currentInvoice.taxRate || 10;
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

    showSpinner();
    gasPostJson({ action: "delete", userId: userId, id: currentInvoice.id })
      .then(function (res) {
        hideSpinner();
        if (res.ok) {
          FormUtils.showToast("削除しました");
          backToMain();
        } else {
          FormUtils.showToast("エラー: " + (res.error || ""));
        }
      })
      .catch(function () {
        hideSpinner();
        FormUtils.showToast("通信エラー");
      });
  }

  // === プロフィール ===
  function loadProfile() {
    if (!GAS_URL) return;
    FormUtils.gasGet(GAS_URL, { action: "profile", userId: userId })
      .then(function (res) {
        if (res.ok && res.profile) {
          cachedProfile = res.profile;
          document.getElementById("prof-name").value = res.profile.businessName || "";
          document.getElementById("prof-address").value = res.profile.businessAddress || "";
          document.getElementById("prof-phone").value = res.profile.phone || "";
          document.getElementById("prof-email").value = res.profile.email || "";
          document.getElementById("prof-bank").value = res.profile.bankInfo || "";
          document.getElementById("prof-reg").value = res.profile.registrationNumber || "";
        }
      })
      .catch(function () {});
  }

  function saveProfile() {
    if (!GAS_URL) {
      FormUtils.showToast("GAS URLが未設定です");
      return;
    }
    var profile = {
      businessName: document.getElementById("prof-name").value.trim(),
      businessAddress: document.getElementById("prof-address").value.trim(),
      phone: document.getElementById("prof-phone").value.trim(),
      email: document.getElementById("prof-email").value.trim(),
      bankInfo: document.getElementById("prof-bank").value.trim(),
      registrationNumber: document.getElementById("prof-reg").value.trim()
    };

    showSpinner();
    gasPostJson({ action: "saveProfile", userId: userId, profile: profile })
      .then(function (res) {
        hideSpinner();
        if (res.ok) {
          cachedProfile = profile;
          FormUtils.showToast("保存しました");
        } else {
          FormUtils.showToast("エラー: " + (res.error || ""));
        }
      })
      .catch(function () {
        hideSpinner();
        FormUtils.showToast("通信エラー");
      });
  }

  // === ユーティリティ ===
  function gasPostJson(data) {
    return fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(data)
    })
    .then(function (r) { return r.text(); })
    .then(function (text) {
      try { return JSON.parse(text); }
      catch (e) { return { ok: false, error: "レスポンス解析エラー" }; }
    });
  }

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
    switchTab: switchTab,
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
    saveProfile: saveProfile
  };
})();
