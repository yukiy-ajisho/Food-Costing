-- Reset wl_test_list to scenario A (no members / lines). Apply before scoped or WL-none wholesale runs.
BEGIN;
DELETE FROM wholesale_list_lines WHERE wholesale_list_id = '44444444-4444-4444-4444-444444444401';
DELETE FROM wholesale_list_members WHERE wholesale_list_id = '44444444-4444-4444-4444-444444444401';
COMMIT;
