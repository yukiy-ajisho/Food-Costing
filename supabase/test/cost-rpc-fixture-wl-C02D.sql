-- C02: P303 member only (no price line)
-- Apply after cost-rpc-fixture-base.sql
BEGIN;
DELETE FROM wholesale_list_lines WHERE wholesale_list_id = '44444444-4444-4444-4444-444444444401';
DELETE FROM wholesale_list_members WHERE wholesale_list_id = '44444444-4444-4444-4444-444444444401';
INSERT INTO wholesale_list_members (id, wholesale_list_id, item_id, created_by) VALUES
  ('e1000001-1111-4111-8111-000000000204', '44444444-4444-4444-4444-444444444401', '66666666-6666-6666-6666-666666660303', '22222222-2222-2222-2222-222222222201');
COMMIT;

