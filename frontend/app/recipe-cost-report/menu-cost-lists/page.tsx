import { redirect } from "next/navigation";

export default function LegacyMenuCostListsPage() {
  redirect("/cost/recipe-cost-report?tab=menu");
}
