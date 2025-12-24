# Implementation Plan: Phase 1a & 1b Refactoring

## 概要

このドキュメントは、Phase 1a（Multi-Tenant Identity Layer）とPhase 1b（Virtual Product Decoupling）の実装計画を詳しく説明します。

---

## Phase 1a: Multi-Tenant Identity Layer

### 1. データベーススキーマの変更

#### 1.1 新規テーブル作成

**tenants テーブル**
- 目的: 組織（レストラン/ベンダー）を表現
- カラム:
  - `id`: uuid (PK, 自動生成)
  - `name`: text (NOT NULL) - 組織名
  - `type`: text (CHECK: 'restaurant' or 'vendor')
  - `created_at`: timestamptz
- インデックス: `id` にPRIMARY KEY

**profiles テーブル**
- 目的: auth.users と tenants を橋渡し、ユーザーの役割を管理
- カラム:
  - `id`: uuid (PK, auth.users.id を参照)
  - `tenant_id`: uuid (NOT NULL, tenants.id を参照)
  - `role`: text (NOT NULL, CHECK: 'admin', 'manager', 'staff')
  - `created_at`: timestamptz
- インデックス:
  - PRIMARY KEY on `id`
  - INDEX on `tenant_id` (JOIN用)
  - INDEX on `role` (アクセス制御用)

#### 1.2 既存テーブルへの tenant_id 追加

以下のテーブルに `tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` を追加：

1. **base_items**
   - 既存: `user_id`
   - 追加: `tenant_id`
   - インデックス: `idx_base_items_tenant_id`

2. **items**
   - 既存: `user_id`
   - 追加: `tenant_id`
   - インデックス: `idx_items_tenant_id`

3. **recipe_lines**
   - 既存: `user_id`
   - 追加: `tenant_id`
   - インデックス: `idx_recipe_lines_tenant_id`

4. **labor_roles**
   - 既存: `user_id`
   - 追加: `tenant_id`
   - インデックス: `idx_labor_roles_tenant_id`

5. **vendors**
   - 既存: `user_id`
   - 追加: `tenant_id`
   - インデックス: `idx_vendors_tenant_id`

6. **vendor_products** (Phase 1bで virtual_vendor_products にリネーム)
   - 既存: `user_id`
   - 追加: `tenant_id`
   - インデックス: `idx_vendor_products_tenant_id`

7. **proceed_validation_settings**
   - 既存: `user_id`
   - 追加: `tenant_id`
   - インデックス: `idx_proceed_validation_settings_tenant_id`

8. **item_unit_profiles**
   - 既存: `user_id`
   - 追加: `tenant_id`
   - インデックス: `idx_item_unit_profiles_tenant_id`

9. **non_mass_units**
   - 既存: `user_id` (確認が必要)
   - 追加: `tenant_id`
   - インデックス: `idx_non_mass_units_tenant_id`

**注意**: `user_id` カラムは削除せず、マイグレーション期間中は保持。将来的に非推奨化を検討。

#### 1.3 外部キー制約の追加

各テーブルの `tenant_id` に外部キー制約を追加：
```sql
ALTER TABLE [table_name] 
ADD CONSTRAINT [table_name]_tenant_id_fkey 
FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
```

---

### 2. データマイグレーション

#### 2.1 マイグレーション戦略

**ステップ1: tenants テーブルに既存ユーザー分のレコードを作成**
- `users` テーブルの各 `id` に対して、`tenants` レコードを作成
- `name`: "Restaurant {user_id}" または既存の組織名があればそれを使用
- `type`: 'restaurant' (デフォルト)

**ステップ2: profiles テーブルにエントリを作成**
- 各 `users.id` に対して `profiles` レコードを作成
- `id`: `users.id` と同じ
- `tenant_id`: ステップ1で作成した `tenants.id`
- `role`: 'admin' (既存ユーザーは全員admin)

**ステップ3: 既存データに tenant_id を設定**
- 各テーブル（base_items, items, recipe_lines, etc.）の各行について：
  - `user_id` から対応する `profiles.tenant_id` を取得
  - その行の `tenant_id` を設定

