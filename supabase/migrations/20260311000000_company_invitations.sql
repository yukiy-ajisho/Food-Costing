-- =========================================================
-- Company invitations: invite users as company_director
-- =========================================================

CREATE TABLE public.company_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'expired', 'canceled')),
  email_status text CHECK (email_status IN ('delivered', 'failed')),
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  email_id text
);

COMMENT ON TABLE public.company_invitations IS '会社への director 招待。受け入れ時に company_members に追加。';

CREATE UNIQUE INDEX idx_company_invitations_unique_pending
  ON public.company_invitations (email, company_id) WHERE status = 'pending';

CREATE INDEX idx_company_invitations_company_id ON public.company_invitations(company_id);
CREATE INDEX idx_company_invitations_token ON public.company_invitations(token);
CREATE INDEX idx_company_invitations_status ON public.company_invitations(status);
CREATE INDEX idx_company_invitations_expires_at ON public.company_invitations(expires_at);
CREATE INDEX idx_company_invitations_email ON public.company_invitations(email);
CREATE INDEX idx_company_invitations_created_by ON public.company_invitations(created_by);

GRANT ALL ON TABLE public.company_invitations TO anon;
GRANT ALL ON TABLE public.company_invitations TO authenticated;
GRANT ALL ON TABLE public.company_invitations TO service_role;
