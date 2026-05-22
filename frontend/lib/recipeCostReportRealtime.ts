import { createClient } from "./supabase-client";

export function subscribeWholesaleListLines(
  wholesaleListId: string | null | undefined,
  onInsert: () => void,
): () => void {
  if (!wholesaleListId) return () => undefined;

  const supabase = createClient();
  const channel = supabase
    .channel(`wl-lines-${wholesaleListId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "wholesale_list_lines",
        filter: `wholesale_list_id=eq.${wholesaleListId}`,
      },
      () => {
        onInsert();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
