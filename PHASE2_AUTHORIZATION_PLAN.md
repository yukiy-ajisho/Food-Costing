# Phase 2: Authorization & Sharing Implementation Plan

## 概要

Phase 2 では、RBAC（Role-Based Access Control）と ABAC（Attribute-Based Access Control）を Cedar Policy Language を使用して実装します。これにより、柔軟で拡張可能な認可システムを構築します。

---

## 1. 核心理解

### Cedar の役割

- **Cedar = 認可（Authorization）エンジン**
- バックエンド（API 側）に組み込む
- 一度「配線（コア実装）」ができたら、基本は`policies.cedar`にルールを追加・変更していく
- ルールは`.cedar`ファイルに書く（JSON ではない）
- `schema.json`は「属性（attributes）が何か」を定義する型・設計書で、頻繁には変えない

### RBAC + ABAC の設計方針

- **最初から一緒に設計することを推奨**
- 後から ABAC を足すより、最初から境界（org/owner）を入れた方が混乱が少ない
- RBAC = "誰（役職）か"
- ABAC = "どの条件なら OK か"

---

## 2. Cedar の基本構造

### 評価の質問（毎回）

Cedar が毎回評価する質問はこれだけ：

```
Principal（誰が） が
Action（何をする） を
Resource（何に対して）
Context（状況） のもとで
許可されるか？（Allow / Deny）
```

### 各要素の定義

- **Principal** = ユーザー（User）
- **Action** = `read` / `update` / `delete` / `approve` などの操作
- **Resource** = `project` / `document` / `transaction` など対象データ
- **Context** = 時間・IP・金額など状況（必要なら）

---

## 3. 実装アーキテクチャ

### ツール・ライブラリ

- ✅ **ダウンロードして動かすサーバーを立てる必要はない**（Cedar はライブラリとして使える）
- ✅ **コードは少し書く**（認可チェック関数 / middleware）
- ✅ **バックエンドに 1 つの認可関数 or middleware を追加するのが基本**
- ❌ **React コンポーネントで認可をやるのは NG**（UI の表示制御はしても、最終判断はバックエンド）
- ✅ **API の各処理の直前で Cedar を呼ぶ**（DB 更新・閲覧の前）

### 実装場所

- 認可チェックは**バックエンド（Express.js）**で実装
- UI（React）では表示制御のみ（最終判断はバックエンド）

---

## 4. 最小構成ファイル

### ディレクトリ構造

```
/src/authz
  ├─ schema.json      ← エンティティと属性の型定義（UserやResourceの属性）
  ├─ policies.cedar   ← ルール本体（permit/forbidを書く）
  └─ authorize.ts     ← Cedarを呼ぶ関数（allow/deny判定）
```

### 各ファイルの役割

#### schema.json

- User/Resource が持つ属性（`group`/`accessLevel`/`orgId`/`ownerId`など）を「宣言」
- 頻繁には変えない（属性が増えた時だけ更新）

#### policies.cedar

- 許可条件（RBAC/ABAC）を書く場所
- **ここを育てていく**（ルール追加・変更の主な場所）

#### authorize.ts

- `authorize(user, action, resource, context)` みたいな関数で Cedar を呼び出すだけ
- 基本固定（あまり変更しない）

---

## 5. 初期実装戦略

### ルールがゼロでも導入できる

- ルールがゼロなら**全部 Deny（拒否）**になる（デフォルト拒否 = 安全）
- だから最初は「配線だけ」して、後からルール追加でも OK

### ロックアウト防止の推奨

実務では、ロックアウト防止のためにまず"Admin だけ全部 OK"の逃げ道ルールを 1 つ入れるのがおすすめ：

```cedar
permit (principal, action, resource)
when { principal.accessLevel >= 100 };
```

---

## 6. ルール追加の流れ

### 変更の頻度

- **ほとんどの変更は`policies.cedar`（ルール）で起きる**
- **たまに`schema.json`を更新する**（新しい属性を使いたい時）
- **`authorize.ts`や API コードは基本増えない**
  → これが Cedar の強み：ビジネスが増えても if/else が増えない

---

## 7. 2 層構造の理解（重要）

### 正しい分離

#### レイヤー 1：開発者が作るもの（固定）

- **Cedar ポリシー（ルール）**
- 「権限という仕組みがどう働くか」を決める"法律"

#### レイヤー 2：管理者が変えるもの（データ）

- **DB にある役職・アクセスレベル・権限リストなどの"割り当て"**
- **管理者 UI で変えるのはルールではなくデータ**

### 重要なポイント

- **管理者はルールを編集しているわけではない**
- 管理者は**permission（権限）をデータとして持っていて**、UI で`role ↔ permission`の紐付けを変更している

### 構造の例

```
開発者が固定で用意したCedarルールが
「ユーザーのpermissionsにactionが含まれるなら許可」と決めている

管理者はDBの"permissions"を変えるだけ
```

---

## 8. RBAC vs ABAC

### RBAC（役職ベース）