**ステップ4: バリデーション**
- すべての行に `tenant_id` が設定されていることを確認
- `user_id` と `tenant_id` の対応関係が正しいことを確認

#### 2.2 マイグレーションスクリプトの構造

1. **トランザクション開始**
2. **tenants テーブル作成**
3. **profiles テーブル作成**
4. **既存テーブルに tenant_id カラム追加** (NULL許可で追加)
5. **tenants レコード作成** (既存ユーザー分)
6. **profiles レコード作成**
7. **既存データに tenant_id を設定** (UPDATE文)
8. **tenant_id を NOT NULL に変更** (ALTER TABLE)
9. **外部キー制約追加**
10. **インデックス作成**
11. **トランザクションコミット**

**ロールバック戦略**: トランザクションをロールバック可能にするか、逆マイグレーションスクリプトを準備

---

### 3. バックエンドAPIの変更

#### 3.1 認証ミドルウェアの変更

**ファイル**: `backend/src/middleware/auth.ts`

**現在の動作**:
1. AuthorizationヘッダーからJWTトークンを取得
2. Supabaseでトークンを検証
3. `req.user = { id: user.id }` を設定

**変更後の動作**:
1. AuthorizationヘッダーからJWTトークンを取得
2. Supabaseでトークンを検証
3. `profiles` テーブルから `tenant_id` と `role` を取得
4. `req.user = { id: user.id, tenant_id: profile.tenant_id, role: profile.role }` を設定

**エラーハンドリング**:
- `profiles` レコードが存在しない場合: エラーを返す（新規ユーザーは自動的にprofilesが作成される想定）
- `tenant_id` が null の場合: エラーを返す

#### 3.2 Expressルートの変更

**変更パターン**: すべての `.eq("user_id", req.user!.id)` を `.eq("tenant_id", req.user!.tenant_id)` に変更

**影響を受けるファイル** (14ファイル):

1. **backend/src/routes/items.ts**
   - GET `/items`: user_id → tenant_id
   - GET `/items/:id`: user_id → tenant_id
   - POST `/items`: user_id → tenant_id (新規作成時)
   - PUT `/items/:id`: user_id → tenant_id (複数箇所)
   - PATCH `/items/:id/deprecate`: user_id → tenant_id
   - DELETE `/items/:id`: user_id → tenant_id
   - 循環参照チェック内のクエリ: user_id → tenant_id
   - Yieldバリデーション内のクエリ: user_id → tenant_id

2. **backend/src/routes/base-items.ts**
   - すべてのCRUD操作で user_id → tenant_id

3. **backend/src/routes/vendor-products.ts**
   - すべてのCRUD操作で user_id → tenant_id

4. **backend/src/routes/vendors.ts**
   - すべてのCRUD操作で user_id → tenant_id

5. **backend/src/routes/recipe-lines.ts**
   - POST `/recipe-lines`: user_id → tenant_id
   - PUT `/recipe-lines/:id`: user_id → tenant_id
   - DELETE `/recipe-lines/:id`: user_id → tenant_id
   - POST `/recipe-lines/batch`: user_id → tenant_id (複数箇所)
   - 循環参照チェック内のクエリ: user_id → tenant_id
   - バリデーション内のクエリ: user_id → tenant_id

6. **backend/src/routes/recipe-lines-items.ts**
   - GET `/items/:itemId/recipe`: user_id → tenant_id
   - POST `/items/recipes`: user_id → tenant_id

7. **backend/src/routes/labor-roles.ts**
   - すべてのCRUD操作で user_id → tenant_id

8. **backend/src/routes/proceed-validation-settings.ts**
   - GET `/proceed-validation-settings`: user_id → tenant_id
   - PUT `/proceed-validation-settings`: user_id → tenant_id

9. **backend/src/routes/item-unit-profiles.ts**
   - すべてのCRUD操作で user_id → tenant_id

10. **backend/src/routes/non-mass-units.ts** (存在する場合)
    - すべてのCRUD操作で user_id → tenant_id

