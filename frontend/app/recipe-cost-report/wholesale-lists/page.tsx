import { redirect } from "next/navigation";

export default function LegacyWholesaleListsPage() {
  redirect("/cost/recipe-cost-report?tab=wholesale");
}
