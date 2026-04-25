-- Add user as company_director for a specific company.
-- SQL Editor friendly (no DO block).

INSERT INTO public.company_members (company_id, user_id, role)
VALUES (
  '7e416b1d-1b37-4250-a17f-aaf19e2e26ff'::uuid,
  '448f1ee6-2efa-46a5-ba4a-0d9bfdeb1011'::uuid,
  'company_director'::public.company_member_role
)
ON CONFLICT (company_id, user_id)
DO UPDATE
SET role = 'company_director'::public.company_member_role;