**注意**: 新規作成時（POST）は `tenant_id` を `req.user.tenant_id` から自動設定。更新時（PUT）は `tenant_id` を更新対象から除外（セキュリティのため）。

#### 3.3 サービス層の変更

**backend/src/services/cost.ts**

**変更箇所**:
1. `getBaseItemsMap(userId)` → `getBaseItemsMap(tenantId)`
   - クエリ: `.eq("user_id", userId)` → `.eq("tenant_id", tenantId)`

2. `getItemsMap(userId)` → `getItemsMap(tenantId)`
   - クエリ: `.eq("user_id", userId)` → `.eq("tenant_id", tenantId)`

3. `getVendorProductsMap(userId)` → `getVendorProductsMap(tenantId)`
   - クエリ: `.eq("user_id", userId)` → `.eq("tenant_id", tenantId)`

4. `getLaborRolesMap(userId)` → `getLaborRolesMap(tenantId)`
   - クエリ: `.eq("user_id", userId)` → `.eq("tenant_id", tenantId)`

5. `getCost(itemId, userId, ...)` → `getCost(itemId, tenantId, ...)`
   - すべての内部クエリで user_id → tenant_id

6. `calculateCost(itemId, userId)` → `calculateCost(itemId, tenantId)`
   - 関数シグネチャと内部呼び出しを更新

7. `calculateCosts(itemIds, userId)` → `calculateCosts(itemIds, tenantId)`
   - 関数シグネチャと内部呼び出しを更新

**backend/src/services/deprecation.ts**

**変更箇所**:
- すべての関数の `userId` パラメータを `tenantId` に変更
- すべてのクエリで `.eq("user_id", userId)` → `.eq("tenant_id", tenantId)`
- 影響を受ける関数:
  - `deprecateBaseItem`
  - `deprecateVendorProduct`
  - `deprecatePreppedItem`
  - `deprecateItemCascade`
  - `undeprecateItem`
  - `undeprecateBaseItem`
  - `undeprecateVendorProduct`
  - `checkAllIngredientsActive`
  - `recursivelyUndeprecateParents`
  - `autoUndeprecateAfterVendorProductCreation`
  - `autoUndeprecateAfterRecipeLineUpdate`

**backend/src/services/cycle-detection.ts**

**変更箇所**:
- `checkCycle(itemId, userId, ...)` → `checkCycle(itemId, tenantId, ...)`
- すべてのクエリで user_id → tenant_id

#### 3.4 PostgreSQL関数の変更

**migration_create_calculate_item_costs_function.sql**

**変更内容**:
1. 関数シグネチャ: `p_user_id uuid` → `p_tenant_id uuid`
2. すべてのWHERE句: `user_id = p_user_id` → `tenant_id = p_tenant_id`
3. JOIN条件: `user_id = p_user_id` → `tenant_id = p_tenant_id`

**具体的な変更箇所**:
- Line 14: 関数パラメータ名変更
- Line 96-97: vendor_products のWHERE句
- Line 124-125: vendor_products のWHERE句（specific_child の場合）
- Line 161: recipe_lines のWHERE句
- Line 168: items のWHERE句
- Line 199: labor_roles のWHERE句
- Line 294: items のWHERE句（最終SELECT）

**migration_update_calculate_item_costs_with_breakdown.sql**

**変更内容**:
- 同様に `p_user_id` → `p_tenant_id` に変更
- すべてのWHERE句を更新

**backend/src/routes/cost.ts**

**変更内容**:
- `calculate_item_costs` 関数呼び出し: `p_user_id: req.user!.id` → `p_tenant_id: req.user!.tenant_id`
- `calculate_item_costs_with_breakdown` 関数呼び出し: 同様に変更

#### 3.5 データベーストリガーの変更

**handle_new_user() 関数**

**現在の動作**:
- `auth.users` にINSERTされたときに `users` テーブルにレコードを作成

