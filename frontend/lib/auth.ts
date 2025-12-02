import { createClient } from "./supabase-client";

export async function signOut() {
  const supabase = createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Error signing out:", error);
    throw error;
  }
}
