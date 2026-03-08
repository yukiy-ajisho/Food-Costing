# Breakdown キャッシュ実装計画

## 目的

- Cost ページの `GET /items/costs/breakdown` の応答をキャッシュし、初回〜2回目以降のロード時間を短縮する。
- キャッシュは **テナント単位**。データ変更時は無効化し、さらに**バックグラウンドで再計算**してキャッシュを温めることで、ほぼ常に最新かつキャッシュが効いた状態を保つ。

---

## 方針: アプリケーション層キャッシュ（第一段階）

- **どこに持つか**: バックエンドの **メモリ内 Map**（キー: `tenant_id`、値: breakdown の JSON）。
- **理由**: 実装が単純で、無効化を「どのルートで何を呼ぶか」をはっきり決められる。Materialized View は DB 変更・トリガーが必要なため、まずはアプリキャッシュで進める。
- **無効化＋バックグラウンド再計算**: Cost に影響するデータが変更されたら、(1) キャッシュを無効化し、(2) **レスポンスを返したあと**にそのテナントの breakdown を裏で再計算してキャッシュに保存する。これにより次の Cost アクセスではキャッシュヒットで速く、かつ最新の数値が返る（ベストプラクティス）。
- **将来**: 複数インスタンスや Redis を導入する場合は、同じ「get / set / invalidate(tenant_id)」インターフェースで差し替え可能にする。

---

## Cost に影響するもの（無効化・再計算の対象の根拠）

breakdown は RPC `calculate_item_costs_with_breakdown(p_tenant_id)` の結果。以下を変更すると Cost の数値に影響するため、これらの書き込み成功時に無効化とバックグラウンド再計算を行う。

| 影響するもの | 何を変えると Cost に効くか | 対応するルート |
|--------------|---------------------------|----------------|
| **Vendor products（vendor item の値段など）** | 単価・数量・単位（purchase_cost, purchase_quantity, purchase_unit） | vendor-products: POST / PUT / PATCH / DELETE |
| **Vendors** | ベンダー削除で vendor_products が消える等 | vendors: POST / PUT / DELETE |
| **Base items** | specific_weight 等（raw の容量→重量変換に使用） | base-items: POST / PUT / PATCH / DELETE |
| **Product mappings** | どの base_item がどの vendor product と紐づくか | product-mappings: POST / DELETE |
| **Items** | 単価・yield・base_item_id・each_grams 等 | items: POST / PUT / PATCH(deprecate) / DELETE |
| **Recipe lines** | 材料・数量・単位・人件費（labor の分数・役割） | recipe-lines, recipe-lines-items: POST / PUT / DELETE / batch |
| **Labor roles** | 時給（hourly_wage）・役割の追加・削除 | labor-roles: POST / PUT / DELETE |

---

## 実装ステップ（順番に実施）

### ステップ 1: キャッシュモジュールの追加

**ファイル**: `backend/src/services/breakdown-cache.ts`（新規）

**やること**:

1. **ストア**: `Map<string, { costs: BreakdownCosts; refreshedAt?: number }>`  
   - キー: `tenant_id`（UUID 文字列）  
   - 値: `GET /items/costs/breakdown` が返すのと同じ形 `{ costs: Record<itemId, { food_cost_per_gram, labor_cost_per_gram, total_cost_per_gram }> }` と、任意で `refreshedAt`（Date.now()、将来の TTL 用）。

2. **API**:
   - `get(tenantId: string): typeof response | null` … キャッシュがあれば返す、なければ `null`。
   - `set(tenantId: string, data: typeof response): void` … キャッシュに保存。
   - `invalidate(tenantId: string): void` … そのテナントのキャッシュを削除。
   - （オプション）`invalidateAll(): void` … 全削除（デプロイ時など）。

3. **型**: breakdown のレスポンス型を 1 箇所で定義し、`cost.ts` のレスポンスと揃える。

4. **バックグラウンド再計算用**: `recomputeBreakdownInBackground(tenantId: string)` を、`cost.ts` 側または `breakdown-cache` から利用する形で用意する。実装は「`calculate_item_costs_with_breakdown` RPC を 1 回呼び、成功したら `cache.set(tenantId, { costs })` する」。この関数は **await せずに** 呼び出す（fire-and-forget）。内部で Promise を reject した場合は .catch で捕捉しログのみとし、呼び出し元には throw しない。