**変更後の動作**:
1. `auth.users` にINSERTされたときに `users` テーブルにレコードを作成（既存の動作を維持）
2. **新規**: `tenants` テーブルにレコードを作成（デフォルト名で）
3. **新規**: `profiles` テーブルにレコードを作成（role='admin'）
4. **新規**: `proceed_validation_settings` にレコードを作成（既存の動作を維持、tenant_idを追加）

**注意**: 既存のトリガー関数を更新するか、新しいトリガー関数を作成

---

### 4. フロントエンドUIの変更

#### 4.1 APIクライアントの変更

**ファイル**: `frontend/lib/api.ts`

**変更内容**:
- **変更不要**: APIエンドポイントは変更されない
- **変更不要**: リクエストボディは変更されない
- **変更不要**: レスポンス形式は変更されない

**理由**: バックエンドが `tenant_id` を自動的に `req.user.tenant_id` から取得するため、フロントエンドは変更不要。

#### 4.2 UIコンポーネントの変更

**変更不要**: Phase 1aではフロントエンドUIに変更は不要。

**理由**: 
- ユーザーは引き続きログインするだけ
- データの表示・操作は同じ
- バックエンドが自動的にtenant_idでフィルタリングする

---

## Phase 1b: Virtual Product Decoupling

### 1. データベーススキーマの変更

#### 1.1 テーブルリネーム

**vendor_products → virtual_vendor_products**
- テーブル名を変更
- すべての外部キー参照を更新
- インデックス名を更新（必要に応じて）

#### 1.2 カラム削除

**virtual_vendor_products テーブルから base_item_id を削除**
- 削除前にデータを `product_mappings` に移行（マイグレーションで実施）
- 外部キー制約を削除
- インデックスを削除（base_item_id関連）

#### 1.3 新規ブリッジテーブル作成

**product_mappings テーブル**
- カラム:
  - `id`: uuid (PK, 自動生成)
  - `base_item_id`: uuid (NOT NULL, base_items.id を参照)
  - `virtual_product_id`: uuid (NOT NULL, virtual_vendor_products.id を参照)
  - `tenant_id`: uuid (NOT NULL, tenants.id を参照)
  - `created_at`: timestamptz
- 制約:
  - PRIMARY KEY on `id`
  - UNIQUE on `(base_item_id, virtual_product_id, tenant_id)` - 同じマッピングの重複を防止
  - FOREIGN KEY on `base_item_id` → `base_items(id) ON DELETE CASCADE`
  - FOREIGN KEY on `virtual_product_id` → `virtual_vendor_products(id) ON DELETE CASCADE`
  - FOREIGN KEY on `tenant_id` → `tenants(id) ON DELETE CASCADE`
- インデックス:
  - `idx_product_mappings_base_item_id` on `base_item_id` (JOIN用)
  - `idx_product_mappings_virtual_product_id` on `virtual_product_id` (JOIN用)
  - `idx_product_mappings_tenant_id` on `tenant_id` (フィルタ用)

#### 1.4 ユニーク制約の変更

**virtual_vendor_products テーブル**
- 既存のユニーク制約（base_item_idを含む）を削除
- 新しいユニーク制約: `(vendor_id, product_name, tenant_id)` - 同じベンダーの同じ商品名の重複を防止（tenant単位）

**product_mappings テーブル**
- ユニーク制約: `(base_item_id, virtual_product_id, tenant_id)` - 同じマッピングの重複を防止

---

### 2. データマイグレーション

#### 2.1 マイグレーション戦略

**ステップ1: テーブルリネーム**
- `vendor_products` → `virtual_vendor_products`
- 外部キー参照を更新

**ステップ2: product_mappings テーブル作成**
- スキーマ定義に従って作成

**ステップ3: 既存データの移行**
- `virtual_vendor_products` の各行について：
  - `base_item_id` が NULL でない場合
  - `product_mappings` にレコードを作成:
    - `base_item_id`: 元の `base_item_id`
    - `virtual_product_id`: 元の `id`
    - `tenant_id`: 元の `tenant_id` (Phase 1aで設定済み)

**ステップ4: base_item_id カラムの削除**
- すべてのデータが移行されたことを確認
- `base_item_id` カラムを削除
- 関連するインデックスを削除

