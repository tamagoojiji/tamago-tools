# たまごツール セキュリティテンプレート

## 概要
全アプリ共通のセキュリティ実装パターン。新規アプリ開発時はこのテンプレートに従う。

## 適用済みアプリ
- かんたん家計簿（kakeibo）
- 請求書ツール（invoice）← 適用予定

---

## 1. APIキー認証

### GAS側（main.js）
```javascript
var APP_API_KEY = PropertiesService.getScriptProperties().getProperty("APP_API_KEY");

function validateApiKey(key) {
  if (!APP_API_KEY) return true; // 未設定時は後方互換でスキップ
  return key === APP_API_KEY;
}

// doGet
function doGet(e) {
  var action = e.parameter.action || "";
  if (action !== "status" && !validateApiKey(e.parameter.apiKey || "")) {
    return jsonResponse({ ok: false, error: "unauthorized" });
  }
  // ...
}

// doPost
function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  var action = body.action || "";
  if (action.indexOf("admin_") !== 0 && !validateApiKey(body.apiKey || "")) {
    return jsonResponse({ ok: false, error: "unauthorized" });
  }
  // ...
}
```

### フロント側（app.js）
```javascript
var API_KEY = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

// POST
fetch(GAS_URL, {
  method: "POST",
  body: JSON.stringify({ action: "xxx", apiKey: API_KEY, ... })
});

// GET
fetch(GAS_URL + "?action=xxx&apiKey=" + API_KEY + "&...");
```

### セットアップ
```bash
# APIキー生成
openssl rand -hex 24

# GASエディタ → プロジェクトの設定 → スクリプトプロパティ
# APP_API_KEY = 生成した値
```

### 注意点
- SPA+GASアーキテクチャではフロントにキーを埋め込む（DevToolsで見える）
- カジュアルプロテクション（ボット・総当たり防止）として割り切る
- 将来的にLINE認証等と組み合わせて強化可能

---

## 2. email+PIN認証（バックアップ用）

### 概要
- lookupKey = SHA-256(email + pin)
- emailHash = SHA-256(email)（PINリセット用）
- サーバーにはハッシュ値のみ保存（平文は保存しない）

### フロント側（SHA-256生成）
```javascript
function sha256(message) {
  var encoder = new TextEncoder();
  var data = encoder.encode(message);
  return crypto.subtle.digest("SHA-256", data).then(function (buffer) {
    var hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  });
}

// バックアップ保存時
Promise.all([sha256(email + pin), sha256(email)]).then(function (hashes) {
  var lookupKey = hashes[0];
  var emailHash = hashes[1];
  // GASに送信
});
```

### GAS側（SHA-256生成）
```javascript
function computeSha256(input) {
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
  var hex = "";
  for (var i = 0; i < rawHash.length; i++) {
    var b = rawHash[i] < 0 ? rawHash[i] + 256 : rawHash[i];
    hex += (b < 16 ? "0" : "") + b.toString(16);
  }
  return hex;
}
```

### スプレッドシート構造（backups シート）
| lookupKey | emailHash | data | updatedAt |

---

## 3. PINリセット（タイミング攻撃防止）

### パターン
```javascript
function requestPinReset(email) {
  var startTime = new Date().getTime();
  var MIN_DURATION_MS = 3000;
  try {
    if (!email) return { ok: true, message: "リセットコードをメールに送信しました" };
    // ... hash, search, generate code, send email ...
  } catch (err) {
    Logger.log("PINリセット処理エラー: " + err.message);
  } finally {
    var elapsed = new Date().getTime() - startTime;
    if (elapsed < MIN_DURATION_MS) {
      Utilities.sleep(MIN_DURATION_MS - elapsed);
    }
  }
  return { ok: true, message: "リセットコードをメールに送信しました" };
}
```

### ポイント
- try-finally で全パス（成功・失敗・例外）で同一時間を保証
- レスポンスメッセージも全パスで同一（存在確認防止）
- MIN_DURATION_MS = 3000（メール送信にかかる時間を考慮）

---

## 4. 監査ログ（電子帳簿保存法対応）

### IndexedDB（フロント）
```javascript
// audit_log ストア
{
  id: "auto-increment",
  transactionId: "取引ID",
  action: "create | update | delete",
  inputType: "manual | ocr",
  snapshot: { /* 変更前の全データ */ },
  timestamp: "ISO 8601"
}
```

### GAS側（audit_log シート）
| id | userId | transactionId | action | snapshot | serverTimestamp |

### ルール
- create: 新規作成時のスナップショット
- update: 変更前のスナップショット
- delete: 削除前のスナップショット
- 物理削除禁止 → 論理削除（deleted フラグ）のみ

---

## 5. 論理削除（soft delete）

### パターン
```javascript
// 削除時
function deleteRecord(id) {
  // 監査ログに記録
  addAuditLog({ id: id, action: "delete", snapshot: currentData });
  // deleted フラグを立てる（物理削除しない）
  record.deleted = true;
  record.deletedAt = new Date().toISOString();
}

// 一覧取得時はフィルタ
var activeRecords = allRecords.filter(function(r) { return !r.deleted; });
```

---

## 6. 画像の改ざん防止

### ルール
- 保存済み画像の上書き・差し替え禁止
- 新しい画像は新規レコードとして保存
- 画像削除は論理削除のみ（Driveからは消さない）

---

## 7. 検索機能（電子帳簿保存法）

### 必須検索条件
1. 取引年月日（範囲指定可能）
2. 取引金額（範囲指定可能）
3. 取引先
4. 2項目以上の組み合わせ検索

---

## 8. バックアップ運用（ハイブリッド型）

### クラウド保存
- 保存期間: 15ヶ月（翌年3月末まで）
- 画像: Google Drive に保存
- テキストデータ: Googleスプレッドシート

### 月次メール
- 毎月1日にGASトリガーで自動送信
- テキストデータ（JSON）をメール添付
- 画像はDrive上のリンクを記載

### 年次処理（3月）
- 3月20日頃: 「データ削除予定」通知メール送信
- 3月31日: 前々年分のデータをスプレッドシートから削除
- Drive上の画像は削除しない（容量に余裕がある限り）

---

## 9. プライバシーポリシー

全アプリ共通: `tamago-tools/privacy.html`
- 各アプリの設定画面からリンク
- データ保存場所・AI処理・削除方法を明記

---

## 新規アプリへの適用手順

1. GASに `APP_API_KEY` を Script Properties に設定
2. GAS の doGet/doPost に `validateApiKey` を追加
3. フロントに API_KEY を埋め込み、全リクエストに付与
4. バックアップが必要なら email+PIN 認証を追加
5. 監査ログ（audit_log）テーブル/ストアを作成
6. 削除は論理削除のみに統一
7. 検索機能を実装（日付・金額・取引先）
8. privacy.html にアプリ名を追加