**依存**: なし（既存の cost ルートや RPC は触らない）。

---

### ステップ 2: GET /items/costs/breakdown でキャッシュを参照・保存

**ファイル**: `backend/src/routes/cost.ts`

**やること**:

1. `breakdown-cache` の `get` / `set` を import。
2. ハンドラ内の流れ:
   - 使用する `tenantIdToUse` を現在どおり決定（`selected_tenant_id || tenant_ids[0]`）。
   - `cache.get(tenantIdToUse)` を実行。**ヒットしたら** そのオブジェクトを `res.json(...)` で返して終了。
   - **ミスしたら** 従来どおり `calculate_item_costs_with_breakdown` の RPC を 1 回呼ぶ。
   - 成功したら `cache.set(tenantIdToUse, { costs: allCosts })` で保存し、`res.json({ costs: allCosts })` で返す。
   - エラー時はキャッシュに set しない（既存の 500 処理のまま）。

**注意**: レスポンス形式は今までと完全に同一にする（`{ costs: { [itemId]: { food_cost_per_gram, labor_cost_per_gram, total_cost_per_gram } } }`）。

---

### ステップ 3: 無効化を呼ぶ場所の一覧と実装

breakdown は次のテーブルに依存している（RPC 内で参照）:

- `items`
- `recipe_lines`
- `labor_roles`
- `base_items`（items 経由）
- `product_mappings`（raw コスト経由）
- `vendor_products` / `virtual_vendor_products`（raw コスト経由）

そのため、**以下のルートで「書き込みが成功したあと」に、そのテナントの breakdown キャッシュを無効化する**。

| ルート | ファイル | 無効化のタイミング | テナントの取り方 |
|--------|----------|--------------------|------------------|
| Items POST | items.ts | 201 を返す直前 | `req.user.selected_tenant_id \|\| req.user.tenant_ids[0]` |
| Items PUT | items.ts | 200 を返す直前 | 更新対象の `tenant_id`（既存取得済みならそれ、なければ body/params から） |
| Items PATCH (deprecate) | items.ts | 200 直前 | 対象 item の `tenant_id` |
| Items DELETE | items.ts | 204 直前 | 削除対象の `tenant_id`（削除前に取得している場合）または `selected_tenant_id` |
| Recipe lines POST | recipe-lines.ts | 201 直前 | body の `tenant_id` または親 item の `tenant_id` |
| Recipe lines PUT | recipe-lines.ts | 200 直前 | 対象 line の `tenant_id` |
| Recipe lines DELETE | recipe-lines.ts | 204 直前 | 対象 line の `tenant_id` |
| Recipe lines POST batch | recipe-lines.ts | 200 直前 | 対象のテナント（body または親 item） |
| Recipe-lines-items POST | recipe-lines-items.ts | 201 直前 | 対象テナント |
| Product mappings POST | product-mappings.ts | 201 直前 | `req.user.selected_tenant_id \|\| req.user.tenant_ids[0]` |
| Product mappings DELETE | product-mappings.ts | 204 直前 | 削除した mapping の `tenant_id`（削除前に取得するか、withTenantFilter の場合は `selected_tenant_id` で代替可） |
| Vendor products POST/PUT/PATCH/DELETE | vendor-products.ts | 成功レスポンス直前 | 対象 resource の `tenant_id` |
| Base items POST/PUT/PATCH/DELETE | base-items.ts | 成功レスポンス直前 | 対象の `tenant_id` |
| Labor roles POST/PUT/DELETE | labor-roles.ts | 成功レスポンス直前 | 対象の `tenant_id` |
| Vendors POST/PUT/DELETE | vendors.ts | 成功レスポンス直前 | 対象の `tenant_id` |

**実装の注意**:

- 各ルートで「成功時のみ」`invalidateBreakdownCache(tenantId)` を 1 回呼ぶ。
- `tenant_id` が取れない場合（例: DELETE でリソースを読んでいない）は、**安全側に倒して** `req.user.tenant_ids` のそれぞれに対して `invalidate(tenantId)` してもよい（そのユーザーが触りうるテナントをすべて無効化）。

