import { redirect } from "next/navigation";

export default function LegacyRecipeCostReportPage() {
  redirect("/cost/recipe-cost-report?tab=wholesale");
}