**ステップ5: バリデーション**
- すべての `base_item_id` が `product_mappings` に移行されていることを確認
- マッピングの整合性を確認

#### 2.2 マイグレーションスクリプトの構造

1. **トランザクション開始**
2. **product_mappings テーブル作成**
3. **既存データを product_mappings に移行** (INSERT文)
4. **vendor_products → virtual_vendor_products にリネーム**
5. **base_item_id カラムを削除**
6. **外部キー制約を更新**
7. **ユニーク制約を更新**
8. **インデックスを更新**
9. **トランザクションコミット**

---

### 3. バックエンドAPIの変更

#### 3.1 型定義の変更

**backend/src/types/database.ts**

**VendorProduct インターフェース**:
- `base_item_id: string` を削除
- その他のフィールドは維持

#### 3.2 Expressルートの変更

**backend/src/routes/vendor-products.ts**

**変更内容**:

1. **GET `/vendor-products`**
   - 変更不要: クエリは `tenant_id` でフィルタリング（Phase 1aで既に変更済み）

2. **GET `/vendor-products/:id`**
   - 変更不要

3. **POST `/vendor-products`**
   - **重要**: `base_item_id` をリクエストボディから削除
   - バリデーション: `base_item_id` のチェックを削除
   - 新規作成時は `base_item_id` を設定しない
   - **注意**: マッピングは別途作成する必要がある（新しいエンドポイントが必要か検討）

4. **PUT `/vendor-products/:id`**
   - `base_item_id` の更新処理を削除
   - バリデーションから `base_item_id` を削除

5. **DELETE `/vendor-products/:id`**
   - 変更不要（CASCADEで product_mappings も削除される）

**新規エンドポイント（検討）**:
- `POST /vendor-products/:id/mappings` - マッピングを作成
- `DELETE /vendor-products/:id/mappings/:mappingId` - マッピングを削除
- `GET /base-items/:id/mapped-products` - 基本アイテムにマッピングされた商品一覧

#### 3.3 サービス層の変更

**backend/src/services/cost.ts**

**computeRawCost() 関数**:
- 変更不要: 関数シグネチャは変更なし
- `vendorProduct` パラメータは `virtual_vendor_products` のレコードを想定
- `base_item_id` へのアクセスを削除（既に使用していない可能性が高い）

**getCost() 関数**:
- **重要**: Raw Itemのコスト計算ロジックを変更

**現在のロジック**:
```typescript
// base_item_idで全てのvendor_productsを取得
const matchingVendorProducts = vendorProductsMap.values()
  .filter(vp => vp.base_item_id === item.base_item_id);
```

**変更後のロジック**:
```typescript
// product_mappings経由でvirtual_vendor_productsを取得
// 1. product_mappingsからbase_item_idに紐づくvirtual_product_idを取得
// 2. virtual_vendor_productsから該当する商品を取得
const mappedProductIds = productMappingsMap
  .get(item.base_item_id) || [];
const matchingVendorProducts = mappedProductIds
  .map(id => vendorProductsMap.get(id))
  .filter(vp => vp !== undefined);
```

**必要な変更**:
1. `getProductMappingsMap(tenantId)` 関数を追加
   - `product_mappings` テーブルからデータを取得
   - `base_item_id` をキー、`virtual_product_id[]` を値とするMapを返す

2. `getCost()` 関数に `productMappingsMap` パラメータを追加

3. Raw Itemのコスト計算で `productMappingsMap` を使用

**calculateCost() 関数**:
- `getProductMappingsMap()` を呼び出してマップを取得
- `getCost()` に `productMappingsMap` を渡す

**calculateCosts() 関数**:
- 同様に `getProductMappingsMap()` を呼び出し

**backend/src/services/deprecation.ts**

**deprecateVendorProduct() 関数**:
- **重要**: `base_item_id` への直接アクセスを削除

**現在のロジック**:
```typescript
// vendorProduct.base_item_idを使用
const { data: rawItems } = await supabase
  .from("items")
  .select("*")
  .eq("base_item_id", vendorProduct.base_item_id)
```