---

### 無効化後のバックグラウンド再計算

上記の無効化に加え、**同じルートの成功パスで**、そのテナントの breakdown をバックグラウンドで再計算し、完了次第キャッシュに保存する。

- **順序**: 必ず **(1) 無効化 → (2) レスポンス返却 → (3) 再計算開始（await しない）**。無効化より先に再計算を開始すると古い結果がキャッシュに残る可能性があるため、無効化を先に行う。
- **レスポンス**: 再計算の完了を待たずにレスポンスを返す。ユーザーが保存したあとすぐ別ページへ遷移しても、サーバー側で再計算は継続し、完了すればキャッシュが更新される。
- **実装**: 無効化とレスポンス返却のあと、`recomputeBreakdownInBackground(tenantId)`（または同等の関数）を **await せずに** 呼ぶ。この関数内で RPC を実行し、成功したら `cache.set(tenantId, { costs })` する。同一テナントへの連続編集で再計算が複数走ることがあるが、正しさは保たれる（最後に完了した結果がキャッシュに入る）。

**作業内容**:

1. `backend/src/routes/items.ts` の POST / PUT / PATCH(deprecate) / DELETE の成功パスで、`invalidateBreakdownCache(tenantId)` のあと `recomputeBreakdownInBackground(tenantId)` を追加（await しない）。
2. `backend/src/routes/recipe-lines.ts` の POST / PUT / DELETE / batch の成功パスに同様に追加。
3. `backend/src/routes/recipe-lines-items.ts` の POST の成功パスに追加。
4. `backend/src/routes/product-mappings.ts` の POST / DELETE の成功パスに追加。
5. `backend/src/routes/vendor-products.ts` の POST / PUT / PATCH / DELETE の成功パスに追加。
6. `backend/src/routes/base-items.ts` の POST / PUT / PATCH / DELETE の成功パスに追加。
7. `backend/src/routes/labor-roles.ts` の POST / PUT / DELETE の成功パスに追加。
8. `backend/src/routes/vendors.ts` の POST / PUT / DELETE の成功パスに追加。

各ファイルで `invalidateBreakdownCache` と `recomputeBreakdownInBackground` を適切なモジュール（例: `../services/breakdown-cache` または cost 関連サービス）から import する。

---

### ステップ 4: 動作確認とテスト

1. **キャッシュヒット**  
   - Cost ページを 2 回連続で開く。2 回目が明らかに速いこと、レスポンス内容が同じであることを確認。

2. **無効化**  
   - Cost を開く（キャッシュが乗る）→ Items で単価やレシピを 1 件変更して保存 → 再度 Cost を開く。  
   - 2 回目の Cost で変更が反映されていること（RPC が再実行され、新しい結果がキャッシュされる）。

3. **バックグラウンド再計算**  
   - 別ページ（例: Vendor products）で単価を変更して保存 → 保存のレスポンスが速いこと（再計算を待っていないこと）。  
   - その後 Cost を開く → 変更が反映された数値が表示され、かつ応答が速いこと（再計算でキャッシュが温まっていること）。

4. **テナント分離**  
   - テナント A で Cost を開く → テナント B に切り替えて Cost を開く。  
   - B 用の結果が返ること（テナント A のキャッシュが B に使われていないこと）。

5. **既存 API 互換**  
   - レスポンス形式が従来の `GET /items/costs/breakdown` と完全に同一であること（フロントの既存コードでそのまま動くこと）。

---

## まとめチェックリスト

- [ ] ステップ 1: `backend/src/services/breakdown-cache.ts` を新規作成（get / set / invalidate、型定義）。RPC を呼んで cache.set する `recomputeBreakdownInBackground(tenantId)`（または同等）を cost 側などに用意。
- [ ] ステップ 2: `backend/src/routes/cost.ts` の GET breakdown で get → ヒット時は即返却、ミス時は RPC 実行 → set → 返却。
- [ ] ステップ 3: 上記ルート一覧のすべての「成功時」に `invalidateBreakdownCache(tenantId)` を追加し、そのあと `recomputeBreakdownInBackground(tenantId)` を await せずに呼ぶ。
- [ ] ステップ 4: キャッシュヒット・無効化・バックグラウンド再計算・テナント分離・API 互換の確認。

