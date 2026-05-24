import type { CostBasis, ListMemberRow } from "./recipeCostReport";

export function defaultCostBasisForMenuMember(
  listMode: "company_owned" | "franchise",
  wholesaleCostBasisSelectable: boolean,
  onLinkedWl: boolean,
  linkedWholesalePrice: number | null,
): CostBasis {
  if (listMode !== "franchise" || !wholesaleCostBasisSelectable) {
    return "corporate";
  }
  if (
    onLinkedWl &&
    linkedWholesalePrice != null &&
    linkedWholesalePrice > 0 &&
    Number.isFinite(linkedWholesalePrice)
  ) {
    return "wholesale";
  }
  return "corporate";
}

export function wholesaleCostBasisSelectable(
  rowOrFlag:
    | boolean
    | Pick<ListMemberRow, "wholesale_cost_basis_selectable">,
): boolean {
  if (typeof rowOrFlag === "boolean") return rowOrFlag;
  return rowOrFlag.wholesale_cost_basis_selectable === true;
}

export function effectiveCostBasis(
  row: ListMemberRow,
  listMode: "company_owned" | "franchise",
): CostBasis {
  if (listMode === "company_owned") return "corporate";
  const basis = row.cost_basis === "wholesale" ? "wholesale" : "corporate";
  if (
    basis === "wholesale" &&
    !wholesaleCostBasisSelectable(row)
  ) {
    return "corporate";
  }
  return basis;
}

export function costBasisLabel(basis: CostBasis): string {
  return basis === "wholesale" ? "Wholesale" : "Corporate";
}
