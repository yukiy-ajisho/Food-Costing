import { supabase } from "../config/supabase";

/** 業務テーブル連携完了時に document_inbox を reviewed にする。 */
export async function markDocumentInboxReviewed(params: {
  inboxId: string;
  userId: string;
  tenantId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("document_inbox")
    .update({
      reviewed_at: now,
      reviewed_by: params.userId,
    })
    .eq("id", params.inboxId)
    .eq("tenant_id", params.tenantId)
    .is("reviewed_at", null);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
