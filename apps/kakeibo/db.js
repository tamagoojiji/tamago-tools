/**
 * かんたん家計簿 IndexedDB レイヤー
 * DB名: kakeibo_db / Version: 1
 * Stores: transactions, budgets, settings
 */
var KakeiboDB = (function () {
  "use strict";

  var DB_NAME = "kakeibo_db";
  var DB_VERSION = 1;
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
    // month: "YYYY-MM"
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

  // === エクスポート / インポート ===
  function exportAll() {
    return open().then(function (d) {
      return Promise.all([
        new Promise(function (res, rej) {
          var r = d.transaction("transactions", "readonly").objectStore("transactions").getAll();
          r.onsuccess = function () { res(r.result || []); };
          r.onerror = function () { rej(r.error); };
        }),
        new Promise(function (res, rej) {
          var r = d.transaction("budgets", "readonly").objectStore("budgets").getAll();
          r.onsuccess = function () { res(r.result || []); };
          r.onerror = function () { rej(r.error); };
        }),
        new Promise(function (res, rej) {
          var r = d.transaction("settings", "readonly").objectStore("settings").getAll();
          r.onsuccess = function () { res(r.result || []); };
          r.onerror = function () { rej(r.error); };
        })
      ]).then(function (results) {
        return {
          version: 1,
          exportedAt: new Date().toISOString(),
          transactions: results[0],
          budgets: results[1],
          settings: results[2]
        };
      });
    });
  }

  function importAll(data) {
    if (!data || !data.transactions) {
      return Promise.reject(new Error("無効なデータ形式です"));
    }
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(["transactions", "budgets", "settings"], "readwrite");

        // transactions
        var txStore = t.objectStore("transactions");
        (data.transactions || []).forEach(function (tx) { txStore.put(tx); });

        // budgets
        var budgetStore = t.objectStore("budgets");
        (data.budgets || []).forEach(function (b) { budgetStore.put(b); });

        // settings
        var settingsStore = t.objectStore("settings");
        (data.settings || []).forEach(function (s) { settingsStore.put(s); });

        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function clearAll() {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(["transactions", "budgets", "settings"], "readwrite");
        t.objectStore("transactions").clear();
        t.objectStore("budgets").clear();
        t.objectStore("settings").clear();
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
    exportAll: exportAll,
    importAll: importAll,
    clearAll: clearAll
  };
})();
