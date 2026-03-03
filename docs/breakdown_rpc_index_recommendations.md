# calculate_item_costs_with_breakdown 用インデックス検討結果

## 1. EXPLAIN ANALYZE の解釈

- **Total time: 92.25ms** … DB 内で RPC を実行した時間（関数全体）。
- **Function Scan の 0.007ms** … 戻り値の「スキャン」ノードの時間であり、関数本体の実行時間ではない。実質の DB 処理は約 92ms。
- **ブラウザでは breakdown が約 2.10 秒** … 差の約 2 秒は **ネットワーク（クライアント ↔ バックエンド ↔ Supabase）＋バックエンドの処理** が支配的で、**DB 実行はすでに速い（92ms）**。

**結論:** 現状のデータ量ではインデックス追加でフロントの 2 秒が大きく縮む可能性は低い。一方で、データ増加に備え、RPC の参照パターンに合ったインデックスを足しておく価値はある。

---

## 2. 既存インデックス（該当テーブルのみ）

| テーブル | 既存インデックス |
|----------|------------------|
| recipe_lines | tenant_id, parent_item_id, user_id |
| items | tenant_id, item_kind, base_item_id, user_id, ... |
| base_items | tenant_id, user_id, ... |
| product_mappings | base_item_id, virtual_product_id, tenant_id, (base_item_id, tenant_id) |
| virtual_vendor_products | tenant_id, vendor_id, deprecated, ... |
| labor_roles | tenant_id, user_id, (name, user_id) UNIQUE |

---

## 3. RPC（v2）の参照パターンと不足しているインデックス

### 3.1 recipe_lines

| 用途 | 条件・JOIN | 既存で足りるか | 推奨 |
|------|------------|----------------|------|
| temp_labor_costs | `WHERE line_type = 'labor' AND tenant_id = p_tenant_id` | tenant_id のみ → line_type でさらに絞るのに複合が有利 | **(tenant_id, line_type)** を推奨 |
| temp_ingredient_edges | `WHERE line_type = 'ingredient' AND tenant_id = p_tenant_id` | 同上 | 上と同じ 1 本で labor/ingredient 両方に使える |
| Raw ステップ（ステップ1） | `LEFT JOIN recipe_lines rl ON i.id = rl.child_item_id AND rl.line_type = 'ingredient'` | **child_item_id のインデックスが無い**（parent のみあり） | **(child_item_id, line_type)** を推奨 |

- 既存: `idx_recipe_lines_parent (parent_item_id)`, `idx_recipe_lines_tenant_id (tenant_id)` のみ。
- **追加推奨:**
  1. `(tenant_id, line_type)` … labor/ingredient の一括取得用。
  2. `(child_item_id, line_type)` … Raw の「この raw item を child に持つレシピ行」の JOIN 用。

### 3.2 labor_roles

| 用途 | 条件・JOIN | 既存で足りるか | 推奨 |
|------|------------|----------------|------|
| temp_labor_costs | `LEFT JOIN labor_roles lr ON rl.labor_role = lr.name AND lr.tenant_id = p_tenant_id` | (name, user_id) と (tenant_id) のみ。**「tenant_id + name」で一度に探すインデックスが無い** | **(tenant_id, name)** を推奨 |

- **追加推奨:** `(tenant_id, name)` … テナント＋役職名での JOIN にそのまま使える。

### 3.3 items

| 用途 | 条件・JOIN | 既存で足りるか | 推奨 |
|------|------------|----------------|------|
| Raw / Prepped の絞り込み | `WHERE item_kind = 'raw' AND tenant_id = p_tenant_id` 等 | tenant_id と item_kind は別々のインデックス。複合で「このテナントの raw だけ」を一発で取れる | **(tenant_id, item_kind)** はあると有利（優先度は中） |

- **追加推奨:** `(tenant_id, item_kind)` … 既存単列でも動くが、データ増加時に効く。

### 3.4 base_items, product_mappings, virtual_vendor_products

- **base_items:** `id` (PK), `tenant_id` のインデックスあり。RPC は主に JOIN で id / tenant_id を使用 → 現状で十分。
- **product_mappings:** `(base_item_id, tenant_id)` あり。RPC の `WHERE pm.base_item_id = i.base_item_id AND pm.tenant_id = p_tenant_id` に合っている → 追加不要。
- **virtual_vendor_products:** `tenant_id`, その他既存で RPC の使い方と整合 → 追加は優先度低。

---

## 4. 推奨する追加インデックス（まとめ）

| 優先度 | テーブル | 推奨インデックス | 理由 |
|--------|----------|------------------|------|
| 高 | recipe_lines | **(tenant_id, line_type)** | labor/ingredient の一括取得を効率化 |
| 高 | recipe_lines | **(child_item_id, line_type)** | Raw ステップの JOIN を効率化（現状 child_item_id 系が無い） |
| 高 | labor_roles | **(tenant_id, name)** | テナント＋役職名での JOIN を効率化 |
| 中 | items | **(tenant_id, item_kind)** | テナント×種類の絞り込みを効率化、データ増加に備える |

---

## 5. 注意事項

- **既存 UNIQUE / 制約:** labor_roles の `(name, user_id)` UNIQUE はそのまま。`(tenant_id, name)` は別用途（テナント単位の name 検索）なので重複しない。
- **作成方法:** 本番適用時は `CREATE INDEX CONCURRENTLY` を推奨（テーブルロックを避けるため）。Supabase のマイグレーションで 1 本ずつ作成して問題ない。
- **効果:** 現状 92ms のため体感差は小さい可能性が高い。データ量が増えたときの劣化防止と、Raw ステップの JOIN 安定化が主な目的。

---

## 6. 次のステップ（コード変更時）

1. 上記 4 本のインデックスを `CREATE INDEX [CONCURRENTLY]` で追加するマイグレーション SQL を作成する。
2. 適用後、再度 EXPLAIN (ANALYZE, BUFFERS) で RPC を実行し、Index Scan / Index Only Scan が使われているか確認する。
