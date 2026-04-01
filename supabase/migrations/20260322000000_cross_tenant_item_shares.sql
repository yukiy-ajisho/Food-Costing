-- Cross-tenant item shares: 同一 company 内テナント間での prepped item 公開設定。
-- resource_shares と同じパターンで allowed_actions を使う。
-- target_type = 'company': 会社全体に公開（target_id = company_id）
-- target_type = 'tenant' : 特定テナントのみ公開（target_id = 対象 tenant_id）

CREATE TABLE IF NOT EXISTS public.cross_tenant_item_shares (
  id              uuid        DEFAULT gen_random_uuid() NOT NULL,
  company_id      uuid        NOT NULL,
  item_id         uuid        NOT NULL,
  owner_tenant_id uuid        NOT NULL,
  target_type     text        NOT NULL,
  target_id       text        NOT NULL,
  created_by      uuid        NOT NULL,
  allowed_actions text[]      NOT NULL DEFAULT ARRAY['read'::text],
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cross_tenant_item_shares_pkey PRIMARY KEY (id),

  CONSTRAINT cross_tenant_item_shares_target_type_check
    CHECK (target_type = ANY (ARRAY['company'::text, 'tenant'::text])),

  -- 同一 item + target の組み合わせは 1 レコードのみ
  CONSTRAINT cross_tenant_item_shares_item_target_unique
    UNIQUE (item_id, target_type, target_id),

  CONSTRAINT cross_tenant_item_shares_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,

  CONSTRAINT cross_tenant_item_shares_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE,

  CONSTRAINT cross_tenant_item_shares_owner_tenant_id_fkey
    FOREIGN KEY (owner_tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,

  CONSTRAINT cross_tenant_item_shares_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.cross_tenant_item_shares IS
  '同一 company 内テナント間での prepped item 公開設定。'
  'target_type=company: 会社全体公開、target_type=tenant: 特定テナントのみ。';

COMMENT ON COLUMN public.cross_tenant_item_shares.allowed_actions IS
  'read のみ許可。空配列は明示的な hide 状態（レコードなし = デフォルト hide）。';

-- インデックス
CREATE INDEX idx_cross_tenant_item_shares_company_id
  ON public.cross_tenant_item_shares (company_id);

CREATE INDEX idx_cross_tenant_item_shares_item_id
  ON public.cross_tenant_item_shares (item_id);

CREATE INDEX idx_cross_tenant_item_shares_owner_tenant
  ON public.cross_tenant_item_shares (owner_tenant_id);

CREATE INDEX idx_cross_tenant_item_shares_target
  ON public.cross_tenant_item_shares (target_type, target_id);

-- updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION public.set_updated_at_cross_tenant_item_shares()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cross_tenant_item_shares_updated_at
  BEFORE UPDATE ON public.cross_tenant_item_shares
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_cross_tenant_item_shares();

-- RLS 有効化
ALTER TABLE public.cross_tenant_item_shares ENABLE ROW LEVEL SECURITY;

-- 読み取りポリシー:
-- 自分の tenant が属する company の shares を読める（owner として / 閲覧対象として）
-- または company_member（company_admin / company_director）
CREATE POLICY cross_tenant_item_shares_select
  ON public.cross_tenant_item_shares
  FOR SELECT
  USING (
    company_id IN (
      SELECT ct.company_id
      FROM public.company_tenants ct
      JOIN public.profiles p ON p.tenant_id = ct.tenant_id
      WHERE p.user_id = auth.uid()
    )
    OR
    company_id IN (
      SELECT cm.company_id
      FROM public.company_members cm
      WHERE cm.user_id = auth.uid()
    )
  );

-- 書き込みポリシー（INSERT）:
-- テナントの admin/director: 自分のテナントが owner のレコードのみ
-- company_admin / company_director: その company 配下のレコードすべて
CREATE POLICY cross_tenant_item_shares_insert
  ON public.cross_tenant_item_shares
  FOR INSERT
  WITH CHECK (
    owner_tenant_id IN (
      SELECT p.tenant_id FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.role IN ('admin', 'director')
    )
    OR
    company_id IN (
      SELECT cm.company_id FROM public.company_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.role IN ('company_admin', 'company_director')
    )
  );

CREATE POLICY cross_tenant_item_shares_update
  ON public.cross_tenant_item_shares
  FOR UPDATE
  USING (
    owner_tenant_id IN (
      SELECT p.tenant_id FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.role IN ('admin', 'director')
    )
    OR
    company_id IN (
      SELECT cm.company_id FROM public.company_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.role IN ('company_admin', 'company_director')
    )
  );

CREATE POLICY cross_tenant_item_shares_delete
  ON public.cross_tenant_item_shares
  FOR DELETE
  USING (
    owner_tenant_id IN (
      SELECT p.tenant_id FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.role IN ('admin', 'director')
    )
    OR
    company_id IN (
      SELECT cm.company_id FROM public.company_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.role IN ('company_admin', 'company_director')
    )
  );

-- アプリケーションロール用の GRANT
GRANT ALL ON TABLE public.cross_tenant_item_shares TO anon;
GRANT ALL ON TABLE public.cross_tenant_item_shares TO authenticated;
GRANT ALL ON TABLE public.cross_tenant_item_shares TO service_role;
