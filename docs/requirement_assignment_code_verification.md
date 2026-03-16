# Requirement Assignment 実装のコード確認結果

設計: `requirement_assignment_design.txt` に基づく実装のコードレベル確認。

---

## 1. フロントエンド – API レスポンスの扱い

| 箇所 | 確認内容 | 結果 |
|------|----------|------|
| `fetchStatusData` | `getMappings()` の戻り値 | バックエンドは `res.json(latest)` で **配列** を返す。フロントは `apiRequest<MappingUserRequirementRow[]>` で配列として受け取る。`const [rows, ...]` で正しく配列を受けている。✅ |
| `fetchStatusData` | `getAssignments()` の戻り値 | バックエンドは `res.json({ assignments: [...] })` を返す。フロントは `const [..., { assignments }]` で分割代入。型は `apiRequest<{ assignments: AssignmentRow[] }>` で一致。✅ |
| 空時 | `assignments ?? []` | API が `assignments: null` を返す想定はないが、防御的に `?? []` で安全。✅ |

---

## 2. フロントエンド – 適用状態の表示・操作

| 箇所 | 確認内容 | 結果 |
|------|----------|------|
| 適用判定 | `statusAssignments[person.id]?.[req.id] ?? false` | 行がない or false = 適用外。設計の「行がない、または is_currently_assigned = false」と一致。✅ |
| 表示 | 適用外セル | `!isAssigned` のとき `bg-slate-800/60` / `bg-gray-100` と「Not assigned」を表示。設計の「薄いグレー」と一致。✅ |
| 編集時 | Add/Remove | 適用外は Add のみ、適用中は Remove も表示。どちらも `toggleAssignment(person.id, req.id, true|false)` で PATCH を呼ぶ。✅ |
| Save（mapping） | 適用外セル | 日付入力と Save は `isAssigned && showInputs` のときのみ表示。適用外では mapping の保存はできない。設計どおり。✅ |
| 2 種類のテーブル | 人を行 / 要件を行 | 両方で `isAssigned`・`statusAssignments`・Add/Remove・グレー表示を同じロジックで使用。✅ |

---

## 3. バックエンド – GET /user-requirement-assignments

| 箇所 | 確認内容 | 結果 |
|------|----------|------|
| 認可 | 取得対象 | `user_requirements` の `created_by = req.user.id` の id だけを取得し、その id に紐づく assignment のみ取得。他テナントの要件は返さない。✅ |
| フィルタ | `deleted_at IS NULL` | 削除済み要件に紐づく行は返さない。設計の「deleted_at IS NULL で判断」と一致。✅ |
| 返却 | true/false 両方 | `is_currently_assigned` の true/false をそのまま返す。フロントで「適用外」表示に false を使用できている。✅ |
| クエリパラメータ | `user_ids`, `user_requirement_ids` | オプションで絞り込み。文字列を split/trim して使用。✅ |

---

## 4. バックエンド – PATCH /user-requirement-assignments

| 箇所 | 確認内容 | 結果 |
|------|----------|------|
| 認可 | 操作対象 | `user_requirement_id` が `created_by = req.user.id` の要件のみ。他者の要件は 404。✅ |
| 既存行 | UPDATE | 既存行は `is_currently_assigned` のみ UPDATE。レコードは削除しない。設計どおり。✅ |
| 行がない + Add | INSERT | 行が無く `is_currently_assigned === true` のときのみ INSERT（バックフィル未実施時用）。設計の「Add は新規 INSERT しない」は通常フロー（行が必ずある前提）の話で、実装の拡張と矛盾しない。✅ |
| 行がない + Remove | 何もしない | `is_currently_assigned === false` で行が無い場合は何もせず `{ ok: true }`。正しい。✅ |
| Body 検証 | user_id, user_requirement_id, is_currently_assigned | すべて必須かつ型チェック。不足・不正で 400。✅ |

---

## 5. バックエンド – 要件作成・削除

| 箇所 | 確認内容 | 結果 |
|------|----------|------|
| POST | tenant_id | 要件はテナントに属さないため設定しない。✅ |
| POST | assignment 挿入 | 要件 INSERT 後、作成者が admin である全テナントのメンバー（profiles の user_id）を取得し、各 user_id で `user_requirement_assignments` に 1 行ずつ INSERT。✅ |
| DELETE | 順序 | 先に `user_requirement_assignments` の該当 `user_requirement_id` の全行の `deleted_at` を UPDATE してから `user_requirements` を DELETE。設計どおり。✅ |

---

## 6. マイグレーション

| 箇所 | 確認内容 | 結果 |
|------|----------|------|
| テーブル定義 | カラム・型・制約 | id (PK), user_id (NOT NULL, FK users), user_requirement_id (NOT NULL, FK user_requirements), is_currently_assigned (NOT NULL, DEFAULT true), created_at (NOT NULL), deleted_at (NULL)。設計と一致。✅ |
| UNIQUE | (user_id, user_requirement_id) | `idx_user_requirement_assignments_user_req` で UNIQUE。✅ |
| トリガー | profiles AFTER INSERT | そのテナントの admin（role=admin）のいずれかが created_by である要件を取得し、各要件について 1 行 INSERT。要件はテナントに属さず作成者に属する。✅ |
| user_requirements.tenant_id | 既存時は NULL 許容に | 20260304120000 で NOT NULL で作られている場合は DROP NOT NULL。要件はテナントに属さないため。✅ |

---

## 7. 修正済み: ON DELETE CASCADE

| 項目 | 対応 |
|------|------|
| **FK の挙動** | 設計どおり「deleted_at を UPDATE してから DELETE」した行を残すため、`user_requirement_id` を NULL 許容にし、FK を **ON DELETE SET NULL** に変更済み。要件削除時は該当 assignment の deleted_at を更新したうえで user_requirements を DELETE し、DB は参照行の user_requirement_id を NULL にするだけなので行は残る。 |

- 初回マイグレーション `20260304180000`: テーブル作成時から `user_requirement_id NULL` と `ON DELETE SET NULL`。
- 既存環境用 `20260304190000`: 既に CASCADE で作成済みのテーブルを `ALTER` で SET NULL と NULL 許容に変更。

---

## 8. 結論

- **API の入出力・認可・フィルタ**は設計と一致している。
- **適用の判定・表示・Add/Remove・mapping の Save 条件**も設計どおり。
- **要件作成時**は tenant_id は設定せず、作成者が admin である全テナントのメンバーに assignment を挿入。**要件削除時**は deleted_at 更新→DELETE。
以上、コードを詳細に確認した結果、設計（txt）と実装は整合している。ON DELETE は SET NULL に修正済み。
