/**
 * かんたん家計簿 IndexedDB レイヤー
 * DB名: kakeibo_db / Version: 2
 * Stores: transactions, budgets, settings, images, audit_log
 */
var KakeiboDB = (function () {
  "use strict";

  var DB_NAME = "kakeibo_db";
  var DB_VERSION = 2;
  var db = null;

  function open() {
    return new Promise(function (resolve, reject) {
      if (db) return resolve(db);
      var req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = function (e) {
        var d = e.target.result;

        // transactions store
        if (!d.objectStoreNames.contains("transactions")) {
          var txStore = d.createObjectStore("transactions", { keyPath: "id" });
          txStore.createIndex("date", "date", { unique: false });
          txStore.createIndex("category", "category", { unique: false });
        }

        // budgets store (key = "YYYY-MM_category")
        if (!d.objectStoreNames.contains("budgets")) {
          var budgetStore = d.createObjectStore("budgets", { keyPath: "id" });
          budgetStore.createIndex("month", "month", { unique: false });
        }

        // settings store
        if (!d.objectStoreNames.contains("settings")) {
          d.createObjectStore("settings", { keyPath: "key" });
        }

        // images store (電子帳簿保存法: レシート原本画像)
        if (!d.objectStoreNames.contains("images")) {
          var imgStore = d.createObjectStore("images", { keyPath: "id" });
          imgStore.createIndex("transactionId", "transactionId", { unique: false });
        }

        // audit_log store (電子帳簿保存法: 変更履歴・改ざん防止)
        if (!d.objectStoreNames.contains("audit_log")) {
          var auditStore = d.createObjectStore("audit_log", { keyPath: "id" });
          auditStore.createIndex("transactionId", "transactionId", { unique: false });
          auditStore.createIndex("timestamp", "timestamp", { unique: false });
        }
      };

      req.onsuccess = function (e) {
        db = e.target.result;
        resolve(db);
      };

      req.onerror = function () {
        reject(new Error("IndexedDB を開けませんでした"));
      };
    });
  }

  // === transactions ===
  function addTransaction(tx) {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("transactions", "readwrite");
        t.objectStore("transactions").put(tx);
        t.oncomplete = function () { resolve(tx); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function deleteTransaction(id) {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("transactions", "readwrite");
        t.objectStore("transactions").delete(id);
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function getTransaction(id) {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("transactions", "readonly");
        var req = t.objectStore("transactions").get(id);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function getAllTransactions() {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("transactions", "readonly");
        var req = t.objectStore("transactions").getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function getTransactionsByMonth(month) {
    return getAllTransactions().then(function (all) {
      return all.filter(function (tx) {
        return tx.date && tx.date.substring(0, 7) === month;
      });
    });
  }

  // === budgets ===
  function saveBudget(month, category, amount) {
    var id = month + "_" + category;
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("budgets", "readwrite");
        t.objectStore("budgets").put({ id: id, month: month, category: category, amount: amount });
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function getBudgetsByMonth(month) {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("budgets", "readonly");
        var store = t.objectStore("budgets");
        var idx = store.index("month");
        var req = idx.getAll(month);
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // === settings ===
  function setSetting(key, value) {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("settings", "readwrite");
        t.objectStore("settings").put({ key: key, value: value });
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function getSetting(key) {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("settings", "readonly");
        var req = t.objectStore("settings").get(key);
        req.onsuccess = function () { resolve(req.result ? req.result.value : null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // === images (電子帳簿保存法: レシート原本画像) ===
  function saveImage(transactionId, imageBase64, mimeType) {
    var id = "img_" + transactionId;
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("images", "readwrite");
        t.objectStore("images").put({
          id: id,
          transactionId: transactionId,
          imageBase64: imageBase64,
          mimeType: mimeType || "image/jpeg",
          savedAt: new Date().toISOString()
        });
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function getImage(transactionId) {
    var id = "img_" + transactionId;
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("images", "readonly");
        var req = t.objectStore("images").get(id);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function deleteImage(transactionId) {
    var id = "img_" + transactionId;
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("images", "readwrite");
        t.objectStore("images").delete(id);
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function getAllImages() {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("images", "readonly");
        var req = t.objectStore("images").getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // === audit_log (電子帳簿保存法: 変更履歴) ===
  function addAuditLog(entry) {
    entry.id = "audit_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
    entry.timestamp = new Date().toISOString();
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("audit_log", "readwrite");
        t.objectStore("audit_log").put(entry);
        t.oncomplete = function () { resolve(entry); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function getAuditLogByTransaction(transactionId) {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("audit_log", "readonly");
        var idx = t.objectStore("audit_log").index("transactionId");
        var req = idx.getAll(transactionId);
        req.onsuccess = function () {
          var results = req.result || [];
          results.sort(function (a, b) { return a.timestamp > b.timestamp ? 1 : -1; });
          resolve(results);
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function getAllAuditLogs() {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("audit_log", "readonly");
        var req = t.objectStore("audit_log").getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // === 検索 (電子帳簿保存法: 取引日・金額・取引先検索) ===
  function searchTransactions(query) {
    return getAllTransactions().then(function (all) {
      var results = all;

      // 取引先名で検索
      if (query.store) {
        var storeLower = query.store.toLowerCase();
        results = results.filter(function (tx) {
          var s = (tx.store || "").toLowerCase();
          var m = (tx.memo || "").toLowerCase();
          return s.indexOf(storeLower) !== -1 || m.indexOf(storeLower) !== -1;
        });
      }

      // 日付範囲で検索
      if (query.dateFrom) {
        results = results.filter(function (tx) { return tx.date >= query.dateFrom; });
      }
      if (query.dateTo) {
        results = results.filter(function (tx) { return tx.date <= query.dateTo; });
      }

      // 金額範囲で検索
      if (query.amountMin) {
        var min = parseInt(query.amountMin, 10);
        results = results.filter(function (tx) { return tx.total >= min; });
      }
      if (query.amountMax) {
        var max = parseInt(query.amountMax, 10);
        results = results.filter(function (tx) { return tx.total <= max; });
      }

      results.sort(function (a, b) { return b.date > a.date ? 1 : b.date < a.date ? -1 : 0; });
      return results;
    });
  }

  // === エクスポート / インポート ===
  function exportAll(includeImages) {
    return open().then(function (d) {
      var storeNames = ["transactions", "budgets", "settings", "audit_log"];
      if (includeImages) storeNames.push("images");

      var promises = [];
      for (var i = 0; i < storeNames.length; i++) {
        promises.push((function (name) {
          return new Promise(function (res, rej) {
            var r = d.transaction(name, "readonly").objectStore(name).getAll();
            r.onsuccess = function () { res(r.result || []); };
            r.onerror = function () { rej(r.error); };
          });
        })(storeNames[i]));
      }

      return Promise.all(promises).then(function (results) {
        var data = {
          version: 2,
          exportedAt: new Date().toISOString(),
          transactions: results[0],
          budgets: results[1],
          settings: results[2],
          audit_log: results[3]
        };
        if (includeImages) {
          data.images = results[4];
        }
        return data;
      });
    });
  }

  function importAll(data) {
    if (!data || !data.transactions) {
      return Promise.reject(new Error("無効なデータ形式です"));
    }
    return open().then(function (d) {
      var storeNames = ["transactions", "budgets", "settings"];
      if (data.audit_log) storeNames.push("audit_log");
      if (data.images) storeNames.push("images");

      return new Promise(function (resolve, reject) {
        var t = d.transaction(storeNames, "readwrite");

        // 復元前に既存データをクリア
        for (var s = 0; s < storeNames.length; s++) {
          t.objectStore(storeNames[s]).clear();
        }

        var txStore = t.objectStore("transactions");
        var txList = data.transactions || [];
        for (var i = 0; i < txList.length; i++) { txStore.put(txList[i]); }

        var budgetStore = t.objectStore("budgets");
        var budgetList = data.budgets || [];
        for (var j = 0; j < budgetList.length; j++) { budgetStore.put(budgetList[j]); }

        var settingsStore = t.objectStore("settings");
        var settingsList = data.settings || [];
        for (var k = 0; k < settingsList.length; k++) { settingsStore.put(settingsList[k]); }

        if (data.audit_log) {
          var auditStore = t.objectStore("audit_log");
          for (var a = 0; a < data.audit_log.length; a++) { auditStore.put(data.audit_log[a]); }
        }

        if (data.images) {
          var imgStore = t.objectStore("images");
          for (var m = 0; m < data.images.length; m++) { imgStore.put(data.images[m]); }
        }

        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function clearAll() {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(["transactions", "budgets", "settings", "images", "audit_log"], "readwrite");
        t.objectStore("transactions").clear();
        t.objectStore("budgets").clear();
        t.objectStore("settings").clear();
        t.objectStore("images").clear();
        t.objectStore("audit_log").clear();
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  return {
    open: open,
    addTransaction: addTransaction,
    deleteTransaction: deleteTransaction,
    getTransaction: getTransaction,
    getAllTransactions: getAllTransactions,
    getTransactionsByMonth: getTransactionsByMonth,
    saveBudget: saveBudget,
    getBudgetsByMonth: getBudgetsByMonth,
    setSetting: setSetting,
    getSetting: getSetting,
    saveImage: saveImage,
    getImage: getImage,
    deleteImage: deleteImage,
    getAllImages: getAllImages,
    addAuditLog: addAuditLog,
    getAuditLogByTransaction: getAuditLogByTransaction,
    getAllAuditLogs: getAllAuditLogs,
    searchTransactions: searchTransactions,
    exportAll: exportAll,
    importAll: importAll,
    clearAll: clearAll
  };
})();