- 「Manager は approve できる」みたいに**役職でざっくり決める**
- 強いが、細かい条件を入れたくなると役職が増殖する（ロール爆発）

### ABAC（属性ベース）

- 「同じ組織」「owner」「金額 < 5000」「営業時間だけ」など
- **ユーザー/リソース/状況の属性の比較で決める**

### 例

```
「managerがapproveできる。ただし同じorgで、pendingで、5000未満」
→ これがABAC的な発想
```

### Cedar の強み

- **RBAC（role/permission）+ ABAC（owner/org/time など）を同じ場所で扱える**

---

## 9. Phase 2 の実装内容（Three Pillars）

### Pillar 1: Isolation（テナント間の分離）

- **Phase 1a で既に実装済み**
- デフォルトでテナント間のデータは分離

### Pillar 2: RBAC（ロールベースアクセス制御）

#### ロール定義

- `admin`: 全操作可能
- `manager`: 一部操作可能（財務情報の閲覧・編集可能）
- `staff`: 読み取り中心（財務フィールドを非表示）

#### 実装内容

- 各ロールに応じた権限制御
- **Staff ロール**: 財務フィールド（`unit_cost`, `margin`など）を API レスポンスから削除
- 各 API エンドポイントで Cedar を使用してアクセス制御

### Pillar 3: ABAC（属性ベースアクセス制御）

#### 共有機能

- Vendors が`vendor_items`を Restaurants と共有
- `resource_shares`テーブルで管理

#### 除外機能

- `is_exclusion`フラグ（Boolean）
- `TRUE`の場合、Cedar FORBID として機能し、permit を上書き

#### target_type

- `tenant`: テナント全体に共有/除外
- `role`: 特定のロールに共有/除外
- `user`: 特定のユーザーに共有/除外

---

## 10. データベーススキーマ（Phase 2 で追加）

### resource_shares テーブル

```sql
CREATE TABLE resource_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type text NOT NULL, -- 'vendor_item', 'base_item', etc.
  resource_id uuid NOT NULL,
  owner_tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('tenant', 'role', 'user')),
  target_id uuid, -- tenant_id, role名, user_id
  is_exclusion boolean DEFAULT false, -- TRUE = FORBID（permitを上書き）
  show_history_to_shared boolean DEFAULT false, -- 価格履歴の可視性
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### history_logs テーブル

```sql
CREATE TABLE history_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  action text NOT NULL, -- 'create', 'update', 'delete'
  changed_fields jsonb, -- 変更されたフィールドと値
  changed_by uuid NOT NULL REFERENCES users(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  visibility text NOT NULL CHECK (visibility IN ('internal', 'shared')),
  created_at timestamptz DEFAULT now()
);
```

---

## 11. 実装手順（推奨）

### Step 1: Cedar の基本セットアップ

1. `@cedar-policy/cedar-wasm`をインストール
2. `schema.json`を作成（User、Resource の属性を定義）
3. `policies.cedar`を作成（初期ルール：Admin だけ全部 OK）
4. `authorize.ts`を作成（Cedar 呼び出し関数）

### Step 2: RBAC の実装

1. `profiles`テーブルの`role`を使用
2. `policies.cedar`に RBAC ルールを追加
3. 各 API エンドポイントで認可チェックを追加
4. Staff ロールの場合、財務フィールドをレスポンスから削除

### Step 3: ABAC の実装

1. `resource_shares`テーブルを作成
2. `policies.cedar`に ABAC ルールを追加（owner、org、is_exclusion など）
3. 共有機能の API エンドポイントを実装
4. 除外機能の実装（is_exclusion = TRUE の場合の FORBID）

### Step 4: 履歴管理の実装

1. `history_logs`テーブルを作成
2. 各 CRUD 操作で履歴を記録
3. `show_history_to_shared`フラグに基づいて履歴の可視性を制御

---

## 12. 重要な注意点

### 管理者 UI の役割

- **管理者はルール（policies.cedar）を編集しない**
- **管理者はデータ（permissions、role の割り当てなど）を変更する**
- 管理者 UI で`role ↔ permission`の紐付けを変更

### セキュリティ

- **デフォルト拒否（Deny）**が基本
- 明示的に許可（permit）したものだけ許可
- 除外（forbid）は許可（permit）を上書き

### 拡張性

- ビジネス要件が増えても、if/else が増えない
- `policies.cedar`にルールを追加するだけ
- `schema.json`は属性が増えた時だけ更新

---

## 13. 参考リソース

- Cedar Policy Language: https://www.cedar-policy.org/
- @cedar-policy/cedar-wasm: npm package
- AWS Cedar Documentation: https://docs.aws.amazon.com/cedar/

---

## 14. 次のステップ

1. Cedar の基本セットアップ（schema.json、policies.cedar、authorize.ts）
2. RBAC の実装（role ベースのアクセス制御）
3. ABAC の実装（属性ベースのアクセス制御、共有・除外機能）
4. 履歴管理の実装（history_logs）
5. 管理者 UI の実装（権限の割り当て管理）
