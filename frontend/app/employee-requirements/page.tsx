"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Edit, Trash2, X, HelpCircle } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
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

type TabType = "list" | "status";

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

function formatExpirationDate(expiration: string): string {
  const d = new Date(expiration + "T12:00:00");
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** 表示用の expiration を算出。Auto OFF → specific_date / Auto ON → 初回期限 or issued+validity。 */
function getExpiration(
  requirement: UserRequirement,
  entry: MappingEntry,
  person: StatusPerson,
): { expiration: string | null; message?: string } {
  if (!requirement.auto) {
    const d = entry.deadline ?? null;
    return { expiration: d && d !== "" ? d : null };
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
  const [activeTab, setActiveTab] = useState<TabType>("list");
  const [requirements, setRequirements] = useState<UserRequirement[]>([]);
  const [requirementsLoading, setRequirementsLoading] = useState(true);
  const [requirementsError, setRequirementsError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [requirementSaving, setRequirementSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formAuto, setFormAuto] = useState(false);
  const [formExpiryRule, setFormExpiryRule] = useState("");
  const [formTitle, setFormTitle] = useState("");
  type ValidityPeriodUnit = "years" | "months" | "days";
  const [formValidityUnit, setFormValidityUnit] = useState<ValidityPeriodUnit>("years");
  const [formValidityYears, setFormValidityYears] = useState("");
  const [formValidityMonths, setFormValidityMonths] = useState("");
  const [formValidityDays, setFormValidityDays] = useState("");
  type FirstDueMode = "no_due" | "date_on" | "days_from_hire";
  const [formFirstDueMode, setFormFirstDueMode] = useState<FirstDueMode>("no_due");
  const [formFirstDueDate, setFormFirstDueDate] = useState(""); // days from hire
  const [formFirstDueOnDate, setFormFirstDueOnDate] = useState(""); // YYYY-MM-DD
  const [formRenewalAdvanceDays, setFormRenewalAdvanceDays] = useState("");

  // Requirements Status タブ用（requirement 編集と person 編集は排他）
  const [showByPeople, setShowByPeople] = useState(true);
  const [editingRequirementId, setEditingRequirementId] = useState<
    string | null
  >(null);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [statusPeople, setStatusPeople] = useState<StatusPerson[]>([]);
  const [statusMappingsLoading, setStatusMappingsLoading] = useState(false);
  const [statusMappingsError, setStatusMappingsError] = useState<string | null>(null);
  const [savingCell, setSavingCell] = useState<{
    personId: string;
    requirementId: string;
  } | null>(null);

  const isPermissionErrorMessage = (message: string) => {
    return (
      message.includes("Forbidden: Insufficient permissions") ||
      message.includes("Access denied")
    );
  };

  const fetchRequirements = async () => {
    setRequirementsLoading(true);
    setRequirementsError(null);
    try {
      const list = await userRequirementsAPI.getAll();
      setRequirements(list);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load requirements";
      if (isPermissionErrorMessage(message)) {
        setPermissionDenied(true);
      } else {
        setRequirementsError(message);
      }
    } finally {
      setRequirementsLoading(false);
    }
  };

  useEffect(() => {
    fetchRequirements();
  }, []);

  const startEditingRequirement = (reqId: string) => {
    setEditingPersonId(null);
    setEditingRequirementId((prev) => (prev === reqId ? null : reqId));
  };

  const startEditingPerson = (personId: string) => {
    setEditingRequirementId(null);
    setEditingPersonId((prev) => (prev === personId ? null : personId));
  };

  const [statusMapping, setStatusMapping] = useState<
    Record<string, Record<string, MappingEntry>>
  >({});
  /** (personId, requirementId) -> 適用しているか。無い or false = 適用外 */
  const [statusAssignments, setStatusAssignments] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [assignmentToggling, setAssignmentToggling] = useState<{
    personId: string;
    requirementId: string;
  } | null>(null);

  const fetchStatusData = useCallback(async () => {
    setStatusMappingsError(null);
    setStatusMappingsLoading(true);
    try {
      const { members } = await apiRequest<{
        members: {
          user_id: string;
          name?: string;
          email?: string;
          hire_date?: string | null;
        }[];
      }>("/reminder-members");
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
    }
  }, [requirements]);

  useEffect(() => {
    if (activeTab !== "status") return;
    fetchStatusData();
  }, [activeTab, fetchStatusData]);

  const updateStatusEntry = (
    personId: string,
    requirementId: string,
    field: "issuedDate" | "deadline",
    value: string | null,
  ) => {
    setStatusMapping((prev) => ({
      ...prev,
      [personId]: {
        ...prev[personId],
        [requirementId]: {
          ...(prev[personId]?.[requirementId] ?? {
            issuedDate: null,
            deadline: null,
          }),
          [field]: value || null,
        },
      },
    }));
  };

  const saveMapping = async (
    personId: string,
    requirementId: string,
    requirement: UserRequirement,
  ) => {
    const entry = statusMapping[personId]?.[requirementId] ?? {
      issuedDate: null,
      deadline: null,
    };
    setSavingCell({ personId, requirementId });
    try {
      await mappingUserRequirementsAPI.create({
        user_id: personId,
        user_requirement_id: requirementId,
        issued_date: entry.issuedDate ?? undefined,
        specific_date: requirement.auto ? undefined : entry.deadline ?? undefined,
      });
      await fetchStatusData();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      if (isPermissionErrorMessage(message)) {
        setPermissionDenied(true);
      } else {
        alert(message);
      }
    } finally {
      setSavingCell(null);
    }
  };

  const toggleAssignment = async (
    personId: string,
    requirementId: string,
    assigned: boolean,
  ) => {
    setAssignmentToggling({ personId, requirementId });
    try {
      await userRequirementAssignmentsAPI.patchAssignment({
        user_id: personId,
        user_requirement_id: requirementId,
        is_currently_assigned: assigned,
      });
      setStatusAssignments((prev) => ({
        ...prev,
        [personId]: {
          ...prev[personId],
          [requirementId]: assigned,
        },
      }));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update assignment";
      if (isPermissionErrorMessage(message)) {
        setPermissionDenied(true);
      } else {
        alert(message);
      }
    } finally {
      setAssignmentToggling(null);
    }
  };

  const openNewModal = () => {
    setEditingId(null);
    setFormAuto(false);
    setFormExpiryRule("");
    setFormTitle("");
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
    setFormAuto(r.auto);
    setFormExpiryRule(
      r.expiryRule === "rolling" ||
        r.expiryRule === "rolling_expiry" ||
        r.expiryRule === "anniversary"
        ? "rolling"
        : r.expiryRule || "",
    );
    setFormTitle(r.title);
    const unit = (r.validityPeriodUnit === "months" || r.validityPeriodUnit === "days")
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
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
  };

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
    } else if (formFirstDueMode === "date_on" && formFirstDueOnDate.trim() !== "") {
      firstDueOnDate = formFirstDueOnDate.trim();
    }
    const payload = {
      title: formTitle.trim(),
      validity_period: validity,
      validity_period_unit: validity != null ? formValidityUnit : null,
      first_due_date: firstDueDate,
      first_due_on_date: firstDueOnDate,
      renewal_advance_days: advance,
      expiry_rule: formAuto ? (formExpiryRule || "rolling") : null,
    };
    setRequirementSaving(true);
    try {
      if (editingId) {
        await userRequirementsAPI.update(editingId, payload);
      } else {
        await userRequirementsAPI.create(payload);
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
    if (typeof window !== "undefined" && !window.confirm("Delete this requirement?")) return;
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
    <div className="px-8 pb-8">
      <div className="max-w-7xl mx-auto">
        {/* タブ（Items ページと同じ位置・見た目） */}
        <div
          className={`pt-4 mb-4 border-b transition-colors ${
            isDark ? "border-slate-700" : "border-gray-200"
          }`}
        >
          <nav className="flex space-x-8">
            <button
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
            <button
              onClick={() => setActiveTab("status")}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === "status"
                  ? "border-blue-500 text-blue-600"
                  : isDark
                    ? "border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Requirements Status
            </button>
          </nav>
        </div>

        {activeTab === "list" && (
          <>
            <div className="flex justify-between items-center gap-2 mb-6">
              <button
                onClick={openNewModal}
                className={`flex items-center gap-2 px-4 py-2 text-white rounded-lg transition-colors ${
                  isDark
                    ? "bg-slate-600 hover:bg-slate-500"
                    : "bg-gray-600 hover:bg-gray-700"
                }`}
              >
                <Plus className="w-5 h-5" />
                Add
              </button>
              <div />
            </div>
            <div
              className={`rounded-lg shadow-sm border transition-colors ${
                isDark
                  ? "bg-slate-800 border-slate-700"
                  : "bg-white border-gray-200"
              }`}
            >
              {requirementsLoading && (
                <div className={`px-6 py-8 text-center ${isDark ? "text-slate-400" : "text-gray-500"}`}>
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
                    <span className="font-medium">{r.title}</span>
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
          </>
        )}

        {activeTab === "status" && (
            <div className="space-y-6">
            {statusMappingsLoading && (
              <div className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Loading status...
              </div>
            )}
            {!statusMappingsLoading && statusMappingsError && (
              <div className="text-red-600 dark:text-red-400 text-sm">
                {statusMappingsError}
              </div>
            )}
            {!statusMappingsLoading && !statusMappingsError && requirements.length === 0 && (
              <div className={`text-sm ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                No requirements defined. Add requirements in the Requirements List tab.
              </div>
            )}
            {!statusMappingsLoading && !statusMappingsError && requirements.length > 0 && statusPeople.length === 0 && (
              <div className={`text-sm ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                No people to display.
              </div>
            )}
            {!statusMappingsLoading && !statusMappingsError && requirements.length > 0 && statusPeople.length > 0 && (
            <>
            <div className="flex items-center gap-4">
              <span
                className={`text-sm font-medium ${isDark ? "text-slate-300" : "text-gray-700"}`}
              >
                Show by
              </span>
              <div
                className="flex rounded-lg border overflow-hidden"
                style={{ borderColor: isDark ? "#475569" : "#e5e7eb" }}
              >
                <button
                  type="button"
                  onClick={() => setShowByPeople(true)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    showByPeople
                      ? "bg-blue-600 text-white"
                      : isDark
                        ? "bg-slate-700 text-slate-300 hover:bg-slate-600"
                        : "bg-white text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  people
                </button>
                <button
                  type="button"
                  onClick={() => setShowByPeople(false)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    !showByPeople
                      ? "bg-blue-600 text-white"
                      : isDark
                        ? "bg-slate-700 text-slate-300 hover:bg-slate-600"
                        : "bg-white text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  requirements
                </button>
              </div>
            </div>

            <div
              className={`rounded-lg shadow-sm border overflow-x-auto transition-colors ${
                isDark
                  ? "bg-slate-800 border-slate-700"
                  : "bg-white border-gray-200"
              }`}
            >
              {showByPeople ? (
                <table
                  className="w-full"
                  style={{ tableLayout: "auto", minWidth: "min-content" }}
                >
                  <thead className={isDark ? "bg-slate-700" : "bg-gray-50"}>
                    <tr>
                      <th
                        className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDark ? "text-slate-300" : "text-gray-500"}`}
                        style={{ minWidth: 120 }}
                      >
                        NAME
                      </th>
                      {requirements.map((req) => (
                        <th
                          key={req.id}
                          className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDark ? "text-slate-300" : "text-gray-500"}`}
                          style={{
                            minWidth:
                              editingRequirementId === req.id ? 300 : 120,
                          }}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate">{req.title}</span>
                            <button
                              type="button"
                              onClick={() => startEditingRequirement(req.id)}
                              disabled={editingPersonId != null}
                              aria-pressed={editingRequirementId === req.id}
                              className={`shrink-0 p-1 rounded transition-colors ${
                                editingPersonId != null
                                  ? "cursor-not-allowed opacity-50"
                                  : editingRequirementId === req.id
                                    ? "bg-blue-600 text-white"
                                    : isDark
                                      ? "hover:bg-slate-600 text-slate-400"
                                      : "hover:bg-gray-200 text-gray-500"
                              }`}
                              title={
                                editingPersonId != null
                                  ? "Finish editing by person first"
                                  : "Edit dates for this requirement"
                              }
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody
                    style={{
                      borderTop: isDark
                        ? "1px solid #334155"
                        : "1px solid #e5e7eb",
                    }}
                  >
                    {statusPeople.map((person) => {
                      const isEditingByPerson = editingPersonId === person.id;
                      return (
                        <tr
                          key={person.id}
                          className={
                            isDark
                              ? "border-b border-slate-700"
                              : "border-b border-gray-200"
                          }
                        >
                          <td
                            className={`px-4 py-3 font-medium ${isDark ? "text-slate-200" : "text-gray-900"}`}
                            style={{ minWidth: 120 }}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span>{person.name}</span>
                              <button
                                type="button"
                                onClick={() => startEditingPerson(person.id)}
                                disabled={editingRequirementId != null}
                                aria-pressed={isEditingByPerson}
                                className={`shrink-0 p-1 rounded transition-colors ${
                                  editingRequirementId != null
                                    ? "cursor-not-allowed opacity-50"
                                    : isEditingByPerson
                                      ? "bg-blue-600 text-white"
                                      : isDark
                                        ? "hover:bg-slate-600 text-slate-400"
                                        : "hover:bg-gray-200 text-gray-500"
                                }`}
                                title={
                                  editingRequirementId != null
                                    ? "Finish editing by requirement first"
                                    : "Edit dates for this person"
                                }
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                          {requirements.map((req) => {
                            const isAssigned =
                              statusAssignments[person.id]?.[req.id] ?? false;
                            const entry = statusMapping[person.id]?.[
                              req.id
                            ] ?? { issuedDate: null, deadline: null };
                            const { expiration, message } = getExpiration(
                              req,
                              entry,
                              person,
                            );
                            const status = getStatus(expiration);
                            const isEditingByReq =
                              editingRequirementId === req.id;
                            const showInputs =
                              isEditingByReq || isEditingByPerson;
                            const toggling =
                              assignmentToggling?.personId === person.id &&
                              assignmentToggling?.requirementId === req.id;
                            return (
                              <td
                                key={req.id}
                                className={`px-4 py-3 ${isDark ? "text-slate-300" : "text-gray-700"} ${!isAssigned ? isDark ? "bg-slate-800/60 text-slate-500" : "bg-gray-100 text-gray-500" : ""}`}
                                style={{ minWidth: showInputs ? 300 : 120 }}
                              >
                                {!isAssigned ? (
                                  <>
                                    <span className="text-sm">Not assigned</span>
                                    {showInputs && (
                                      <div className="mt-1">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            toggleAssignment(
                                              person.id,
                                              req.id,
                                              true,
                                            )
                                          }
                                          disabled={toggling}
                                          className={`shrink-0 px-2 py-1 rounded text-xs font-medium ${isDark ? "bg-slate-600 text-slate-200 hover:bg-slate-500" : "bg-gray-200 text-gray-800 hover:bg-gray-300"} ${toggling ? "opacity-60 cursor-not-allowed" : ""}`}
                                        >
                                          {toggling ? "…" : "Add"}
                                        </button>
                                      </div>
                                    )}
                                  </>
                                ) : showInputs ? (
                                  <div className="flex flex-nowrap items-end gap-3">
                                    <div className="min-w-0 flex-1">
                                      <label className="block text-xs font-medium opacity-80 mb-0.5">
                                        Issued Date
                                      </label>
                                      <input
                                        type="date"
                                        value={entry.issuedDate ?? ""}
                                        onChange={(e) =>
                                          updateStatusEntry(
                                            person.id,
                                            req.id,
                                            "issuedDate",
                                            e.target.value || null,
                                          )
                                        }
                                        className={`w-full min-w-0 px-2 py-1.5 rounded text-sm border ${
                                          isDark
                                            ? "bg-slate-700 border-slate-600 text-slate-200"
                                            : "bg-white border-gray-300 text-gray-700"
                                        }`}
                                      />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <label className="block text-xs font-medium opacity-80 mb-0.5">
                                        Specific Date
                                      </label>
                                      <input
                                        type="date"
                                        value={entry.deadline ?? ""}
                                        onChange={(e) =>
                                          updateStatusEntry(
                                            person.id,
                                            req.id,
                                            "deadline",
                                            e.target.value || null,
                                          )
                                        }
                                        disabled={req.auto}
                                        className={`w-full min-w-0 px-2 py-1.5 rounded text-sm border ${
                                          req.auto
                                            ? isDark
                                              ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed opacity-60"
                                              : "bg-gray-100 border-gray-200 text-gray-500 cursor-not-allowed opacity-60"
                                            : isDark
                                              ? "bg-slate-700 border-slate-600 text-slate-200"
                                              : "bg-white border-gray-300 text-gray-700"
                                        }`}
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        saveMapping(person.id, req.id, req)
                                      }
                                      disabled={
                                        (savingCell?.personId === person.id &&
                                          savingCell?.requirementId === req.id) ||
                                        (!req.auto &&
                                          !(entry.issuedDate ?? "").trim())
                                      }
                                      className={`shrink-0 px-3 py-1.5 rounded text-sm font-medium ${
                                        savingCell?.personId === person.id &&
                                        savingCell?.requirementId === req.id
                                          ? "opacity-60 cursor-not-allowed"
                                          : !req.auto &&
                                              !(entry.issuedDate ?? "").trim()
                                            ? "opacity-60 cursor-not-allowed"
                                            : isDark
                                              ? "bg-slate-600 text-slate-200 hover:bg-slate-500"
                                              : "bg-gray-200 text-gray-800 hover:bg-gray-300"
                                      }`}
                                    >
                                      {savingCell?.personId === person.id &&
                                      savingCell?.requirementId === req.id
                                        ? "Saving..."
                                        : "Save"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        toggleAssignment(
                                          person.id,
                                          req.id,
                                          false,
                                        )
                                      }
                                      disabled={toggling}
                                      className={`shrink-0 px-2 py-1.5 rounded text-sm font-medium ${isDark ? "bg-slate-700 text-slate-300 border border-slate-600 hover:bg-slate-600" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-100"} ${toggling ? "opacity-60 cursor-not-allowed" : ""}`}
                                    >
                                      {toggling ? "…" : "Remove"}
                                    </button>
                                  </div>
                                ) : (
                                  <div className="inline-flex flex-col gap-0.5">
                                    <span className="inline-flex items-center gap-1.5">
                                      <span
                                        className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
                                          status === "ok"
                                            ? "bg-green-500"
                                            : status === "overdue"
                                              ? "bg-red-500"
                                              : "bg-gray-400"
                                        }`}
                                        title={
                                          expiration
                                            ? `Expiration: ${formatExpirationDate(expiration)}`
                                            : message ?? "No expiration date"
                                        }
                                      />
                                      {expiration
                                        ? formatExpirationDate(expiration)
                                        : "—"}
                                    </span>
                                    {message && (
                                      <span
                                        className={`text-xs ${
                                          isDark
                                            ? "text-amber-400"
                                            : "text-amber-700"
                                        }`}
                                        title={message}
                                      >
                                        {message}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <table
                  className="w-full"
                  style={{ tableLayout: "auto", minWidth: "min-content" }}
                >
                  <thead className={isDark ? "bg-slate-700" : "bg-gray-50"}>
                    <tr>
                      <th
                        className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDark ? "text-slate-300" : "text-gray-500"}`}
                        style={{ minWidth: 120 }}
                      >
                        Requirement
                      </th>
                      {statusPeople.map((person) => (
                        <th
                          key={person.id}
                          className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDark ? "text-slate-300" : "text-gray-500"}`}
                          style={{
                            minWidth: editingPersonId === person.id ? 300 : 120,
                          }}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate">{person.name}</span>
                            <button
                              type="button"
                              onClick={() => startEditingPerson(person.id)}
                              disabled={editingRequirementId != null}
                              aria-pressed={editingPersonId === person.id}
                              className={`shrink-0 p-1 rounded transition-colors ${
                                editingRequirementId != null
                                  ? "cursor-not-allowed opacity-50"
                                  : editingPersonId === person.id
                                    ? "bg-blue-600 text-white"
                                    : isDark
                                      ? "hover:bg-slate-600 text-slate-400"
                                      : "hover:bg-gray-200 text-gray-500"
                              }`}
                              title={
                                editingRequirementId != null
                                  ? "Finish editing by requirement first"
                                  : "Edit dates for this person"
                              }
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody
                    style={{
                      borderTop: isDark
                        ? "1px solid #334155"
                        : "1px solid #e5e7eb",
                    }}
                  >
                    {requirements.map((req) => {
                      const isEditing = editingRequirementId === req.id;
                      return (
                        <tr
                          key={req.id}
                          className={
                            isDark
                              ? "border-b border-slate-700"
                              : "border-b border-gray-200"
                          }
                        >
                          <td
                            className={`px-4 py-3 font-medium ${isDark ? "text-slate-200" : "text-gray-900"}`}
                            style={{ minWidth: 120 }}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="truncate">{req.title}</span>
                              <button
                                type="button"
                                onClick={() => startEditingRequirement(req.id)}
                                disabled={editingPersonId != null}
                                aria-pressed={editingRequirementId === req.id}
                                className={`shrink-0 p-1 rounded transition-colors ${
                                  editingPersonId != null
                                    ? "cursor-not-allowed opacity-50"
                                    : editingRequirementId === req.id
                                      ? "bg-blue-600 text-white"
                                      : isDark
                                        ? "hover:bg-slate-600 text-slate-400"
                                        : "hover:bg-gray-200 text-gray-500"
                                }`}
                                title={
                                  editingPersonId != null
                                    ? "Finish editing by person first"
                                    : "Edit dates for this requirement"
                                }
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                          {statusPeople.map((person) => {
                            const isAssigned =
                              statusAssignments[person.id]?.[req.id] ?? false;
                            const entry = statusMapping[person.id]?.[
                              req.id
                            ] ?? { issuedDate: null, deadline: null };
                            const { expiration, message } = getExpiration(
                              req,
                              entry,
                              person,
                            );
                            const status = getStatus(expiration);
                            const isEditingByPerson =
                              editingPersonId === person.id;
                            const showInputs = isEditing || isEditingByPerson;
                            const toggling =
                              assignmentToggling?.personId === person.id &&
                              assignmentToggling?.requirementId === req.id;
                            return (
                              <td
                                key={person.id}
                                className={`px-4 py-3 ${isDark ? "text-slate-300" : "text-gray-700"} ${!isAssigned ? isDark ? "bg-slate-800/60 text-slate-500" : "bg-gray-100 text-gray-500" : ""}`}
                                style={{ minWidth: showInputs ? 300 : 120 }}
                              >
                                {!isAssigned ? (
                                  <>
                                    <span className="text-sm">Not assigned</span>
                                    {showInputs && (
                                      <div className="mt-1">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            toggleAssignment(
                                              person.id,
                                              req.id,
                                              true,
                                            )
                                          }
                                          disabled={toggling}
                                          className={`shrink-0 px-2 py-1 rounded text-xs font-medium ${isDark ? "bg-slate-600 text-slate-200 hover:bg-slate-500" : "bg-gray-200 text-gray-800 hover:bg-gray-300"} ${toggling ? "opacity-60 cursor-not-allowed" : ""}`}
                                        >
                                          {toggling ? "…" : "Add"}
                                        </button>
                                      </div>
                                    )}
                                  </>
                                ) : showInputs ? (
                                  <div className="flex flex-nowrap items-end gap-3">
                                    <div className="min-w-0 flex-1">
                                      <label className="block text-xs font-medium opacity-80 mb-0.5">
                                        Issued Date
                                      </label>
                                      <input
                                        type="date"
                                        value={entry.issuedDate ?? ""}
                                        onChange={(e) =>
                                          updateStatusEntry(
                                            person.id,
                                            req.id,
                                            "issuedDate",
                                            e.target.value || null,
                                          )
                                        }
                                        className={`w-full min-w-0 px-2 py-1.5 rounded text-sm border ${
                                          isDark
                                            ? "bg-slate-700 border-slate-600 text-slate-200"
                                            : "bg-white border-gray-300 text-gray-700"
                                        }`}
                                      />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <label className="block text-xs font-medium opacity-80 mb-0.5">
                                        Specific Date
                                      </label>
                                      <input
                                        type="date"
                                        value={entry.deadline ?? ""}
                                        onChange={(e) =>
                                          updateStatusEntry(
                                            person.id,
                                            req.id,
                                            "deadline",
                                            e.target.value || null,
                                          )
                                        }
                                        disabled={req.auto}
                                        className={`w-full min-w-0 px-2 py-1.5 rounded text-sm border ${
                                          req.auto
                                            ? isDark
                                              ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed opacity-60"
                                              : "bg-gray-100 border-gray-200 text-gray-500 cursor-not-allowed opacity-60"
                                            : isDark
                                              ? "bg-slate-700 border-slate-600 text-slate-200"
                                              : "bg-white border-gray-300 text-gray-700"
                                        }`}
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        saveMapping(person.id, req.id, req)
                                      }
                                      disabled={
                                        (savingCell?.personId === person.id &&
                                          savingCell?.requirementId === req.id) ||
                                        (!req.auto &&
                                          !(entry.issuedDate ?? "").trim())
                                      }
                                      className={`shrink-0 px-3 py-1.5 rounded text-sm font-medium ${
                                        savingCell?.personId === person.id &&
                                        savingCell?.requirementId === req.id
                                          ? "opacity-60 cursor-not-allowed"
                                          : !req.auto &&
                                              !(entry.issuedDate ?? "").trim()
                                            ? "opacity-60 cursor-not-allowed"
                                            : isDark
                                              ? "bg-slate-600 text-slate-200 hover:bg-slate-500"
                                              : "bg-gray-200 text-gray-800 hover:bg-gray-300"
                                      }`}
                                    >
                                      {savingCell?.personId === person.id &&
                                      savingCell?.requirementId === req.id
                                        ? "Saving..."
                                        : "Save"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        toggleAssignment(
                                          person.id,
                                          req.id,
                                          false,
                                        )
                                      }
                                      disabled={toggling}
                                      className={`shrink-0 px-2 py-1.5 rounded text-sm font-medium ${isDark ? "bg-slate-700 text-slate-300 border border-slate-600 hover:bg-slate-600" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-100"} ${toggling ? "opacity-60 cursor-not-allowed" : ""}`}
                                    >
                                      {toggling ? "…" : "Remove"}
                                    </button>
                                  </div>
                                ) : (
                                  <div className="inline-flex flex-col gap-0.5">
                                    <span className="inline-flex items-center gap-1.5">
                                      <span
                                        className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
                                          status === "ok"
                                            ? "bg-green-500"
                                            : status === "overdue"
                                              ? "bg-red-500"
                                              : "bg-gray-400"
                                        }`}
                                        title={
                                          expiration
                                            ? `Expiration: ${formatExpirationDate(expiration)}`
                                            : message ?? "No expiration date"
                                        }
                                      />
                                      {expiration
                                        ? formatExpirationDate(expiration)
                                        : "—"}
                                    </span>
                                    {message && (
                                      <span
                                        className={`text-xs ${
                                          isDark
                                            ? "text-amber-400"
                                            : "text-amber-700"
                                        }`}
                                        title={message}
                                      >
                                        {message}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            </>
            )}
          </div>
        )}
      </div>

      {/* モーダル */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !requirementSaving && closeModal()}
        >
          <div
            className={`rounded-xl shadow-xl w-full mx-4 overflow-visible ${
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
                        isDark ? "bg-slate-600 text-slate-100" : "bg-gray-800 text-white"
                      }`}
                    >
                      Name of this requirement (e.g. Food handler, I-9, Driver license).
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
                <fieldset className="border-0 p-0 m-0 flex flex-col gap-2">
                  <legend
                    className={`flex items-center gap-1.5 text-base font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}
                  >
                    Renewal
                    <span className="group relative inline-flex shrink-0 text-current opacity-70 cursor-help">
                      <HelpCircle className="w-4 h-4" aria-hidden />
                      <span
                        className={`absolute left-full top-1/2 -translate-y-1/2 ml-1.5 px-2.5 py-1.5 text-xs font-normal whitespace-normal min-w-[320px] max-w-[640px] rounded shadow-lg z-100 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 ${
                          isDark ? "bg-slate-600 text-slate-100" : "bg-gray-800 text-white"
                        }`}
                      >
                        Auto: expiration is calculated from issue date and validity period (issued-based). Manual: you enter the expiration or next due date for each person (specific date).
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
                      Auto
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
                      Manual
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
                            isDark ? "bg-slate-600 text-slate-100" : "bg-gray-800 text-white"
                          }`}
                        >
                          When Renewal is Auto: how we calculate expiration. Issued-based: expiration = issue date + validity period. Not used when Manual.
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
                              isDark ? "bg-slate-600 text-slate-100" : "bg-gray-800 text-white"
                            }`}
                          >
                            When Renewal is Auto: how long the requirement is valid from the issue date. Choose years, months, or days.
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
                            onChange={(e) => setFormValidityYears(e.target.value)}
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
                            onChange={(e) => setFormValidityMonths(e.target.value)}
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
                            onChange={(e) => setFormValidityDays(e.target.value)}
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
                  <div>
                    <fieldset className="border-0 p-0 m-0 flex flex-col gap-3">
                      <legend
                        className={`flex items-center gap-1.5 text-base font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}
                      >
                        First due
                        <span className="group relative inline-flex shrink-0 text-current opacity-70 cursor-help">
                          <HelpCircle className="w-4 h-4" aria-hidden />
                          <span
                            className={`absolute left-full top-1/2 -translate-y-1/2 ml-1.5 px-2.5 py-1.5 text-xs font-normal whitespace-normal min-w-[320px] max-w-[640px] rounded shadow-lg z-100 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 ${
                              isDark ? "bg-slate-600 text-slate-100" : "bg-gray-800 text-white"
                            }`}
                          >
                            No due date: no first due. First due date on: a specific date. Due days from hire: how many days after hire the employee must obtain this requirement (e.g. 3 for I-9, 30 for Food handler).
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
                            checked={formFirstDueMode === "no_due"}
                            onChange={() => setFormFirstDueMode("no_due")}
                            className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                          />
                          No due date
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
                            onChange={(e) => setFormFirstDueOnDate(e.target.value)}
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
                            checked={formFirstDueMode === "days_from_hire"}
                            onChange={() => setFormFirstDueMode("days_from_hire")}
                            className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                          />
                          Due days from hire
                          <input
                            type="number"
                            min={1}
                            value={formFirstDueDate}
                            onChange={(e) => setFormFirstDueDate(e.target.value)}
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
                      </div>
                    </fieldset>
                  </div>
                  <div>
                    <label
                      className={`flex items-center gap-1.5 text-base font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}
                    >
                      Renewal notice (days before)
                      <span className="group relative inline-flex shrink-0 text-current opacity-70 cursor-help">
                        <HelpCircle className="w-4 h-4" aria-hidden />
                        <span
                          className={`absolute left-full top-1/2 -translate-y-1/2 ml-1.5 px-2.5 py-1.5 text-xs font-normal whitespace-normal min-w-[320px] max-w-[640px] rounded shadow-lg z-100 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 ${
                            isDark ? "bg-slate-600 text-slate-100" : "bg-gray-800 text-white"
                          }`}
                        >
                          How many days before the expiration date the employee can or should renew. Used for renewal reminders.
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
                </>
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