**変更後のロジック**:
```typescript
// product_mappings経由でbase_item_idを取得
const { data: mappings } = await supabase
  .from("product_mappings")
  .select("base_item_id")
  .eq("virtual_product_id", vendorProductId)
  .eq("tenant_id", tenantId);

const baseItemIds = mappings.map(m => m.base_item_id);
// その後、baseItemIdsを使用してrawItemsを取得
```

**findItemsAffectedByVendorProductChanges() 関数**:
- 同様に `product_mappings` 経由で `base_item_id` を取得

**autoUndeprecateAfterVendorProductCreation() 関数**:
- 同様に `product_mappings` 経由で処理

**backend/src/routes/recipe-lines.ts**

**validateRecipeLineNotDeprecated() 関数**:
- **重要**: `specific_child` のバリデーションを変更

**現在のロジック**:
```typescript
// vendor_productsを直接チェック
const { data: vendorProduct } = await supabase
  .from("vendor_products")
  .select("*")
  .eq("id", line.specific_child)
  .eq("user_id", userId)
  .single();
```

**変更後のロジック**:
```typescript
// 1. product_mappingsでマッピングの存在を確認
// 2. virtual_vendor_productsで商品の存在を確認
// 3. child_itemのbase_item_idとマッピングが一致することを確認
const { data: mapping } = await supabase
  .from("product_mappings")
  .select("*")
  .eq("virtual_product_id", line.specific_child)
  .eq("base_item_id", childItem.base_item_id)
  .eq("tenant_id", tenantId)
  .single();
```

#### 3.4 PostgreSQL関数の変更

**migration_create_calculate_item_costs_function.sql**

**変更内容**:

1. **関数内のテーブル参照**:
   - `vendor_products` → `virtual_vendor_products`

2. **Raw Itemのコスト計算ロジック** (Lines 73-127):

**現在のロジック**:
```sql
FROM vendor_products vp
LEFT JOIN base_items bi ON vp.base_item_id = bi.id
WHERE vp.base_item_id = child_items.base_item_id
  AND vp.user_id = p_user_id
```

**変更後のロジック**:
```sql
FROM virtual_vendor_products vvp
INNER JOIN product_mappings pm ON vvp.id = pm.virtual_product_id
LEFT JOIN base_items bi ON pm.base_item_id = bi.id
WHERE pm.base_item_id = child_items.base_item_id
  AND pm.tenant_id = p_tenant_id
```

3. **"lowest" 選択の場合** (Lines 73-100):
   - `product_mappings` 経由で商品を取得
   - `virtual_vendor_products` とJOIN

4. **特定商品選択の場合** (Lines 102-127):
   - `product_mappings` でマッピングの存在を確認
   - `virtual_vendor_products` から商品を取得

5. **すべてのWHERE句**:
   - `vp.user_id = p_user_id` → `pm.tenant_id = p_tenant_id`
   - `vp.base_item_id = X` → `pm.base_item_id = X`

**migration_update_calculate_item_costs_with_breakdown.sql**

**変更内容**:
- 同様に `vendor_products` → `virtual_vendor_products`
- `product_mappings` 経由のJOINに変更
- `user_id` → `tenant_id`

---

### 4. フロントエンドUIの変更

#### 4.1 型定義の変更

**frontend/lib/api.ts**

**VendorProduct インターフェース**:
- `base_item_id: string` を削除

#### 4.2 Itemsページの変更

**frontend/app/items/page.tsx**

**変更内容**:

1. **Vendor Products表示ロジック**:
   - **現在**: `vp.base_item_id` でフィルタリングして表示
   - **変更後**: `product_mappings` APIから取得したマッピング情報を使用

2. **新規Vendor Product作成**:
   - **現在**: `base_item_id` をリクエストボディに含める
   - **変更後**: `base_item_id` を含めない（マッピングは別途作成）

3. **Base ItemとVendor Productの関連表示**:
   - **新規**: Base Item詳細画面に「マッピングされたVirtual Products」セクションを追加
   - **新規**: マッピングの追加/削除UIを実装

