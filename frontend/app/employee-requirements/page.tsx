"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Plus, Edit, Trash2, X, HelpCircle, Save } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useCompany } from "@/contexts/CompanyContext";
import { apiRequest } from "@/lib/api";
import {
  userRequirementsAPI,
  type UserRequirement,
} from "@/lib/api/reminder/user-requirements";
import {
  mappingUserRequirementsAPI,
  type MappingUserRequirementRow,
} from "@/lib/api/reminder/mapping-user-requirements";
import { userRequirementAssignmentsAPI } from "@/lib/api/reminder/user-requirement-assignments";
import {
  documentMetadataUserRequirementsAPI,
  type EmployeeRequirementDocumentRow,
} from "@/lib/api/reminder/document-metadata-user-requirements";
import {
  jurisdictionsAPI,
  type JurisdictionRow,
} from "@/lib/api/reminder/jurisdictions";
import {
  userJurisdictionsAPI,
  type UserJurisdictionRow,
} from "@/lib/api/reminder/user-jurisdictions";
import { openPresignedDocumentInNewTab } from "@/lib/open-presigned-document";
import { SearchableSelect } from "@/components/SearchableSelect";

type TabType = "list" | "jurisdiction" | "status" | "documents";

const EXPIRY_RULE_OPTIONS = [
  { value: "", label: "Select..." },
  { value: "rolling", label: "Rolling" },
];

// Status タブ用: 人（API のメンバー + hire_date）
interface StatusPerson {
  id: string; // user_id
  name: string;
  hireDate: string | null;
}

// (personId, requirementId) -> issuedDate, deadline
interface MappingEntry {
  issuedDate: string | null;
  deadline: string | null;
}