---

## 将来の拡張（今回はやらない）

- **TTL**: `refreshedAt` を保存し、取得時に「N 分経過していたら無効扱い」にすると、無効化漏れの保険になる。
- **Redis**: 複数インスタンス対応時は、同じ API（get/set/invalidate）で Redis をバックエンドにする。
- **Materialized View**: さらに DB 負荷を下げたい場合は、RPC 結果を MV に持ち、REFRESH を無効化のタイミングで呼ぶ方式を検討可能。
- **再計算の多重起動抑制**: 同一テナントへの連続編集で再計算が複数走る場合、「このテナントは再計算中」フラグで 1 本化する拡張は任意。

以上を順に実施すれば、慎重かつ確実にキャッシュを導入できます。

---

## 検証: Conflict / RBAC / テナント / アプリの仕組み

この計画が、conflict・RBAC・テナント分離・アプリの仕組みと整合しているかを確認した結果です。

### Conflict（他ユーザー・他ページの変更反映）

- **計画**: 書き込みが成功したタイミングで、そのテナントのキャッシュを `invalidate(tenantId)` し、続けてバックグラウンドで再計算してキャッシュを温める。
- **結果**: 誰かが Items / Recipes 等を変更すると、そのテナントのキャッシュが消え、裏で再計算が走る。次に誰かが Cost を開いたときは、再計算が終わっていればキャッシュヒットで最新が返り、終わっていなければ on-demand で RPC が実行され最新が返る。他ユーザー・他ページでの変更は確実に反映され、**conflict は解消される**。計画どおりで正しい。

### RBAC（認可）

- **現状**: `GET /items/costs/breakdown` は認可ミドルウェアを付けず、`req.user` の `selected_tenant_id || tenant_ids[0]` だけを使っている（認証済みユーザーが属するテナントのみ）。
- **キャッシュ**: キーは `tenant_id` のみ。参照時も「そのユーザーが選択しているテナント」で get するので、**別テナントのキャッシュが返ることはない**。breakdown の内容はテナント内でロールによらず同じ計算結果なので、キャッシュを「ユーザー別・ロール別」にする必要はない。
- **バックグラウンド再計算**: 再計算は「書き込みが成功したテナント」の `tenant_id` だけで呼ぶ。その書き込みはすでに認可済みなので、別テナント用のキャッシュを更新することはない。RBAC を崩さない。
- **注意**: 現状の RPC はテナント全アイテムのコストを返す。もし GET /items が resource_shares 等で「見えるアイテム」を絞っている場合、breakdown は全件返したままになるが、それは**キャッシュ導入前から同じ仕様**。キャッシュはそれを変えず、RBAC を崩さない。計画は正しい。

### テナント分離

- **キャッシュキー**: `tenant_id` のみ。`tenantIdToUse` は `req.user!.selected_tenant_id || req.user!.tenant_ids[0]` で決まり、認証ミドルウェアが `tenant_ids` を設定している。
- **結果**: ユーザーは自分が属するテナントの ID でしか get/set しないため、**テナント A のキャッシュがテナント B に返ることはない**。計画どおりで正しい。

### アプリの仕組み（無効化対象ルート）

- breakdown の RPC が参照するテーブル: `items`, `recipe_lines`, `labor_roles`, `base_items`, `product_mappings`, `virtual_vendor_products`（および vendors 経由の vendor_products）。これらを更新するルートで無効化する必要がある。
- **計画の一覧**: Items / Recipe lines / Recipe-lines-items / Product mappings / Vendor products / Base items / Labor roles / Vendors の各 POST・PUT・PATCH・DELETE を挙げている。**抜けはない**。
- **実装時の補足**:
  - **Items PUT**: 既存取得で `existingItem` があるので `existingItem.tenant_id` を使える。
  - **Items PATCH (deprecate)**: 対象 item の `tenant_id` が必要。`deprecatePreppedItem` の引数や戻り値から取るか、deprecate 前に item を 1 件取得して `tenant_id` を渡す。
  - **Items DELETE**: 削除前に item を読んでいなければ、`req.user.selected_tenant_id || req.user.tenant_ids[0]` でよい（withTenantFilter でそのテナントに限定して削除している前提）。