**必要な新規API呼び出し**:
- `GET /base-items/:id/mapped-products` - マッピングされた商品一覧
- `POST /product-mappings` - マッピング作成
- `DELETE /product-mappings/:id` - マッピング削除

#### 4.3 Costページの変更

**frontend/app/cost/page.tsx**

**getAvailableVendorProducts() 関数**:

**現在のロジック**:
```typescript
const matchingVendorProducts = vendorProducts.filter((vp) => {
  return vp.base_item_id === childItem.base_item_id;
});
```

**変更後のロジック**:
```typescript
// 1. product_mappings APIからbase_item_idに紐づくvirtual_product_idを取得
// 2. vendorProductsから該当する商品をフィルタリング
const mappedProductIds = await getMappedProductIds(childItem.base_item_id);
const matchingVendorProducts = vendorProducts.filter((vp) => {
  return mappedProductIds.includes(vp.id);
});
```

**必要な新規関数**:
- `getMappedProductIds(baseItemId: string): Promise<string[]>` - マッピングされた商品ID一覧を取得

**必要な新規API呼び出し**:
- `GET /base-items/:id/mapped-products` - マッピングされた商品一覧（IDのみでも可）

---

### 5. 新規APIエンドポイント（検討）

#### 5.1 Product Mappings管理

**POST /product-mappings**
- リクエスト: `{ base_item_id, virtual_product_id }`
- レスポンス: 作成されたマッピング
- バリデーション: 同じマッピングの重複チェック

**DELETE /product-mappings/:id**
- マッピングを削除

**GET /base-items/:id/mapped-products**
- 基本アイテムにマッピングされた商品一覧を返す
- レスポンス: `{ products: VendorProduct[] }`

**GET /virtual-vendor-products/:id/mappings**
- 商品にマッピングされた基本アイテム一覧を返す
- レスポンス: `{ base_items: BaseItem[] }`

---

## 実装順序のまとめ

### Phase 1a の実装順序

1. **データベースマイグレーション**
   - tenants/profiles テーブル作成
   - 既存テーブルに tenant_id 追加
   - データ移行

2. **バックエンドミドルウェア**
   - 認証ミドルウェアの更新

3. **バックエンドサービス**
   - cost.ts, deprecation.ts, cycle-detection.ts の更新

4. **バックエンドルート**
   - すべてのルートファイルの更新

5. **PostgreSQL関数**
   - calculate_item_costs 関数の更新

6. **テスト・検証**

### Phase 1b の実装順序

1. **データベースマイグレーション**
   - product_mappings テーブル作成
   - 既存データの移行
   - vendor_products → virtual_vendor_products リネーム
   - base_item_id 削除

2. **バックエンド型定義**
   - database.ts の更新

3. **バックエンドサービス**
   - cost.ts の更新（product_mappings対応）
   - deprecation.ts の更新

4. **バックエンドルート**
   - vendor-products.ts の更新
   - recipe-lines.ts の更新
   - 新規エンドポイントの追加（product-mappings）

5. **PostgreSQL関数**
   - calculate_item_costs 関数の更新

6. **フロントエンド**
   - 型定義の更新
   - Itemsページの更新
   - Costページの更新

7. **テスト・検証**

---

## 注意事項

### データ整合性

- Phase 1a: すべての既存データに `tenant_id` が設定されることを確認
- Phase 1b: すべての `base_item_id` が `product_mappings` に移行されることを確認

### パフォーマンス

- `product_mappings` 経由のJOINは追加のクエリコストがかかる
- インデックスを適切に設定
- 必要に応じてキャッシュを検討

### 後方互換性

- Phase 1a: `user_id` カラムは削除せず、マイグレーション期間中は保持
- Phase 1b: 既存のAPIエンドポイントは可能な限り維持

### エラーハンドリング

- `profiles` レコードが存在しない場合の処理
- `product_mappings` が存在しない場合の処理
- マッピングの整合性チェック

---

この実装計画に基づいて、段階的に実装を進めます。