function getTodayYYYYMMDD(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateYmd: string, days: number): string {
  const d = new Date(dateYmd + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 日付に月を足す。 */
function addMonths(dateYmd: string, months: number): string {
  const d = new Date(dateYmd + "T12:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** 日付に年を足す（アニバーサリー）。2月29日→平年は2月28日にする。 */
function addYears(dateYmd: string, years: number): string {
  const d = new Date(dateYmd + "T12:00:00");
  const origMonth = d.getMonth();
  d.setFullYear(d.getFullYear() + years);
  if (d.getMonth() !== origMonth) {
    d.setDate(0);
  }
  return d.toISOString().slice(0, 10);
}

function getStatus(expiration: string | null): "ok" | "overdue" | "none" {
  if (expiration == null || expiration === "") return "none";
  const today = getTodayYYYYMMDD();
  return expiration <= today ? "overdue" : "ok";
}

/** Status 一覧で赤（overdue）を先頭に並べるための昇順キー */
function statusSortPriority(expiration: string | null): number {
  const st = getStatus(expiration);
  if (st === "overdue") return 0;
  if (st === "ok") return 1;
  return 2;
}

function formatExpirationDate(expiration: string): string {
  const d = new Date(expiration + "T12:00:00");
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** ドキュメントモーダル左サイド: mapping 1 行の見出し */
function formatMappingGroupLabel(row: MappingUserRequirementRow): string {
  const ymd = (s: string | null) =>
    s && s.trim() !== ""
      ? new Date(s.trim() + "T12:00:00").toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "";
  const issued = ymd(row.issued_date);
  if (issued) return `Issued ${issued}`;
  const spec = ymd(row.specific_date);
  if (spec) return `Due ${spec}`;
  if (row.created_at) {
    return new Date(row.created_at).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  return "—";
}

/** 要件マスタの First due のみから期限を出す（Specific date で deadline 未入力時、および By duration で issued 未設定時）。 */
function expirationFromRequirementFirstDue(
  requirement: UserRequirement,
  person: StatusPerson,
): { expiration: string | null; message?: string } {
  const firstDueOn = requirement.firstDueOnDate;
  if (firstDueOn && firstDueOn.trim() !== "") {
    return { expiration: firstDueOn.trim() };
  }
  const firstDue = requirement.firstDueDate;
  if (firstDue == null || firstDue <= 0) {
    return { expiration: null };
  }
  const hireDate = person.hireDate ?? null;
  if (!hireDate || hireDate === "") {
    return {
      expiration: null,
      message: "Hire date is required to calculate the first due date.",
    };
  }
  return { expiration: addDays(hireDate, firstDue) };
}

/** 表示用の expiration を算出。Specific date: 各人の deadline があればそれのみ、なければ First due。By duration: issued+validity または First due。 */
function getExpiration(
  requirement: UserRequirement,
  entry: MappingEntry,
  person: StatusPerson,
): { expiration: string | null; message?: string } {
  if (!requirement.auto) {
    const d = entry.deadline ?? null;
    if (d && d !== "") {
      return { expiration: d };
    }
    return expirationFromRequirementFirstDue(requirement, person);
  }
  const issuedDate = entry.issuedDate ?? null;
  if (issuedDate && issuedDate !== "") {
    const v = requirement.validityPeriod;
    const unit = requirement.validityPeriodUnit ?? "years";
    if (v != null && v > 0) {
      if (unit === "months") return { expiration: addMonths(issuedDate, v) };
      if (unit === "days") return { expiration: addDays(issuedDate, v) };
      return { expiration: addYears(issuedDate, v) };
    }
    return { expiration: null };
  }
  return expirationFromRequirementFirstDue(requirement, person);
}

function buildStatusMappingFromRows(
  rows: MappingUserRequirementRow[],
  personIds: string[],
  requirementIds: string[],
): Record<string, Record<string, MappingEntry>> {
  const map: Record<string, Record<string, MappingEntry>> = {};
  for (const row of rows) {
    if (!map[row.user_id]) map[row.user_id] = {};
    map[row.user_id][row.user_requirement_id] = {
      issuedDate: row.issued_date ?? null,
      deadline: row.specific_date ?? null,
    };
  }
  personIds.forEach((pid) => {
    if (!map[pid]) map[pid] = {};
    requirementIds.forEach((rid) => {
      if (map[pid][rid] === undefined) {
        map[pid][rid] = { issuedDate: null, deadline: null };
      }
    });
  });
  return map;
}

export default function RequirementsPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { selectedCompanyId } = useCompany();
  const [activeTab, setActiveTab] = useState<TabType>("status");
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const [requirements, setRequirements] = useState<UserRequirement[]>([]);
  const [requirementsLoading, setRequirementsLoading] = useState(true);
  const [requirementsError, setRequirementsError] = useState<string | null>(
    null,
  );
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [requirementSaving, setRequirementSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formAuto, setFormAuto] = useState(false);
  const [formExpiryRule, setFormExpiryRule] = useState("");
  const [formTitle, setFormTitle] = useState("");
  type ValidityPeriodUnit = "years" | "months" | "days";
  const [formValidityUnit, setFormValidityUnit] =
    useState<ValidityPeriodUnit>("years");
  const [formValidityYears, setFormValidityYears] = useState("");
  const [formValidityMonths, setFormValidityMonths] = useState("");
  const [formValidityDays, setFormValidityDays] = useState("");
  type FirstDueMode = "no_due" | "date_on" | "days_from_hire";
  const [formFirstDueMode, setFormFirstDueMode] =
    useState<FirstDueMode>("no_due");
  const [formFirstDueDate, setFormFirstDueDate] = useState(""); // days from hire
  const [formFirstDueOnDate, setFormFirstDueOnDate] = useState(""); // YYYY-MM-DD
  const [formRenewalAdvanceDays, setFormRenewalAdvanceDays] = useState("");

  const [jurisdictionRecords, setJurisdictionRecords] = useState<
    JurisdictionRow[]
  >([]);
  const [userJurisdictionRows, setUserJurisdictionRows] = useState<
    UserJurisdictionRow[]
  >([]);
  const [formJurisdictionId, setFormJurisdictionId] = useState("");
  const [formJurisdictionInput, setFormJurisdictionInput] = useState("");
  const [formJurisdictionMenuOpen, setFormJurisdictionMenuOpen] = useState(false);
  const [newJurisdictionName, setNewJurisdictionName] = useState("");
  const [jurisdictionSaving, setJurisdictionSaving] = useState(false);
  const [createJurisdictionModalOpen, setCreateJurisdictionModalOpen] =
    useState(false);
  const [jurisdictionAssignModalPerson, setJurisdictionAssignModalPerson] =
    useState<Pick<StatusPerson, "id" | "name"> | null>(null);
  const [jurisdictionAssignModalValue, setJurisdictionAssignModalValue] =
    useState("");
  const [jurisdictionEditMode, setJurisdictionEditMode] = useState(false);
  const [jurisdictionNameDrafts, setJurisdictionNameDrafts] = useState<
    Record<string, string>
  >({});
  const [jurisdictionSaveBusy, setJurisdictionSaveBusy] = useState(false);
  const [jurisdictionPendingDeleteIds, setJurisdictionPendingDeleteIds] =
    useState<Set<string>>(new Set());
  const [employeeJurisdictionEditMode, setEmployeeJurisdictionEditMode] =
    useState(false);
  const [employeeJurisdictionSaveBusy, setEmployeeJurisdictionSaveBusy] =
    useState(false);
  const [
    employeeJurisdictionPendingUnlinkKeys,
    setEmployeeJurisdictionPendingUnlinkKeys,
  ] = useState<Set<string>>(new Set());
  const [statusMapping, setStatusMapping] = useState<
    Record<string, Record<string, MappingEntry>>
  >({});
  const [statusAssignments, setStatusAssignments] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [statusPeople, setStatusPeople] = useState<StatusPerson[]>([]);
  const [statusMappingsLoading, setStatusMappingsLoading] = useState(false);
  const [statusMappingsError, setStatusMappingsError] = useState<string | null>(
    null,
  );
  const [jurisdictionLoading, setJurisdictionLoading] = useState(false);
  /** 選択会社について初回の status 用データ取得が済んだら一致する ID（フィルタ再取得ではフルスクリーンロードにしない） */
  const statusDataReadyCompanyIdRef = useRef<string | null>(null);
  const [statusJurisdictionFilterId, setStatusJurisdictionFilterId] =
    useState("");
  const [statusTenantFilterId, setStatusTenantFilterId] = useState("");
  const [companyTenantsForStatus, setCompanyTenantsForStatus] = useState<
    { id: string; name: string }[]
  >([]);
  const jurisdictionComboboxRef = useRef<HTMLDivElement | null>(null);

  /** Documents タブ: 要件アコーディオン */
  const [documentsReqExpandedIds, setDocumentsReqExpandedIds] = useState<
    Set<string>
  >(new Set());
  /** Documents タブ: 人アコーディオン key = `${requirementId}:${personId}` */
  const [documentsPersonExpandedKeys, setDocumentsPersonExpandedKeys] =
    useState<Set<string>>(new Set());
  const [documentsFilesByPersonKey, setDocumentsFilesByPersonKey] = useState<
    Record<string, { doc: EmployeeRequirementDocumentRow; mappingLabel: string }[]>
  >({});
  const [documentsLoadingByPersonKey, setDocumentsLoadingByPersonKey] =
    useState<Record<string, boolean>>({});

  const [employeeDetailPerson, setEmployeeDetailPerson] =
    useState<StatusPerson | null>(null);
  const [recordNewOpenReqId, setRecordNewOpenReqId] = useState<string | null>(
    null,
  );
  const [recordNewDateValue, setRecordNewDateValue] = useState("");
  const [recordNewSaving, setRecordNewSaving] = useState(false);
  const [recordNewError, setRecordNewError] = useState<string | null>(null);

  const isPermissionErrorMessage = (message: string) => {
    return (
      message.includes("Forbidden: Insufficient permissions") ||
      message.includes("Access denied")
    );
  };

  const jurisdictionNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of jurisdictionRecords) m.set(j.id, j.name);
    return m;
  }, [jurisdictionRecords]);

  const normalizeJurisdictionName = (value: string) =>
    value.trim().toLocaleLowerCase();

  const filteredJurisdictionOptions = useMemo(() => {
    const keyword = normalizeJurisdictionName(formJurisdictionInput);
    if (!keyword) return jurisdictionRecords;
    return jurisdictionRecords.filter((j) =>
      normalizeJurisdictionName(j.name).includes(keyword),
    );
  }, [formJurisdictionInput, jurisdictionRecords]);

  const hasExactJurisdictionName = useMemo(() => {
    const keyword = normalizeJurisdictionName(formJurisdictionInput);
    if (!keyword) return false;
    return jurisdictionRecords.some(
      (j) => normalizeJurisdictionName(j.name) === keyword,
    );
  }, [formJurisdictionInput, jurisdictionRecords]);

  const loadJurisdictions = useCallback(async () => {
    if (!selectedCompanyId) {
      setJurisdictionRecords([]);
      setJurisdictionLoading(false);
      return;
    }
    setJurisdictionLoading(true);
    try {
      const rows = await jurisdictionsAPI.list(selectedCompanyId);
      setJurisdictionRecords(rows);
    } catch {
      setJurisdictionRecords([]);
    } finally {
      setJurisdictionLoading(false);
    }
  }, [selectedCompanyId]);

  const fetchRequirements = useCallback(async () => {
    if (!selectedCompanyId) {
      setRequirements([]);
      setRequirementsLoading(false);
      setRequirementsError(null);
      return;
    }
    setRequirementsLoading(true);
    setRequirements([]);
    setRequirementsError(null);
    try {
      const list = await userRequirementsAPI.getAll(selectedCompanyId);
      setRequirements(list);
      if (list.length === 0 || activeTabRef.current === "list") {
        setRequirementsLoading(false);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load requirements";
      if (isPermissionErrorMessage(message)) {
        setPermissionDenied(true);
      } else {
        setRequirementsError(message);
      }
      setRequirementsLoading(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    void fetchRequirements();
  }, [fetchRequirements]);

  useEffect(() => {
    void loadJurisdictions();
  }, [loadJurisdictions]);

  useEffect(() => {
    setStatusJurisdictionFilterId("");
    setStatusTenantFilterId("");
  }, [selectedCompanyId]);

  useEffect(() => {
    statusDataReadyCompanyIdRef.current = null;
    setEmployeeDetailPerson(null);
    setRecordNewOpenReqId(null);
    setRecordNewDateValue("");
    setRecordNewError(null);
    if (!selectedCompanyId) return;
    setStatusPeople([]);
    setUserJurisdictionRows([]);
    setStatusMapping({});
    setStatusAssignments({});
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!selectedCompanyId) {
      setCompanyTenantsForStatus([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiRequest<{ tenants: { id: string; name: string }[] }>(
          `/companies/${selectedCompanyId}/tenants`,
        );
        if (!cancelled) setCompanyTenantsForStatus(res.tenants ?? []);
      } catch {
        if (!cancelled) setCompanyTenantsForStatus([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!statusTenantFilterId) return;
    if (
      companyTenantsForStatus.length > 0 &&
      !companyTenantsForStatus.some((t) => t.id === statusTenantFilterId)
    ) {
      setStatusTenantFilterId("");
    }
  }, [companyTenantsForStatus, statusTenantFilterId]);

  useEffect(() => {
    if (!statusJurisdictionFilterId) return;
    if (
      jurisdictionRecords.length > 0 &&
      !jurisdictionRecords.some((j) => j.id === statusJurisdictionFilterId)
    ) {
      setStatusJurisdictionFilterId("");
    }
  }, [jurisdictionRecords, statusJurisdictionFilterId]);

  const fetchStatusData = useCallback(async () => {
    if (!selectedCompanyId) {
      setStatusPeople([]);
      setUserJurisdictionRows([]);
      setStatusMapping({});
      setStatusAssignments({});
      return;
    }
    setStatusMappingsError(null);
    setStatusMappingsLoading(true);
    try {
      const tenantParam =
        statusTenantFilterId.trim() !== "" &&
        statusJurisdictionFilterId.trim() === ""
          ? `&tenant_id=${encodeURIComponent(statusTenantFilterId.trim())}`
          : "";
      const [{ members }, ujRows] = await Promise.all([
        apiRequest<{
          members: {
            user_id: string;
            name?: string;
            email?: string;
            hire_date?: string | null;
          }[];
        }>(
          `/reminder-members?company_id=${encodeURIComponent(selectedCompanyId)}${tenantParam}`,
        ),
        userJurisdictionsAPI.list(selectedCompanyId),
      ]);
      setUserJurisdictionRows(ujRows ?? []);

      const people: StatusPerson[] = (members ?? []).map((m) => ({
        id: m.user_id,
        name: m.name ?? m.email ?? m.user_id.slice(0, 8),
        hireDate: m.hire_date ?? null,
      }));
      setStatusPeople(people);

      if (requirements.length > 0 && people.length > 0) {
        const requirementIds = requirements.map((r) => r.id);
        const userIds = people.map((p) => p.id);
        const [rows, { assignments }] = await Promise.all([
          mappingUserRequirementsAPI.getMappings({
            user_ids: userIds,
            user_requirement_ids: requirementIds,
          }),
          userRequirementAssignmentsAPI.getAssignments({
            user_ids: userIds,
            user_requirement_ids: requirementIds,
          }),
        ]);
        setStatusMapping(
          buildStatusMappingFromRows(rows, userIds, requirementIds),
        );
        const assignMap: Record<string, Record<string, boolean>> = {};
        for (const a of assignments ?? []) {
          if (!assignMap[a.user_id]) assignMap[a.user_id] = {};
          assignMap[a.user_id][a.user_requirement_id] = a.is_currently_assigned;
        }
        setStatusAssignments(assignMap);
      } else {
        setStatusMapping({});
        setStatusAssignments({});
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load status data";
      if (isPermissionErrorMessage(message)) {
        setPermissionDenied(true);
      } else {
        setStatusMappingsError(message);
      }
    } finally {
      setStatusMappingsLoading(false);
      if (requirements.length > 0) {
        setRequirementsLoading(false);
        if (selectedCompanyId) {
          statusDataReadyCompanyIdRef.current = selectedCompanyId;
        }
      }
    }
  }, [
    requirements,
    selectedCompanyId,
    statusTenantFilterId,
    statusJurisdictionFilterId,
  ]);

  const requirementPassesStatusViewFilter = useCallback(
    (req: UserRequirement, personId: string) => {
      if (!statusAssignments[personId]?.[req.id]) return false;
      if (
        statusJurisdictionFilterId &&
        req.jurisdictionId !== statusJurisdictionFilterId
      ) {
        return false;
      }
      return true;
    },
    [statusAssignments, statusJurisdictionFilterId],
  );

  const employeeDetailJurisdictions = useMemo(() => {
    if (!employeeDetailPerson) return [];
    const jids = userJurisdictionRows
      .filter((r) => r.user_id === employeeDetailPerson.id)
      .map((r) => r.jurisdiction_id);
    return [...new Set(jids)]
      .map((id) => ({
        id,
        name: jurisdictionNameById.get(id) ?? id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [employeeDetailPerson, userJurisdictionRows, jurisdictionNameById]);

  const employeeDetailRequirements = useMemo(() => {
    if (!employeeDetailPerson) return [];
    const person = employeeDetailPerson;
    return requirements
      .filter((req) => requirementPassesStatusViewFilter(req, person.id))
      .sort((a, b) => {
        const entryA = statusMapping[person.id]?.[a.id] ?? {
          issuedDate: null,
          deadline: null,
        };
        const entryB = statusMapping[person.id]?.[b.id] ?? {
          issuedDate: null,
          deadline: null,
        };
        const expA = getExpiration(a, entryA, person).expiration;
        const expB = getExpiration(b, entryB, person).expiration;
        return statusSortPriority(expA) - statusSortPriority(expB);
      });
  }, [
    employeeDetailPerson,
    requirements,
    requirementPassesStatusViewFilter,
    statusMapping,
  ]);

  const statusVisiblePeople = useMemo(() => {
    const withJur = new Set(userJurisdictionRows.map((r) => r.user_id));
    return statusPeople.filter((p) => {
      if (!withJur.has(p.id)) return false;
      if (statusJurisdictionFilterId) {
        const hasJur = userJurisdictionRows.some(
          (r) =>
            r.user_id === p.id &&
            r.jurisdiction_id === statusJurisdictionFilterId,
        );
        if (!hasJur) return false;
      }
      const assigns = statusAssignments[p.id];
      if (!assigns) return false;
      return Object.values(assigns).some((v) => v === true);
    });
  }, [
    statusPeople,
    userJurisdictionRows,
    statusAssignments,
    statusJurisdictionFilterId,
  ]);

  useEffect(() => {
    if (
      activeTab !== "status" &&
      activeTab !== "jurisdiction" &&
      activeTab !== "documents"
    )
      return;
    void fetchStatusData();
  }, [activeTab, fetchStatusData]);

  useEffect(() => {
    setDocumentsReqExpandedIds(new Set());
    setDocumentsPersonExpandedKeys(new Set());
    setDocumentsFilesByPersonKey({});
    setDocumentsLoadingByPersonKey({});
  }, [selectedCompanyId, statusJurisdictionFilterId, statusTenantFilterId]);

  const documentsTabPersonKey = (reqId: string, personId: string) =>
    `${reqId}:${personId}`;

  const loadDocumentsTabFilesForPerson = useCallback(
    async (reqId: string, personId: string, key: string) => {
      setDocumentsLoadingByPersonKey((m) => ({ ...m, [key]: true }));
      try {
        const history = await mappingUserRequirementsAPI.getHistory(
          personId,
          reqId,
        );
        const items: {
          doc: EmployeeRequirementDocumentRow;
          mappingLabel: string;
        }[] = [];
        await Promise.all(
          history.map(async (row) => {
            const label = formatMappingGroupLabel(row);
            try {
              const list =
                await documentMetadataUserRequirementsAPI.getDocuments(row.id);
              for (const doc of list) {
                items.push({ doc, mappingLabel: label });
              }
            } catch {
              /* ignore mapping row */
            }
          }),
        );
        setDocumentsFilesByPersonKey((m) => ({ ...m, [key]: items }));
      } catch {
        setDocumentsFilesByPersonKey((m) => ({ ...m, [key]: [] }));
      } finally {
        setDocumentsLoadingByPersonKey((m) => ({ ...m, [key]: false }));
      }
    },
    [],
  );

  const toggleDocumentsPersonAccordion = (
    reqId: string,
    personId: string,
  ) => {
    const key = documentsTabPersonKey(reqId, personId);
    setDocumentsPersonExpandedKeys((prev) => {
      const next = new Set(prev);
      const wasOpen = next.has(key);
      if (wasOpen) {
        next.delete(key);
      } else {
        next.add(key);
        void loadDocumentsTabFilesForPerson(reqId, personId, key);
      }
      return next;
    });
  };

  const openEmployeeDocPreview = (key: string) => {
    openPresignedDocumentInNewTab(() =>
      documentMetadataUserRequirementsAPI.getDocumentUrl(key),
    );
  };

  const openNewModal = () => {
    setEditingId(null);
    setFormAuto(false);
    setFormExpiryRule("");
    setFormTitle("");
    setFormJurisdictionId("");
    setFormJurisdictionInput("");
    setFormJurisdictionMenuOpen(false);
    setFormValidityUnit("years");
    setFormValidityYears("");
    setFormValidityMonths("");
    setFormValidityDays("");
    setFormFirstDueMode("no_due");
    setFormFirstDueDate("");
    setFormFirstDueOnDate("");
    setFormRenewalAdvanceDays("");
    setModalOpen(true);
  };

  const openEditModal = (r: UserRequirement) => {
    setEditingId(r.id);
    setFormJurisdictionId(r.jurisdictionId ?? "");
    setFormJurisdictionInput(
      r.jurisdictionId ? (jurisdictionNameById.get(r.jurisdictionId) ?? "") : "",
    );
    setFormAuto(r.auto);
    setFormExpiryRule(
      r.expiryRule === "rolling" ||
        r.expiryRule === "rolling_expiry" ||
        r.expiryRule === "anniversary"
        ? "rolling"
        : r.expiryRule || "",
    );
    setFormTitle(r.title);
    const unit =
      r.validityPeriodUnit === "months" || r.validityPeriodUnit === "days"
        ? r.validityPeriodUnit
        : "years";
    setFormValidityUnit(unit);
    const vStr = r.validityPeriod != null ? String(r.validityPeriod) : "";
    setFormValidityYears(unit === "years" ? vStr : "");
    setFormValidityMonths(unit === "months" ? vStr : "");
    setFormValidityDays(unit === "days" ? vStr : "");
    if (r.firstDueOnDate) {
      setFormFirstDueMode("date_on");
      setFormFirstDueOnDate(r.firstDueOnDate);
      setFormFirstDueDate(r.firstDueDate != null ? String(r.firstDueDate) : "");
    } else if (r.firstDueDate != null && r.firstDueDate > 0) {
      setFormFirstDueMode("days_from_hire");
      setFormFirstDueDate(String(r.firstDueDate));
      setFormFirstDueOnDate(r.firstDueOnDate ?? "");
    } else {
      setFormFirstDueMode("no_due");
      setFormFirstDueDate(r.firstDueDate != null ? String(r.firstDueDate) : "");
      setFormFirstDueOnDate(r.firstDueOnDate ?? "");
    }
    setFormRenewalAdvanceDays(
      r.renewalAdvanceDays != null ? String(r.renewalAdvanceDays) : "",
    );
    setFormJurisdictionMenuOpen(false);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setFormJurisdictionInput("");
    setFormJurisdictionMenuOpen(false);
  };

  const closeEmployeeDetailModal = () => {
    setEmployeeDetailPerson(null);
    setRecordNewOpenReqId(null);
    setRecordNewDateValue("");
    setRecordNewError(null);
  };

  const openEmployeeDetailModal = (person: StatusPerson) => {
    setEmployeeDetailPerson(person);
    setRecordNewOpenReqId(null);
    setRecordNewDateValue("");
    setRecordNewError(null);
  };

  const cancelRecordNew = () => {
    setRecordNewOpenReqId(null);
    setRecordNewDateValue("");
    setRecordNewError(null);
  };

  const saveRecordNewForRequirement = useCallback(
    async (req: UserRequirement) => {
      if (!employeeDetailPerson) return;
      const ymd = recordNewDateValue.trim();
      if (!ymd) {
        setRecordNewError("Please select a date.");
        return;
      }
      setRecordNewSaving(true);
      setRecordNewError(null);
      try {
        await mappingUserRequirementsAPI.create({
          user_id: employeeDetailPerson.id,
          user_requirement_id: req.id,
          issued_date: req.auto ? ymd : null,
          specific_date: !req.auto ? ymd : null,
        });
        setRecordNewOpenReqId(null);
        setRecordNewDateValue("");
        setRecordNewError(null);
        await fetchStatusData();
      } catch (err) {
        setRecordNewError(
          err instanceof Error ? err.message : "Failed to save record",
        );
      } finally {
        setRecordNewSaving(false);
      }
    },
    [employeeDetailPerson, recordNewDateValue, fetchStatusData],
  );

  const syncJurisdictionSelectionFromInput = (rawValue: string) => {
    const normalized = normalizeJurisdictionName(rawValue);
    const matched = jurisdictionRecords.find(
      (j) => normalizeJurisdictionName(j.name) === normalized,
    );
    setFormJurisdictionId(matched?.id ?? "");
  };

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (
        jurisdictionComboboxRef.current &&
        !jurisdictionComboboxRef.current.contains(event.target as Node)
      ) {
        setFormJurisdictionMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const handleSave = async () => {
    const validityRaw =
      formValidityUnit === "years"
        ? formValidityYears
        : formValidityUnit === "months"
          ? formValidityMonths
          : formValidityDays;
    const validity =
      validityRaw === ""
        ? null
        : (() => {
            const n = parseInt(validityRaw, 10);
            return Number.isNaN(n) ? null : n;
          })();
    const advance =
      formRenewalAdvanceDays === ""
        ? null
        : parseInt(formRenewalAdvanceDays, 10);
    let firstDueDate: number | null = null;
    let firstDueOnDate: string | null = null;
    if (formFirstDueMode === "days_from_hire" && formFirstDueDate !== "") {
      const n = parseInt(formFirstDueDate, 10);
      if (!Number.isNaN(n) && n >= 1) firstDueDate = n;
    } else if (
      formFirstDueMode === "date_on" &&
      formFirstDueOnDate.trim() !== ""
    ) {
      firstDueOnDate = formFirstDueOnDate.trim();
    }
    const payload = {
      title: formTitle.trim(),
      validity_period: validity,
      validity_period_unit: validity != null ? formValidityUnit : null,
      first_due_date: firstDueDate,
      first_due_on_date: firstDueOnDate,
      renewal_advance_days: advance,
      expiry_rule: formAuto ? formExpiryRule || "rolling" : null,
    };
    if (!selectedCompanyId) {
      alert("Select a company in the header.");
      return;
    }
    setRequirementSaving(true);
    try {
      const jurisdictionName = formJurisdictionInput.trim();
      let resolvedJurisdictionId = formJurisdictionId;
      if (jurisdictionName !== "") {
        const exact = jurisdictionRecords.find(
          (j) =>
            normalizeJurisdictionName(j.name) ===
            normalizeJurisdictionName(jurisdictionName),
        );
        if (exact) {
          resolvedJurisdictionId = exact.id;
        } else {
          const created = await jurisdictionsAPI.create({
            company_id: selectedCompanyId,
            name: jurisdictionName,
          });
          await loadJurisdictions();
          resolvedJurisdictionId = created.id;
          setFormJurisdictionId(created.id);
          setFormJurisdictionInput(created.name);
        }
      }
      if (editingId) {
        await userRequirementsAPI.update(editingId, {
          ...payload,
          jurisdiction_id: resolvedJurisdictionId || undefined,
        });
      } else {
        if (!resolvedJurisdictionId) {
          alert("Select an existing jurisdiction or create a new one.");
          setRequirementSaving(false);
          return;
        }
        await userRequirementsAPI.create(
          selectedCompanyId,
          resolvedJurisdictionId,
          payload,
        );
      }
      closeModal();
      await fetchRequirements();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      if (isPermissionErrorMessage(message)) {
        setPermissionDenied(true);
      } else {
        alert(message);
      }
    } finally {
      setRequirementSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this requirement?")
    )
      return;
    try {
      await userRequirementsAPI.delete(id);
      await fetchRequirements();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete";
      if (isPermissionErrorMessage(message)) {
        setPermissionDenied(true);
      } else {
        alert(message);
      }
    }
  };

  const modalTitle = editingId
    ? (requirements.find((r) => r.id === editingId)?.title ??
      "Edit Requirement")
    : "New Requirement";

  /** Current Status: 会社切替・初回は要件一覧＋管轄一覧＋メンバー／マッピングまでフルロード。テナント／管轄フィルタの再取得ではテーブルを隠さない */
  const statusPanelFullBleedLoading =
    !!selectedCompanyId &&
    !requirementsError &&
    !statusMappingsError &&
    (requirementsLoading ||
      jurisdictionLoading ||
      (statusMappingsLoading &&
        statusDataReadyCompanyIdRef.current !== selectedCompanyId));

  if (permissionDenied) {
    return (
      <div className="px-8 pb-8">
        <div className="max-w-7xl mx-auto">
          <div
            className={`rounded-lg shadow-sm border p-8 text-center transition-colors ${
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-300"
                : "bg-white border-gray-200 text-gray-700"
            }`}
          >
            You don&apos;t have permission.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="px-8 pb-8 [&_a]:cursor-pointer [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed [&_select:not(:disabled)]:cursor-pointer [&_[role=button]:not(:disabled)]:cursor-pointer"
    >
      <div className="max-w-7xl mx-auto">
        {/* タブ（Items ページと同じ位置・見た目） */}
        <div
          className={`pt-4 mb-4 border-b transition-colors ${
            isDark ? "border-slate-700" : "border-gray-200"
          }`}
        >
          <nav className="flex space-x-8 flex-wrap gap-y-2">
            <span className="hidden">
              <button
                type="button"
                onClick={() => setActiveTab("list")}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === "list"
                    ? "border-blue-500 text-blue-600"
                    : isDark
                      ? "border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                Requirements List
              </button>
            </span>
            <button
              type="button"
              onClick={() => setActiveTab("status")}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === "status"
                  ? "border-blue-500 text-blue-600"
                  : isDark
                    ? "border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Current Status
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("documents")}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === "documents"
                  ? "border-blue-500 text-blue-600"
                  : isDark
                    ? "border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Documents
            </button>
            <span
              className={`w-0.5 h-6 shrink-0 self-center ${
                isDark ? "bg-slate-500" : "bg-gray-400"
              }`}
              aria-hidden
              title="Employee-requirements only: jurisdiction is not used on Tenant or Company screens"
            />
            <button
              type="button"
              onClick={() => setActiveTab("jurisdiction")}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === "jurisdiction"
                  ? "border-blue-500 text-blue-600"
                  : isDark
                    ? "border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Jurisdiction
            </button>
          </nav>
        </div>

        {activeTab === "list" && (
          <>
            {!selectedCompanyId ? (
              <div
                className={`rounded-lg border p-6 text-sm ${isDark ? "bg-slate-800 border-slate-700 text-slate-300" : "bg-white border-gray-200 text-gray-600"}`}
              >
                Select a company in the header to manage employee requirements.
              </div>
            ) : null}
            {selectedCompanyId ? (
            <div className="flex justify-between items-center gap-2 mb-6">
              <button
                onClick={openNewModal}
                disabled={jurisdictionRecords.length === 0}
                title={
                  jurisdictionRecords.length === 0
                    ? "Create a jurisdiction first (Jurisdiction tab)"
                    : undefined
                }
                className={`flex items-center gap-2 px-4 py-2 text-white rounded-lg transition-colors ${
                  isDark
                    ? "bg-slate-600 hover:bg-slate-500"
                    : "bg-gray-600 hover:bg-gray-700"
                } ${jurisdictionRecords.length === 0 ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <Plus className="w-5 h-5" />
                Add
              </button>
              <div />
            </div>
            ) : null}
            {selectedCompanyId ? (
            <div
              className={`rounded-lg shadow-sm border transition-colors ${
                isDark
                  ? "bg-slate-800 border-slate-700"
                  : "bg-white border-gray-200"
              }`}
            >
              {requirementsLoading && (
                <div
                  className={`px-6 py-8 text-center ${isDark ? "text-slate-400" : "text-gray-500"}`}
                >
                  Loading...
                </div>
              )}
              {!requirementsLoading && requirementsError && (
                <div className="px-6 py-4 text-red-600 dark:text-red-400">
                  {requirementsError}
                </div>
              )}
              {!requirementsLoading && !requirementsError && (
                <ul className="divide-y divide-gray-200 dark:divide-slate-700">
                  {requirements.map((r) => (
                    <li
                      key={r.id}
                      className={`flex items-center justify-between px-6 py-4 ${
                        isDark ? "text-slate-200" : "text-gray-900"
                      }`}
                    >
                      <div>
                        <span className="font-medium">{r.title}</span>
                        <span
                          className={`ml-2 text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}
                        >
                          {jurisdictionNameById.get(r.jurisdictionId) ??
                            "Jurisdiction"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditModal(r)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                            isDark
                              ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                              : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                          }`}
                        >
                          <Edit className="w-4 h-4" />
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(r.id)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                            isDark
                              ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                              : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                          }`}
                          aria-label="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            ) : null}
          </>
        )}

        {activeTab === "jurisdiction" && selectedCompanyId && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setCreateJurisdictionModalOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
              >
                + Create jurisdiction
              </button>
              {jurisdictionEditMode ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={jurisdictionSaveBusy}
                    onClick={async () => {
                      if (jurisdictionSaveBusy) return;
                      setJurisdictionSaveBusy(true);
                      try {
                        const updates = jurisdictionRecords
                          .map((j) => ({
                            id: j.id,
                            next: (jurisdictionNameDrafts[j.id] ?? j.name).trim(),
                            prev: j.name,
                          }))
                          .filter(
                            (u) =>
                              u.next.length > 0 &&
                              u.next !== u.prev &&
                              !jurisdictionPendingDeleteIds.has(u.id),
                          );
                        const deleteIds = jurisdictionRecords
                          .map((j) => j.id)
                          .filter((id) => jurisdictionPendingDeleteIds.has(id));
                        for (const u of updates) {
                          await jurisdictionsAPI.update(u.id, {
                            name: u.next,
                          });
                        }
                        for (const id of deleteIds) {
                          await jurisdictionsAPI.delete(id);
                        }
                        setJurisdictionEditMode(false);
                        setJurisdictionNameDrafts({});
                        setJurisdictionPendingDeleteIds(new Set());
                        await loadJurisdictions();
                        await fetchRequirements();
                      } catch (e) {
                        alert(
                          e instanceof Error ? e.message : "Failed to save",
                        );
                      } finally {
                        setJurisdictionSaveBusy(false);
                      }
                    }}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={jurisdictionSaveBusy}
                    onClick={() => {
                      setJurisdictionEditMode(false);
                      setJurisdictionNameDrafts({});
                      setJurisdictionPendingDeleteIds(new Set());
                    }}
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isDark
                        ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                        : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                    }`}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const nextDrafts: Record<string, string> = {};
                    jurisdictionRecords.forEach((j) => {
                      nextDrafts[j.id] = j.name;
                    });
                    setJurisdictionNameDrafts(nextDrafts);
                    setJurisdictionPendingDeleteIds(new Set());
                    setJurisdictionEditMode(true);
                  }}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white transition-colors ${
                    isDark
                      ? "bg-slate-600 hover:bg-slate-500"
                      : "bg-gray-600 hover:bg-gray-700"
                  }`}
                >
                  <Edit className="w-4 h-4" />
                  Edit
                </button>
              )}
            </div>
            <div
              className={`rounded-lg border ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}
            >
              <div
                className={`px-4 py-3 border-b text-sm font-medium ${isDark ? "bg-slate-700 border-slate-700 text-slate-200" : "bg-gray-100 border-gray-200 text-gray-800"}`}
              >
                Existing jurisdictions
              </div>
              <ul className="divide-y divide-gray-200 dark:divide-slate-700">
                {jurisdictionRecords.filter(
                  (j) => !jurisdictionPendingDeleteIds.has(j.id),
                ).length === 0 ? (
                  <li
                    className={`px-4 py-6 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}
                  >
                    None yet. Add one above.
                  </li>
                ) : (
                  jurisdictionRecords
                    .filter((j) => !jurisdictionPendingDeleteIds.has(j.id))
                    .map((j) => (
                    <li
                      key={j.id}
                      className={`px-4 py-3 flex items-center justify-between gap-2 ${isDark ? "text-slate-200" : "text-gray-900"}`}
                    >
                      {jurisdictionEditMode ? (
                        <>
                          <input
                            type="text"
                            value={jurisdictionNameDrafts[j.id] ?? j.name}
                            onChange={(e) =>
                              setJurisdictionNameDrafts((prev) => ({
                                ...prev,
                                [j.id]: e.target.value,
                              }))
                            }
                            className={`w-full max-w-xs px-2 py-1 rounded border text-sm ${
                              isDark
                                ? "bg-slate-700 border-slate-600 text-slate-100"
                                : "bg-white border-gray-300 text-gray-900"
                            }`}
                          />
                          <button
                            type="button"
                            className="p-1.5 rounded text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={async () => {
                              setJurisdictionPendingDeleteIds((prev) => {
                                const next = new Set(prev);
                                next.add(j.id);
                                return next;
                              });
                            }}
                            title="Delete jurisdiction"
                            aria-label="Delete jurisdiction"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <span>{j.name}</span>
                      )}
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div className="flex justify-end">
              {employeeJurisdictionEditMode ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={employeeJurisdictionSaveBusy}
                    onClick={async () => {
                      if (!selectedCompanyId || employeeJurisdictionSaveBusy)
                        return;
                      setEmployeeJurisdictionSaveBusy(true);
                      try {
                        const pending = Array.from(
                          employeeJurisdictionPendingUnlinkKeys,
                        );
                        for (const key of pending) {
                          const [userId, jurisdictionId] = key.split("|");
                          if (!userId || !jurisdictionId) continue;
                          await userJurisdictionsAPI.unlink({
                            company_id: selectedCompanyId,
                            user_id: userId,
                            jurisdiction_id: jurisdictionId,
                          });
                        }
                        setEmployeeJurisdictionEditMode(false);
                        setEmployeeJurisdictionPendingUnlinkKeys(new Set());
                        await fetchStatusData();
                      } catch (e) {
                        alert(e instanceof Error ? e.message : "Failed");
                      } finally {
                        setEmployeeJurisdictionSaveBusy(false);
                      }
                    }}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={employeeJurisdictionSaveBusy}
                    onClick={() => {
                      setEmployeeJurisdictionEditMode(false);
                      setEmployeeJurisdictionPendingUnlinkKeys(new Set());
                    }}
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isDark
                        ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                        : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                    }`}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEmployeeJurisdictionPendingUnlinkKeys(new Set());
                    setEmployeeJurisdictionEditMode(true);
                  }}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white transition-colors ${
                    isDark
                      ? "bg-slate-600 hover:bg-slate-500"
                      : "bg-gray-600 hover:bg-gray-700"
                  }`}
                >
                  <Edit className="w-4 h-4" />
                  Edit
                </button>
              )}
            </div>
            <div
              className={`rounded-lg border overflow-x-auto ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}
            >
              <table className="w-full text-sm">
                <thead
                  className={isDark ? "bg-slate-700 text-slate-200" : "bg-gray-100 text-gray-700"}
                >
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Employee</th>
                    <th className="text-left px-4 py-3 font-medium">
                      Jurisdictions
                    </th>
                    <th
                      scope="col"
                      className="text-left px-4 py-3 font-medium"
                      aria-label="Assign jurisdiction"
                    />
                  </tr>
                </thead>
                <tbody>
                  {statusPeople.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className={`px-4 py-6 ${isDark ? "text-slate-400" : "text-gray-500"}`}
                      >
                        No employees in this company&apos;s stores yet.
                      </td>
                    </tr>
                  ) : (
                    statusPeople.map((person) => {
                      const links = userJurisdictionRows.filter(
                        (r) => r.user_id === person.id,
                      );
                      const visibleLinks = links.filter(
                        (l) =>
                          !employeeJurisdictionPendingUnlinkKeys.has(
                            `${l.user_id}|${l.jurisdiction_id}`,
                          ),
                      );
                      const assignedJurIds = new Set(
                        visibleLinks.map((l) => l.jurisdiction_id),
                      );
                      const hasAvailableJurisdiction = jurisdictionRecords.some(
                        (j) => !assignedJurIds.has(j.id),
                      );
                      return (
                        <tr
                          key={person.id}
                          className={
                            isDark ? "border-t border-slate-700" : "border-t border-gray-200"
                          }
                        >
                          <td className="px-4 py-3 font-medium">{person.name}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {visibleLinks.length === 0 ? (
                                <span className="opacity-60">—</span>
                              ) : (
                                visibleLinks.map((l) => (
                                  <span
                                    key={`${l.user_id}-${l.jurisdiction_id}`}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                                      isDark
                                        ? "bg-slate-600 text-slate-100"
                                        : "bg-gray-200 text-gray-800"
                                    }`}
                                  >
                                    {jurisdictionNameById.get(l.jurisdiction_id) ??
                                      l.jurisdiction_id.slice(0, 6)}
                                    {employeeJurisdictionEditMode && (
                                      <button
                                        type="button"
                                        className={`ml-1 rounded-sm ${isDark ? "hover:bg-slate-500" : "hover:bg-gray-300"}`}
                                        onClick={() => {
                                          setEmployeeJurisdictionPendingUnlinkKeys(
                                            (prev) => {
                                              const next = new Set(prev);
                                              next.add(
                                                `${l.user_id}|${l.jurisdiction_id}`,
                                              );
                                              return next;
                                            },
                                          );
                                        }}
                                        aria-label="Unassign jurisdiction"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    )}
                                  </span>
                                ))
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {jurisdictionRecords.length === 0 ? (
                              <span className="opacity-60 text-xs">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1 items-center">
                                <button
                                  type="button"
                                  className={`text-xs px-2 py-1 rounded text-white ${
                                    hasAvailableJurisdiction &&
                                    !employeeJurisdictionEditMode
                                      ? "bg-blue-600 hover:bg-blue-500"
                                      : isDark
                                        ? "bg-slate-600 cursor-not-allowed"
                                        : "bg-gray-400 cursor-not-allowed"
                                  }`}
                                  disabled={
                                    !hasAvailableJurisdiction ||
                                    employeeJurisdictionEditMode
                                  }
                                  onClick={() => {
                                    if (
                                      !hasAvailableJurisdiction ||
                                      employeeJurisdictionEditMode
                                    )
                                      return;
                                    setJurisdictionAssignModalPerson({
                                      id: person.id,
                                      name: person.name,
                                    });
                                    setJurisdictionAssignModalValue("");
                                  }}
                                >
                                  Add
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {jurisdictionAssignModalPerson && (
          <div
            className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black/50 p-4"
            onClick={() => setJurisdictionAssignModalPerson(null)}
          >
            <div
              className={`w-full max-w-md cursor-default rounded-xl border p-6 shadow-xl ${
                isDark
                  ? "bg-slate-800 border-slate-700"
                  : "bg-white border-gray-200"
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                className={`text-lg font-semibold mb-4 ${
                  isDark ? "text-slate-100" : "text-gray-900"
                }`}
              >
                Assign jurisdiction
              </h3>
              <p
                className={`text-sm mb-3 ${isDark ? "text-slate-300" : "text-gray-700"}`}
              >
                {jurisdictionAssignModalPerson.name}
              </p>
              <SearchableSelect
                options={jurisdictionRecords
                  .filter(
                    (j) =>
                      !userJurisdictionRows.some(
                        (r) =>
                          r.user_id === jurisdictionAssignModalPerson.id &&
                          r.jurisdiction_id === j.id,
                      ),
                  )
                  .map((j) => ({ id: j.id, name: j.name }))}
                value={jurisdictionAssignModalValue}
                onChange={setJurisdictionAssignModalValue}
                placeholder="Select..."
                showSubLabel={false}
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setJurisdictionAssignModalPerson(null)}
                  className={`px-4 py-2 rounded-lg text-sm ${
                    isDark
                      ? "bg-slate-600 hover:bg-slate-500 text-slate-100"
                      : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                  }`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!jurisdictionAssignModalValue || !selectedCompanyId}
                  onClick={async () => {
                    if (!selectedCompanyId || !jurisdictionAssignModalValue) {
                      return;
                    }
                    try {
                      const row = await userJurisdictionsAPI.link({
                        company_id: selectedCompanyId,
                        user_id: jurisdictionAssignModalPerson.id,
                        jurisdiction_id: jurisdictionAssignModalValue,
                      });
                      setUserJurisdictionRows((prev) => {
                        if (
                          prev.some(
                            (r) =>
                              r.user_id === row.user_id &&
                              r.jurisdiction_id === row.jurisdiction_id,
                          )
                        ) {
                          return prev;
                        }
                        return [...prev, row];
                      });
                      setJurisdictionAssignModalPerson(null);
                      setJurisdictionAssignModalValue("");
                      await fetchStatusData();
                    } catch (e) {
                      alert(e instanceof Error ? e.message : "Failed");
                    }
                  }}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "jurisdiction" && !selectedCompanyId && (
          <div
            className={`rounded-lg border p-6 text-sm ${isDark ? "bg-slate-800 border-slate-700 text-slate-300" : "bg-white border-gray-200 text-gray-600"}`}
          >
            Select a company in the header to manage jurisdictions.
          </div>
        )}

        {createJurisdictionModalOpen && selectedCompanyId && (
          <div
            className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black/50 p-4"
            onClick={() => {
              if (!jurisdictionSaving) setCreateJurisdictionModalOpen(false);
            }}
          >
            <div
              className={`w-full max-w-md cursor-default rounded-xl border p-6 shadow-xl ${
                isDark
                  ? "bg-slate-800 border-slate-700"
                  : "bg-white border-gray-200"
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                className={`text-lg font-semibold mb-4 ${isDark ? "text-slate-100" : "text-gray-900"}`}
              >
                Create jurisdiction
              </h3>
              <input
                type="text"
                value={newJurisdictionName}
                onChange={(e) => setNewJurisdictionName(e.target.value)}
                placeholder="e.g. California"
                className={`w-full px-3 py-2 rounded-lg border text-sm ${
                  isDark
                    ? "bg-slate-700 border-slate-600 text-slate-200"
                    : "bg-white border-gray-300 text-gray-800"
                }`}
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={jurisdictionSaving}
                  onClick={() => {
                    setCreateJurisdictionModalOpen(false);
                    setNewJurisdictionName("");
                  }}
                  className={`px-4 py-2 rounded-lg text-sm ${
                    isDark
                      ? "bg-slate-600 hover:bg-slate-500 text-slate-100"
                      : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                  }`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={jurisdictionSaving || !newJurisdictionName.trim()}
                  onClick={async () => {
                    if (!selectedCompanyId || !newJurisdictionName.trim())
                      return;
                    setJurisdictionSaving(true);
                    try {
                      await jurisdictionsAPI.create({
                        company_id: selectedCompanyId,
                        name: newJurisdictionName.trim(),
                      });
                      setNewJurisdictionName("");
                      setCreateJurisdictionModalOpen(false);
                      await loadJurisdictions();
                    } catch (e) {
                      alert(
                        e instanceof Error ? e.message : "Failed to create",
                      );
                    } finally {
                      setJurisdictionSaving(false);
                    }
                  }}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {jurisdictionSaving ? "Saving..." : "Create"}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "status" && (
          <div className="space-y-6">
            {!selectedCompanyId ? (
              <div
                className={`rounded-lg border p-6 text-sm ${isDark ? "bg-slate-800 border-slate-700 text-slate-300" : "bg-white border-gray-200 text-gray-600"}`}
              >
                Select a company in the header to view Current Status.
              </div>
            ) : (
              <>
                {statusPanelFullBleedLoading && (
                  <div
                    className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}
                  >
                    Loading status...
                  </div>
                )}
                {!statusPanelFullBleedLoading && statusMappingsError && (
                  <div className="text-red-600 dark:text-red-400 text-sm">
                    {statusMappingsError}
                  </div>
                )}
                {!statusPanelFullBleedLoading && requirementsError && (
                  <div className="px-6 py-4 text-red-600 dark:text-red-400 text-sm">
                    {requirementsError}
                  </div>
                )}
                {!statusPanelFullBleedLoading &&
                  !requirementsError &&
                  !statusMappingsError &&
                  jurisdictionRecords.length === 0 && (
                    <div className="space-y-3">
                      <p
                        className={`text-sm ${isDark ? "text-slate-400" : "text-gray-600"}`}
                      >
                        Create a jurisdiction first. Employee requirements and
                        assignments are scoped by jurisdiction.
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveTab("jurisdiction")}
                        className={`text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400`}
                      >
                        Open Jurisdiction tab
                      </button>
                    </div>
                  )}
                {!statusPanelFullBleedLoading &&
                  !requirementsError &&
                  !statusMappingsError &&
                  jurisdictionRecords.length > 0 &&
                  requirements.length === 0 && (
                    <div className="space-y-3">
                      <div
                        className={`text-sm ${isDark ? "text-slate-400" : "text-gray-600"}`}
                      >
                        No requirements defined yet. Use Add below to create
                        one.
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          openNewModal();
                        }}
                        className={`flex items-center gap-2 px-4 py-2 text-white rounded-lg transition-colors ${
                          isDark
                            ? "bg-slate-600 hover:bg-slate-500"
                            : "bg-gray-600 hover:bg-gray-700"
                        }`}
                      >
                        <Plus className="w-5 h-5" />
                        Add requirement
                      </button>
                    </div>
                  )}
                {!statusPanelFullBleedLoading &&
                  !requirementsError &&
                  !statusMappingsError &&
                  jurisdictionRecords.length > 0 &&
                  requirements.length > 0 && (
                    <div className="flex flex-wrap gap-4 items-end">
                      <div className="min-w-0 w-full sm:w-auto sm:min-w-48">
                        <label
                          className={`block text-xs mb-1 ${
                            isDark ? "text-slate-300" : "text-gray-600"
                          }`}
                        >
                          Jurisdiction
                        </label>
                        <select
                          value={statusJurisdictionFilterId}
                          onChange={(e) => {
                            const v = e.target.value;
                            setStatusJurisdictionFilterId(v);
                            if (v !== "") setStatusTenantFilterId("");
                          }}
                          className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                            isDark
                              ? "bg-slate-700 border-slate-600 text-slate-100"
                              : "bg-white border-gray-300 text-gray-900"
                          }`}
                        >
                          <option value="">All</option>
                          {jurisdictionRecords.map((j) => (
                            <option key={j.id} value={j.id}>
                              {j.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="min-w-0 w-full sm:w-auto sm:min-w-48">
                        <label
                          className={`block text-xs mb-1 ${
                            isDark ? "text-slate-300" : "text-gray-600"
                          }`}
                        >
                          Tenant
                        </label>
                        <select
                          value={statusTenantFilterId}
                          onChange={(e) => {
                            const v = e.target.value;
                            setStatusTenantFilterId(v);
                            if (v !== "") setStatusJurisdictionFilterId("");
                          }}
                          disabled={companyTenantsForStatus.length === 0}
                          className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:opacity-50 ${
                            isDark
                              ? "bg-slate-700 border-slate-600 text-slate-100"
                              : "bg-white border-gray-300 text-gray-900"
                          }`}
                        >
                          <option value="">All</option>
                          {companyTenantsForStatus.length === 0 ? null : (
                            companyTenantsForStatus.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))
                          )}
                        </select>
                      </div>
                    </div>
                  )}
                {!statusPanelFullBleedLoading &&
                  !requirementsError &&
                  !statusMappingsError &&
                  requirements.length > 0 &&
                  statusPeople.length === 0 && (
                    <div className="space-y-2">
                      <p
                        className={`text-sm ${isDark ? "text-slate-400" : "text-gray-600"}`}
                      >
                        No employees found for this company&apos;s stores yet.
                        People appear here when they have a profile in a linked
                        tenant.
                      </p>
                    </div>
                  )}
                {!statusPanelFullBleedLoading &&
                  !requirementsError &&
                  !statusMappingsError &&
                  requirements.length > 0 &&
                  statusPeople.length > 0 &&
                  statusVisiblePeople.length === 0 && (
                    <div className="space-y-3">
                      <p
                        className={`text-sm ${isDark ? "text-slate-400" : "text-gray-600"}`}
                      >
                        Assign at least one jurisdiction to each employee and
                        ensure they have an active requirement assignment. Use
                        the Jurisdiction tab to link people to jurisdictions; sync
                        will apply matching requirements.
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveTab("jurisdiction")}
                        className={`text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400`}
                      >
                        Open Jurisdiction tab
                      </button>
                    </div>
                  )}
                {!statusPanelFullBleedLoading &&
                  !requirementsError &&
                  !statusMappingsError &&
                  statusVisiblePeople.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          openNewModal();
                        }}
                        className={`flex items-center gap-2 px-4 py-2 text-white rounded-lg transition-colors ${
                          isDark
                            ? "bg-slate-600 hover:bg-slate-500"
                            : "bg-gray-600 hover:bg-gray-700"
                        }`}
                      >
                        <Plus className="w-5 h-5" />
                        Add requirement
                      </button>
                      <div
                        className={`rounded-lg shadow-sm border overflow-x-auto transition-colors ${
                          isDark
                            ? "bg-slate-800 border-slate-700"
                            : "bg-white border-gray-200"
                        }`}
                      >
                        <table className="w-full">
                          <thead
                            className={isDark ? "bg-slate-700" : "bg-gray-50"}
                          >
                            <tr>
                              <th
                                className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDark ? "text-slate-300" : "text-gray-500"}`}
                              >
                                Name
                              </th>
                              <th
                                className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDark ? "text-slate-300" : "text-gray-500"}`}
                              >
                                Upcoming requirements
                              </th>
                            </tr>
                          </thead>
                          <tbody
                            style={{
                              borderTop: isDark
                                ? "1px solid #334155"
                                : "1px solid #e5e7eb",
                            }}
                          >
                            {statusVisiblePeople.map((person) => (
                              <tr
                                key={person.id}
                                className={
                                  isDark
                                    ? "border-b border-slate-700"
                                    : "border-b border-gray-200"
                                }
                              >
                                <td className="px-4 py-3">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openEmployeeDetailModal(person)
                                    }
                                    className={`font-medium text-left hover:underline focus:outline-none focus-visible:ring-2 rounded ${
                                      isDark
                                        ? "text-slate-200 focus-visible:ring-slate-500"
                                        : "text-gray-900 focus-visible:ring-blue-500"
                                    }`}
                                  >
                                    {person.name}
                                  </button>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex flex-wrap gap-1.5">
                                    {requirements
                                      .filter((req) =>
                                        requirementPassesStatusViewFilter(
                                          req,
                                          person.id,
                                        ),
                                      )
                                      .sort((a, b) => {
                                        const entryA =
                                          statusMapping[person.id]?.[a.id] ?? {
                                            issuedDate: null,
                                            deadline: null,
                                          };
                                        const entryB =
                                          statusMapping[person.id]?.[b.id] ?? {
                                            issuedDate: null,
                                            deadline: null,
                                          };
                                        const expA = getExpiration(
                                          a,
                                          entryA,
                                          person,
                                        ).expiration;
                                        const expB = getExpiration(
                                          b,
                                          entryB,
                                          person,
                                        ).expiration;
                                        return (
                                          statusSortPriority(expA) -
                                          statusSortPriority(expB)
                                        );
                                      })
                                      .map((req) => {
                                        const entry = statusMapping[person.id]?.[
                                          req.id
                                        ] ?? {
                                          issuedDate: null,
                                          deadline: null,
                                        };
                                        const { expiration, message } =
                                          getExpiration(req, entry, person);
                                        const st = getStatus(expiration);
                                        const badgeSurface = isDark
                                          ? "border-slate-600 bg-slate-800/70 text-slate-200"
                                          : "border-gray-200 bg-white text-gray-900";
                                        const dotClass =
                                          st === "overdue"
                                            ? isDark
                                              ? "bg-red-400"
                                              : "bg-red-500"
                                            : "";
                                        return (
                                          <span
                                            key={req.id}
                                            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-sm border max-w-full ${badgeSurface}`}
                                            title={
                                              expiration
                                                ? `Expiration: ${formatExpirationDate(expiration)}`
                                                : message ||
                                                  "No expiration date"
                                            }
                                          >
                                            {st === "overdue" && (
                                              <span
                                                className={`shrink-0 size-2 rounded-full ${dotClass}`}
                                                aria-hidden
                                              />
                                            )}
                                            <span className="break-words">
                                              {req.title}
                                            </span>
                                          </span>
                                        );
                                      })}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
              </>
            )}
          </div>
        )}

        {activeTab === "documents" && (
          <div className="space-y-6">
            {!selectedCompanyId ? (
              <div
                className={`rounded-lg border p-6 text-sm ${isDark ? "bg-slate-800 border-slate-700 text-slate-300" : "bg-white border-gray-200 text-gray-600"}`}
              >
                Select a company in the header to view documents.
              </div>
            ) : (
              <>
                {statusPanelFullBleedLoading && (
                  <div
                    className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}
                  >
                    Loading documents…
                  </div>
                )}
                {!statusPanelFullBleedLoading && statusMappingsError && (
                  <div className="text-red-600 dark:text-red-400 text-sm">
                    {statusMappingsError}
                  </div>
                )}
                {!statusPanelFullBleedLoading && requirementsError && (
                  <div className="px-6 py-4 text-red-600 dark:text-red-400 text-sm">
                    {requirementsError}
                  </div>
                )}
                {!statusPanelFullBleedLoading &&
                  !requirementsError &&
                  !statusMappingsError &&
                  jurisdictionRecords.length === 0 && (
                    <div className="space-y-3">
                      <p
                        className={`text-sm ${isDark ? "text-slate-400" : "text-gray-600"}`}
                      >
                        Create a jurisdiction first. Employee requirements and
                        assignments are scoped by jurisdiction.
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveTab("jurisdiction")}
                        className={`text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400`}
                      >
                        Open Jurisdiction tab
                      </button>
                    </div>
                  )}
                {!statusPanelFullBleedLoading &&
                  !requirementsError &&
                  !statusMappingsError &&
                  jurisdictionRecords.length > 0 &&
                  requirements.length === 0 && (
                    <div className="space-y-3">
                      <div
                        className={`text-sm ${isDark ? "text-slate-400" : "text-gray-600"}`}
                      >
                        No requirements defined yet. Use Requirements List to
                        create one.
                      </div>
                    </div>
                  )}
                {!statusPanelFullBleedLoading &&
                  !requirementsError &&
                  !statusMappingsError &&
                  requirements.length > 0 &&
                  statusPeople.length === 0 && (
                    <div className="space-y-2">
                      <p
                        className={`text-sm ${isDark ? "text-slate-400" : "text-gray-600"}`}
                      >
                        No employees found for this company&apos;s stores yet.
                        People appear here when they have a profile in a linked
                        tenant.
                      </p>
                    </div>
                  )}
                {!statusPanelFullBleedLoading &&
                  !requirementsError &&
                  !statusMappingsError &&
                  requirements.length > 0 &&
                  statusPeople.length > 0 &&
                  statusVisiblePeople.length === 0 && (
                    <div className="space-y-3">
                      <p
                        className={`text-sm ${isDark ? "text-slate-400" : "text-gray-600"}`}
                      >
                        Assign at least one jurisdiction to each employee and
                        ensure they have an active requirement assignment.
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveTab("jurisdiction")}
                        className={`text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400`}
                      >
                        Open Jurisdiction tab
                      </button>
                    </div>
                  )}
                {!statusPanelFullBleedLoading &&
                  !requirementsError &&
                  !statusMappingsError &&
                  statusVisiblePeople.length > 0 && (
                    <>
                      <div className="flex flex-wrap gap-4 items-end">
                        <div className="min-w-0 w-full sm:w-auto sm:min-w-48">
                          <label
                            className={`block text-xs mb-1 ${
                              isDark ? "text-slate-300" : "text-gray-600"
                            }`}
                          >
                            Jurisdiction
                          </label>
                          <select
                            value={statusJurisdictionFilterId}
                            onChange={(e) => {
                              const v = e.target.value;
                              setStatusJurisdictionFilterId(v);
                              if (v !== "") setStatusTenantFilterId("");
                            }}
                            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                              isDark
                                ? "bg-slate-700 border-slate-600 text-slate-100"
                                : "bg-white border-gray-300 text-gray-900"
                            }`}
                          >
                            <option value="">All</option>
                            {jurisdictionRecords.map((j) => (
                              <option key={j.id} value={j.id}>
                                {j.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="min-w-0 w-full sm:w-auto sm:min-w-48">
                          <label
                            className={`block text-xs mb-1 ${
                              isDark ? "text-slate-300" : "text-gray-600"
                            }`}
                          >
                            Tenant
                          </label>
                          <select
                            value={statusTenantFilterId}
                            onChange={(e) => {
                              const v = e.target.value;
                              setStatusTenantFilterId(v);
                              if (v !== "") setStatusJurisdictionFilterId("");
                            }}
                            disabled={companyTenantsForStatus.length === 0}
                            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:opacity-50 ${
                              isDark
                                ? "bg-slate-700 border-slate-600 text-slate-100"
                                : "bg-white border-gray-300 text-gray-900"
                            }`}
                          >
                            <option value="">All</option>
                            {companyTenantsForStatus.length === 0 ? null : (
                              companyTenantsForStatus.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))
                            )}
                          </select>
                        </div>
                      </div>
                      <div
                        className={`rounded-lg shadow-sm border overflow-hidden transition-colors ${
                          isDark
                            ? "bg-slate-800 border-slate-700"
                            : "bg-white border-gray-200"
                        }`}
                      >
                        <ul className="divide-y divide-gray-200 dark:divide-slate-700">
                          {[...requirements]
                            .sort((a, b) =>
                              a.title.localeCompare(b.title, undefined, {
                                sensitivity: "base",
                              }),
                            )
                            .map((req) => {
                              const peopleForReq = statusVisiblePeople.filter(
                                (p) =>
                                  requirementPassesStatusViewFilter(req, p.id),
                              );
                              const isReqOpen =
                                documentsReqExpandedIds.has(req.id);
                              return (
                                <li
                                  key={req.id}
                                  className={
                                    isDark ? "bg-slate-800" : "bg-white"
                                  }
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDocumentsReqExpandedIds((prev) => {
                                        const n = new Set(prev);
                                        if (n.has(req.id)) {
                                          n.delete(req.id);
                                        } else {
                                          n.add(req.id);
                                        }
                                        return n;
                                      });
                                    }}
                                    className={`w-full px-4 py-3 text-left flex items-center justify-between font-medium ${isDark ? "text-slate-200 hover:bg-slate-700" : "text-gray-900 hover:bg-gray-50"}`}
                                  >
                                    <span className="min-w-0 truncate text-left">
                                      {req.title}
                                      <span
                                        className={`ml-2 text-xs font-normal ${isDark ? "text-slate-400" : "text-gray-500"}`}
                                      >
                                        {jurisdictionNameById.get(
                                          req.jurisdictionId,
                                        ) ?? ""}
                                      </span>
                                    </span>
                                    <span
                                      className={`text-sm shrink-0 ${isDark ? "text-slate-400" : "text-gray-500"}`}
                                    >
                                      {isReqOpen ? "▼" : "▶"}
                                    </span>
                                  </button>
                                  {isReqOpen && (
                                    <div
                                      className={`pl-4 pr-0 pt-3 pb-3 ${isDark ? "bg-slate-950" : "bg-gray-200"}`}
                                    >
                                      {peopleForReq.length === 0 ? (
                                        <div
                                          className={`text-sm py-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}
                                        >
                                          No employees in this view for this
                                          requirement.
                                        </div>
                                      ) : (
                                        <ul className="divide-y divide-gray-200 dark:divide-slate-700">
                                          {peopleForReq.map((person) => {
                                            const pKey = documentsTabPersonKey(
                                              req.id,
                                              person.id,
                                            );
                                            const pOpen =
                                              documentsPersonExpandedKeys.has(
                                                pKey,
                                              );
                                            const fileRows =
                                              documentsFilesByPersonKey[
                                                pKey
                                              ] ?? [];
                                            const pLoading =
                                              documentsLoadingByPersonKey[
                                                pKey
                                              ] === true;
                                            return (
                                              <li
                                                key={person.id}
                                                className={
                                                  isDark
                                                    ? "bg-slate-800"
                                                    : "bg-white"
                                                }
                                              >
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    toggleDocumentsPersonAccordion(
                                                      req.id,
                                                      person.id,
                                                    )
                                                  }
                                                  className={`w-full px-4 py-3 text-left flex items-center justify-between font-medium ${isDark ? "text-slate-200 hover:bg-slate-700" : "text-gray-900 hover:bg-gray-50"}`}
                                                >
                                                  <span className="truncate min-w-0">
                                                    {person.name}
                                                  </span>
                                                  <span
                                                    className={`text-sm shrink-0 ml-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}
                                                  >
                                                    {pOpen ? "▼" : "▶"}
                                                  </span>
                                                </button>
                                                {pOpen && (
                                                  <div
                                                    className={`pl-4 pr-0 pt-3 pb-3 ${isDark ? "bg-slate-950" : "bg-gray-200"}`}
                                                  >
                                                    {pLoading ? (
                                                      <div
                                                        className={`text-sm py-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}
                                                      >
                                                        Loading...
                                                      </div>
                                                    ) : fileRows.length === 0 ? (
                                                      <div
                                                        className={`text-sm py-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}
                                                      >
                                                        No documents for this
                                                        employee.
                                                      </div>
                                                    ) : (
                                                      <ul className="space-y-1.5">
                                                        {fileRows.map(
                                                          ({
                                                            doc,
                                                            mappingLabel,
                                                          }) => (
                                                            <li
                                                              key={doc.id}
                                                              className={`flex items-center gap-3 text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}
                                                            >
                                                              <span
                                                                className={`shrink-0 w-28 text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}
                                                              >
                                                                {mappingLabel}
                                                              </span>
                                                              <button
                                                                type="button"
                                                                onClick={(
                                                                  e,
                                                                ) => {
                                                                  e.stopPropagation();
                                                                  openEmployeeDocPreview(
                                                                    doc.value,
                                                                  );
                                                                }}
                                                                className={`text-blue-600 hover:underline dark:text-blue-400 ${isDark ? "hover:text-blue-300" : "hover:text-blue-700"}`}
                                                              >
                                                                {doc.file_name}
                                                              </button>
                                                            </li>
                                                          ),
                                                        )}
                                                      </ul>
                                                    )}
                                                  </div>
                                                )}
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      )}
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                        </ul>
                      </div>
                    </>
                  )}
              </>
            )}
          </div>
        )}

      </div>

      {employeeDetailPerson && (
        <div
          className="fixed inset-0 z-[60] flex cursor-pointer items-center justify-center bg-black/50 p-4"
          onClick={() => !recordNewSaving && closeEmployeeDetailModal()}
        >
          <div
            className={`cursor-default rounded-xl shadow-xl w-full flex flex-col max-h-[min(90vh,40rem)] ${
              isDark
                ? "bg-slate-800 border border-slate-700"
                : "bg-white border border-gray-200"
            }`}
            style={{ maxWidth: "min(36rem, 100%)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`flex items-start justify-between gap-4 px-6 py-4 border-b shrink-0 ${
                isDark ? "border-slate-700" : "border-gray-200"
              }`}
            >
              <div className="min-w-0">
                <h3
                  className={`text-lg font-semibold ${isDark ? "text-slate-100" : "text-gray-900"}`}
                >
                  {employeeDetailPerson.name}
                </h3>
                {employeeDetailJurisdictions.length > 0 && (
                  <div className="mt-2">
                    <p
                      className={`text-sm ${isDark ? "text-slate-200" : "text-gray-800"}`}
                    >
                      <span
                        className={`font-medium ${isDark ? "text-slate-400" : "text-gray-600"}`}
                      >
                        Assigned jurisdiction:
                      </span>{" "}
                      {employeeDetailJurisdictions.map((j) => j.name).join(", ")}
                    </p>
                  </div>
                )}
              </div>
              <button
                type="button"
                disabled={recordNewSaving}
                onClick={closeEmployeeDetailModal}
                className={`shrink-0 p-1 rounded-md ${
                  isDark
                    ? "text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-50"
                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
                }`}
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
              {recordNewError && (
                <div className="text-sm text-red-600 dark:text-red-400">
                  {recordNewError}
                </div>
              )}
              {employeeDetailRequirements.map((req) => {
                const entry = statusMapping[employeeDetailPerson.id]?.[
                  req.id
                ] ?? {
                  issuedDate: null,
                  deadline: null,
                };
                const { expiration, message } = getExpiration(
                  req,
                  entry,
                  employeeDetailPerson,
                );
                const st = getStatus(expiration);
                const dotClass =
                  st === "overdue"
                    ? isDark
                      ? "bg-red-400"
                      : "bg-red-500"
                    : isDark
                      ? "bg-slate-500"
                      : "bg-gray-400";
                const isRecording = recordNewOpenReqId === req.id;
                return (
                  <div
                    key={req.id}
                    className={`rounded-lg border p-4 ${
                      isDark
                        ? "border-slate-600 bg-slate-800/50"
                        : "border-gray-200 bg-gray-50/80"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h4
                        className={`text-base font-medium min-w-0 flex-1 ${
                          isDark ? "text-slate-100" : "text-gray-900"
                        }`}
                      >
                        {req.title}
                      </h4>
                      <div className="flex flex-wrap items-center gap-3 shrink-0">
                        <span
                          className={`text-sm ${
                            isDark ? "text-slate-500" : "text-gray-500"
                          }`}
                          title="Document upload will be available in a later update"
                        >
                          Document
                        </span>
                        <button
                          type="button"
                          disabled={recordNewSaving || isRecording}
                          onClick={() => {
                            setRecordNewOpenReqId(req.id);
                            setRecordNewDateValue("");
                            setRecordNewError(null);
                          }}
                          className={`text-sm px-3 py-1.5 rounded-md border transition-colors ${
                            isDark
                              ? "border-slate-500 text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                              : "border-gray-400 text-gray-800 hover:bg-gray-100 disabled:opacity-50"
                          }`}
                        >
                          Record new
                        </button>
                      </div>
                    </div>
                    <div
                      className={`my-3 border-t ${
                        isDark ? "border-slate-600" : "border-gray-200"
                      }`}
                    />
                    {isRecording ? (
                      <div className="space-y-2">
                        <label
                          className={`block text-sm font-medium ${
                            isDark ? "text-slate-300" : "text-gray-700"
                          }`}
                        >
                          {req.auto ? "Issue date" : "Deadline"}
                        </label>
                        <div className="flex flex-wrap items-end gap-3">
                          <input
                            type="date"
                            value={recordNewDateValue}
                            onChange={(e) =>
                              setRecordNewDateValue(e.target.value)
                            }
                            disabled={recordNewSaving}
                            className={`min-w-0 flex-1 max-w-xs px-3 py-2 rounded-md border text-sm ${
                              isDark
                                ? "bg-slate-700 border-slate-600 text-slate-100"
                                : "bg-white border-gray-300 text-gray-900"
                            }`}
                          />
                          <div className="flex flex-wrap gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={recordNewSaving}
                              onClick={() =>
                                void saveRecordNewForRequirement(req)
                              }
                              className={`text-sm px-4 py-2 rounded-md text-white ${
                                isDark
                                  ? "bg-slate-600 hover:bg-slate-500 disabled:opacity-50"
                                  : "bg-gray-700 hover:bg-gray-600 disabled:opacity-50"
                              }`}
                            >
                              {recordNewSaving ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              disabled={recordNewSaving}
                              onClick={cancelRecordNew}
                              className={`text-sm px-4 py-2 rounded-md border ${
                                isDark
                                  ? "border-slate-500 text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                                  : "border-gray-300 text-gray-800 hover:bg-gray-100 disabled:opacity-50"
                              }`}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={
                              isDark ? "text-slate-400" : "text-gray-600"
                            }
                          >
                            Due date
                          </span>
                          <span
                            className={`shrink-0 size-2 rounded-full ${dotClass}`}
                            title={
                              expiration
                                ? `Expiration: ${formatExpirationDate(expiration)}`
                                : message || "No due date"
                            }
                            aria-hidden
                          />
                          <span
                            className={`font-medium ${
                              isDark ? "text-slate-100" : "text-gray-900"
                            }`}
                            title={
                              expiration
                                ? `Expiration: ${formatExpirationDate(expiration)}`
                                : message || "No due date"
                            }
                          >
                            {expiration
                              ? formatExpirationDate(expiration)
                              : "—"}
                          </span>
                        </div>
                        {req.auto ? (
                          <div
                            className={
                              isDark ? "text-slate-300" : "text-gray-800"
                            }
                          >
                            <span
                              className={
                                isDark ? "text-slate-400" : "text-gray-600"
                              }
                            >
                              Issued date:{" "}
                            </span>
                            {entry.issuedDate
                              ? formatExpirationDate(entry.issuedDate)
                              : "—"}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* モーダル */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black/50"
          onClick={() => !requirementSaving && closeModal()}
        >
          <div
            className={`cursor-default rounded-xl shadow-xl w-full mx-4 overflow-visible ${
              isDark
                ? "bg-slate-800 border border-slate-700"
                : "bg-white border border-gray-200"
            }`}
            style={{ maxWidth: "min(32rem, 90vw)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`px-8 py-5 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}
            >
              <h3
                className={`text-xl font-semibold ${isDark ? "text-slate-100" : "text-gray-900"}`}
              >
                {modalTitle}
              </h3>
            </div>
            <div className="p-8 space-y-5">
              <div>
                <label
                  className={`flex items-center gap-1.5 text-base font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}
                >
                  Title
                  <span className="group relative inline-flex shrink-0 text-current opacity-70 cursor-help">
                    <HelpCircle className="w-4 h-4" aria-hidden />
                    <span
                      className={`absolute left-full top-1/2 -translate-y-1/2 ml-1.5 px-2.5 py-1.5 text-xs font-normal whitespace-normal min-w-[320px] max-w-[640px] rounded shadow-lg z-100 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 ${
                        isDark
                          ? "bg-slate-600 text-slate-100"
                          : "bg-gray-800 text-white"
                      }`}
                    >
                      Name of this requirement (e.g. Food handler, I-9, Driver
                      license).
                    </span>
                  </span>
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className={`w-full px-4 py-2.5 rounded-lg border text-base ${
                    isDark
                      ? "bg-slate-700 border-slate-600 text-slate-200"
                      : "bg-white border-gray-300 text-gray-700"
                  }`}
                  placeholder="e.g. Food handler"
                />
              </div>
              <div>
                <label
                  className={`block text-base font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}
                >
                  Jurisdiction
                </label>
                <div className="relative" ref={jurisdictionComboboxRef}>
                  <input
                    type="text"
                    value={formJurisdictionInput}
                    onChange={(e) => {
                      const next = e.target.value;
                      setFormJurisdictionInput(next);
                      syncJurisdictionSelectionFromInput(next);
                      setFormJurisdictionMenuOpen(true);
                    }}
                    onFocus={() => setFormJurisdictionMenuOpen(true)}
                    placeholder="Select existing or type a new jurisdiction"
                    className={`w-full px-4 py-2.5 rounded-lg border text-base ${
                      isDark
                        ? "bg-slate-700 border-slate-600 text-slate-200"
                        : "bg-white border-gray-300 text-gray-700"
                    }`}
                  />
                  {formJurisdictionMenuOpen && (
                    <div
                      className={`absolute z-20 mt-1 w-full rounded-lg border shadow-lg overflow-hidden ${
                        isDark
                          ? "bg-slate-800 border-slate-600"
                          : "bg-white border-gray-200"
                      }`}
                    >
                      <div className="max-h-64 overflow-y-auto">
                        {filteredJurisdictionOptions.map((j) => (
                          <button
                            key={j.id}
                            type="button"
                            onClick={() => {
                              setFormJurisdictionId(j.id);
                              setFormJurisdictionInput(j.name);
                              setFormJurisdictionMenuOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2 text-sm ${
                              isDark
                                ? "hover:bg-slate-700 text-slate-100"
                                : "hover:bg-gray-100 text-gray-800"
                            } ${
                              formJurisdictionId === j.id
                                ? isDark
                                  ? "bg-slate-700"
                                  : "bg-blue-50"
                                : ""
                            }`}
                          >
                            {j.name}
                          </button>
                        ))}
                        {formJurisdictionInput.trim() !== "" &&
                          !hasExactJurisdictionName && (
                            <div
                              className={`w-full text-left px-3 py-2 text-sm border-t ${
                                isDark
                                  ? "border-slate-600 text-blue-300"
                                  : "border-gray-200 text-blue-700"
                              }`}
                            >
                              {`+ Create "${formJurisdictionInput.trim()}"`}
                            </div>
                          )}
                        {filteredJurisdictionOptions.length === 0 &&
                          (formJurisdictionInput.trim() === "" ||
                            hasExactJurisdictionName) && (
                            <div
                              className={`px-3 py-2 text-sm ${
                                isDark ? "text-slate-400" : "text-gray-500"
                              }`}
                            >
                              No jurisdictions found
                            </div>
                          )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <fieldset className="border-0 p-0 m-0 flex flex-col gap-2">
                  <legend
                    className={`flex items-center gap-1.5 text-base font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}
                  >
                    Renewal
                    <span className="group relative inline-flex shrink-0 text-current opacity-70 cursor-help">
                      <HelpCircle className="w-4 h-4" aria-hidden />
                      <span
                        className={`absolute left-full top-1/2 -translate-y-1/2 ml-1.5 px-2.5 py-1.5 text-xs font-normal whitespace-normal min-w-[320px] max-w-[640px] rounded shadow-lg z-100 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 ${
                          isDark
                            ? "bg-slate-600 text-slate-100"
                            : "bg-gray-800 text-white"
                        }`}
                      >
                        By duration: expiration is calculated from the issue
                        date and validity period. Specific date: you enter the
                        deadline for each person directly.
                      </span>
                    </span>
                  </legend>
                  <div className="flex gap-4">
                    <label
                      className={`flex items-center gap-2 cursor-pointer text-base ${isDark ? "text-slate-200" : "text-gray-800"}`}
                    >
                      <input
                        type="radio"
                        name="renewal"
                        checked={formAuto}
                        onChange={() => {
                          setFormAuto(true);
                          setFormExpiryRule("rolling");
                        }}
                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      By duration
                    </label>
                    <label
                      className={`flex items-center gap-2 cursor-pointer text-base ${isDark ? "text-slate-200" : "text-gray-800"}`}
                    >
                      <input
                        type="radio"
                        name="renewal"
                        checked={!formAuto}
                        onChange={() => setFormAuto(false)}
                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      Specific date
                    </label>
                  </div>
                </fieldset>
              </div>
              {formAuto && (
                <>
                  <div>
                    <label
                      className={`flex items-center gap-1.5 text-base font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}
                    >
                      Expiry Rule
                      <span className="group relative inline-flex shrink-0 text-current opacity-70 cursor-help">
                        <HelpCircle className="w-4 h-4" aria-hidden />
                        <span
                          className={`absolute left-full top-1/2 -translate-y-1/2 ml-1.5 px-2.5 py-1.5 text-xs font-normal whitespace-normal min-w-[320px] max-w-[640px] rounded shadow-lg z-100 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 ${
                            isDark
                              ? "bg-slate-600 text-slate-100"
                              : "bg-gray-800 text-white"
                          }`}
                        >
                          When renewal is by duration: how we calculate
                          expiration. Issued-based: expiration = issue date +
                          validity period. Not used with specific date.
                        </span>
                      </span>
                    </label>
                    <select
                      value={formExpiryRule}
                      onChange={(e) => setFormExpiryRule(e.target.value)}
                      className={`w-full px-4 py-2.5 rounded-lg border text-base ${
                        isDark
                          ? "bg-slate-700 border-slate-600 text-slate-200"
                          : "bg-white border-gray-300 text-gray-700"
                      }`}
                    >
                      {EXPIRY_RULE_OPTIONS.map((opt) => (
                        <option key={opt.value || "empty"} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <fieldset className="border-0 p-0 m-0 flex flex-col gap-3">
                      <legend
                        className={`flex items-center gap-1.5 text-base font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}
                      >
                        Valid period
                        <span className="group relative inline-flex shrink-0 text-current opacity-70 cursor-help">
                          <HelpCircle className="w-4 h-4" aria-hidden />
                          <span
                            className={`absolute left-full top-1/2 -translate-y-1/2 ml-1.5 px-2.5 py-1.5 text-xs font-normal whitespace-normal min-w-[320px] max-w-[640px] rounded shadow-lg z-100 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 ${
                              isDark
                                ? "bg-slate-600 text-slate-100"
                                : "bg-gray-800 text-white"
                            }`}
                          >
                            When renewal is by duration: how long the
                            requirement is valid from the issue date. Choose
                            years, months, or days.
                          </span>
                        </span>
                      </legend>
                      <div className="flex flex-col gap-2">
                        <label
                          className={`flex items-center gap-2 cursor-pointer text-base ${isDark ? "text-slate-200" : "text-gray-800"}`}
                        >
                          <input
                            type="radio"
                            name="validity_period"
                            checked={formValidityUnit === "years"}
                            onChange={() => setFormValidityUnit("years")}
                            className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                          />
                          Years
                          <input
                            type="number"
                            min={1}
                            value={formValidityYears}
                            onChange={(e) =>
                              setFormValidityYears(e.target.value)
                            }
                            disabled={formValidityUnit !== "years"}
                            className={`ml-2 w-24 px-3 py-1.5 rounded-lg border text-sm ${
                              formValidityUnit !== "years"
                                ? isDark
                                  ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed opacity-60"
                                  : "bg-gray-100 border-gray-200 text-gray-500 cursor-not-allowed opacity-60"
                                : isDark
                                  ? "bg-slate-700 border-slate-600 text-slate-200"
                                  : "bg-white border-gray-300 text-gray-700"
                            }`}
                            placeholder="e.g. 3"
                          />
                        </label>
                        <label
                          className={`flex items-center gap-2 cursor-pointer text-base ${isDark ? "text-slate-200" : "text-gray-800"}`}
                        >
                          <input
                            type="radio"
                            name="validity_period"
                            checked={formValidityUnit === "months"}
                            onChange={() => setFormValidityUnit("months")}
                            className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                          />
                          Months
                          <input
                            type="number"
                            min={1}
                            value={formValidityMonths}
                            onChange={(e) =>
                              setFormValidityMonths(e.target.value)
                            }
                            disabled={formValidityUnit !== "months"}
                            className={`ml-2 w-24 px-3 py-1.5 rounded-lg border text-sm ${
                              formValidityUnit !== "months"
                                ? isDark
                                  ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed opacity-60"
                                  : "bg-gray-100 border-gray-200 text-gray-500 cursor-not-allowed opacity-60"
                                : isDark
                                  ? "bg-slate-700 border-slate-600 text-slate-200"
                                  : "bg-white border-gray-300 text-gray-700"
                            }`}
                            placeholder="e.g. 6"
                          />
                        </label>
                        <label
                          className={`flex items-center gap-2 cursor-pointer text-base ${isDark ? "text-slate-200" : "text-gray-800"}`}
                        >
                          <input
                            type="radio"
                            name="validity_period"
                            checked={formValidityUnit === "days"}
                            onChange={() => setFormValidityUnit("days")}
                            className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                          />
                          Days
                          <input
                            type="number"
                            min={1}
                            value={formValidityDays}
                            onChange={(e) =>
                              setFormValidityDays(e.target.value)
                            }
                            disabled={formValidityUnit !== "days"}
                            className={`ml-2 w-24 px-3 py-1.5 rounded-lg border text-sm ${
                              formValidityUnit !== "days"
                                ? isDark
                                  ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed opacity-60"
                                  : "bg-gray-100 border-gray-200 text-gray-500 cursor-not-allowed opacity-60"
                                : isDark
                                  ? "bg-slate-700 border-slate-600 text-slate-200"
                                  : "bg-white border-gray-300 text-gray-700"
                            }`}
                            placeholder="e.g. 90"
                          />
                        </label>
                      </div>
                    </fieldset>
                  </div>
                </>
              )}
              <div>
                <fieldset className="border-0 p-0 m-0 flex flex-col gap-3">
                  <legend
                    className={`flex items-center gap-1.5 text-base font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}
                  >
                    First due date
                    <span className="group relative inline-flex shrink-0 text-current opacity-70 cursor-help">
                      <HelpCircle className="w-4 h-4" aria-hidden />
                      <span
                        className={`absolute left-full top-1/2 -translate-y-1/2 ml-1.5 px-2.5 py-1.5 text-xs font-normal whitespace-normal min-w-[320px] max-w-[640px] rounded shadow-lg z-100 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 ${
                          isDark
                            ? "bg-slate-600 text-slate-100"
                            : "bg-gray-800 text-white"
                        }`}
                      >
                        Days from hire and first due date on: used until
                        each person has a saved deadline (Specific date) or
                        issue date (By duration). No first due date: no
                        template first due date. For Specific date, after you
                        enter their deadline, first due date is ignored for that
                        person.
                      </span>
                    </span>
                  </legend>
                  <div className="flex flex-col gap-2">
                    <label
                      className={`flex items-center gap-2 cursor-pointer text-base ${isDark ? "text-slate-200" : "text-gray-800"}`}
                    >
                      <input
                        type="radio"
                        name="first_due"
                        checked={formFirstDueMode === "days_from_hire"}
                        onChange={() =>
                          setFormFirstDueMode("days_from_hire")
                        }
                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      Days from hire
                      <input
                        type="number"
                        min={1}
                        value={formFirstDueDate}
                        onChange={(e) =>
                          setFormFirstDueDate(e.target.value)
                        }
                        disabled={formFirstDueMode !== "days_from_hire"}
                        className={`ml-2 w-24 px-3 py-1.5 rounded-lg border text-sm ${
                          formFirstDueMode !== "days_from_hire"
                            ? isDark
                              ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed opacity-60"
                              : "bg-gray-100 border-gray-200 text-gray-500 cursor-not-allowed opacity-60"
                            : isDark
                              ? "bg-slate-700 border-slate-600 text-slate-200"
                              : "bg-white border-gray-300 text-gray-700"
                        }`}
                        placeholder="e.g. 3"
                      />
                    </label>
                    <label
                      className={`flex items-center gap-2 cursor-pointer text-base ${isDark ? "text-slate-200" : "text-gray-800"}`}
                    >
                      <input
                        type="radio"
                        name="first_due"
                        checked={formFirstDueMode === "date_on"}
                        onChange={() => setFormFirstDueMode("date_on")}
                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      First due date on
                      <input
                        type="date"
                        value={formFirstDueOnDate}
                        onChange={(e) =>
                          setFormFirstDueOnDate(e.target.value)
                        }
                        disabled={formFirstDueMode !== "date_on"}
                        className={`ml-2 px-3 py-1.5 rounded-lg border text-sm ${
                          formFirstDueMode !== "date_on"
                            ? isDark
                              ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed opacity-60"
                              : "bg-gray-100 border-gray-200 text-gray-500 cursor-not-allowed opacity-60"
                            : isDark
                              ? "bg-slate-700 border-slate-600 text-slate-200"
                              : "bg-white border-gray-300 text-gray-700"
                        }`}
                      />
                    </label>
                    <label
                      className={`flex items-center gap-2 cursor-pointer text-base ${isDark ? "text-slate-200" : "text-gray-800"}`}
                    >
                      <input
                        type="radio"
                        name="first_due"
                        checked={formFirstDueMode === "no_due"}
                        onChange={() => setFormFirstDueMode("no_due")}
                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      No first due date
                    </label>
                  </div>
                </fieldset>
              </div>
              {formAuto && (
                <div>
                  <label
                    className={`flex items-center gap-1.5 text-base font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}
                  >
                    Renewal notice (days before)
                    <span className="group relative inline-flex shrink-0 text-current opacity-70 cursor-help">
                      <HelpCircle className="w-4 h-4" aria-hidden />
                      <span
                        className={`absolute left-full top-1/2 -translate-y-1/2 ml-1.5 px-2.5 py-1.5 text-xs font-normal whitespace-normal min-w-[320px] max-w-[640px] rounded shadow-lg z-100 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 ${
                          isDark
                            ? "bg-slate-600 text-slate-100"
                            : "bg-gray-800 text-white"
                        }`}
                      >
                        How many days before the expiration date the employee
                        can or should renew. Used for renewal reminders.
                      </span>
                    </span>
                  </label>
                  <input
                    type="number"
                    value={formRenewalAdvanceDays}
                    onChange={(e) =>
                      setFormRenewalAdvanceDays(e.target.value)
                    }
                    className={`w-full px-4 py-2.5 rounded-lg border text-base ${
                      isDark
                        ? "bg-slate-700 border-slate-600 text-slate-200"
                        : "bg-white border-gray-300 text-gray-700"
                    }`}
                    placeholder="e.g. 30"
                  />
                </div>
              )}
            </div>
            <div
              className={`flex justify-end gap-2 px-8 py-5 border-t ${
                isDark ? "border-slate-700" : "border-gray-200"
              }`}
            >
              <button
                type="button"
                onClick={closeModal}
                disabled={requirementSaving}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  requirementSaving
                    ? "opacity-60 cursor-not-allowed"
                    : isDark
                      ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                <X className="w-5 h-5" />
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={requirementSaving}
                className={`flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg transition-colors ${
                  requirementSaving
                    ? "opacity-60 cursor-not-allowed"
                    : "hover:bg-blue-700"
                }`}
              >
                {requirementSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