**結論**: conflict・RBAC・テナント・アプリの仕組みのいずれも、この計画で正しく扱われている。

---

## 実装時の注意・アプリを壊さないために

計画どおり実装すれば破綻はしませんが、以下の点を守ると安全です。

1. **認証の前提**  
   無効化・再計算を呼ぶルートは、いずれも **認証ミドルウェア通過後** であること。`req.user` が未設定の状態で `req.user!.selected_tenant_id` 等に触れると落ちる。既存の items / recipe-lines / vendor-products 等は認証付きなので、**新しい処理は「成功レスポンスを返す直前」にだけ追加**し、`req.user` を触る位置は変えないこと。

2. **`recomputeBreakdownInBackground(tenantId)`**  
   - **await しない** で呼ぶため、内部で Promise を reject すると unhandledRejection になる。実装では **必ず .catch() で捕捉しログだけ出す**（呼び出し元には throw しない）。  
   - **tenantId が undefined / 空文字のときは呼ばない**。`tenant_id` が取れず `req.user.tenant_ids` で無効化だけした場合は、再計算は **スキップ** してよい（次の Cost アクセスで on-demand 実行される）。

3. **既存の `clearCostCache` とは別物**  
   `backend/src/routes/cost.ts` の `clearCostCache` は **単品コスト用**（GET /items/:id/cost）のメモリキャッシュ。今回追加する breakdown キャッシュとは別モジュールなので、**既存の clearCostCache や cost.ts の単品ロジックは変更しない**こと。

4. **インポートパス**  
   ルートは `backend/src/routes/` にあるので、`invalidateBreakdownCache` / `recomputeBreakdownInBackground` は `../services/breakdown-cache` から import する（必要なら cost 関連サービスにまとめてもよい）。

5. **レスポンス形式の互換**  
   GET /items/costs/breakdown のレスポンスは **既存と完全に同じ** `{ costs: { [itemId]: { food_cost_per_gram, labor_cost_per_gram, total_cost_per_gram } } }` にする。キー名やネストを変えるとフロントが壊れる。

---

## RBAC・セキュリティを壊さないために

キャッシュ導入で **RBAC やセキュリティが緩む・壊れる可能性はありません**。ただし実装時に次の原則を守ること。

- **tenant_id は「信頼できるソース」だけから使う**  
  - **GET /items/costs/breakdown**: 使用する `tenantIdToUse` は **必ず `req.user.selected_tenant_id || req.user.tenant_ids[0]` だけ** にする（現状どおり）。クエリや body から tenant_id を取らない。  
  - **無効化・再計算**: 使う `tenant_id` は「今成功した書き込みの対象リソースの tenant_id」か「`req.user.selected_tenant_id || req.user.tenant_ids[0]`」に限定する。クライアントが送った任意の tenant_id で無効化・再計算しない。

- **キャッシュの get/set は「認可済みの tenant_id」だけ**  
  - 読むとき: 上記のとおり `req.user` 由来の tenant_id で get するだけなので、**他テナントのデータが返る経路はない**。  
  - 書くとき: 無効化・再計算で触れる tenant_id は、そのリクエストで認可済みの書き込みのテナントのみ。他テナント用のキャッシュを上書きしない。

- **既存の「breakdown はテナント単位」という仕様を変えない**  
  - 現状、RPC はテナント全アイテムのコストを返す（ロールで絞らない）。キャッシュも「テナント単位」のままにすれば、**現行の RBAC と同一**。将来 RPC を「見えるアイテムだけ返す」ように変える場合は、キャッシュのキー設計（tenant のみか user/role も含めるか）をそのとき見直す。

- **新たに認証をバイパスする経路を作らない**  
  - キャッシュ用のエンドポイントを新設しない。既存の GET /items/costs/breakdown と既存の書き込みルートにだけ処理を足し、**認証ミドルウェアの前や外にロジックを置かない**。

以上を守れば、現在の RBAC やセキュリティを壊さずにキャッシュを導入できます。
