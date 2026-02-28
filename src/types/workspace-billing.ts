export type WorkspaceSubscriptionStatus =
  | "inactive"
  | "active_paid"
  | "active_sponsored"
  | "past_due"
  | "canceled";

export interface WorkspaceSubscriptionStateRow {
  company_id: string | null;
  company_name: string | null;
  active_membership_role: string | null;
  is_platform_admin: boolean | null;
  can_manage_billing: boolean | null;
  subscription_status: WorkspaceSubscriptionStatus | null;
  effective_subscription_status: WorkspaceSubscriptionStatus | null;
  plan_code: "solo" | "team" | null;
  plan_name: string | null;
  price_monthly_cents: number | null;
  currency: string | null;
  seat_limit: number | null;
  statements_limit: number | null;
  normalized_rows_limit: number | null;
  ai_requests_limit: number | null;
  seats_used: number | null;
  period_start_month: string | null;
  statements_used: number | null;
  normalized_rows_used: number | null;
  ai_requests_used: number | null;
  statements_usage_ratio: number | null;
  rows_usage_ratio: number | null;
  ai_usage_ratio: number | null;
  sponsor_expires_at: string | null;
  current_period_end: string | null;
  needs_activation: boolean | null;
  soft_limit_reached: boolean | null;
  hard_limit_reached: boolean | null;
}

export interface WorkspaceSubscriptionState {
  companyId: string | null;
  companyName: string | null;
  activeMembershipRole: string | null;
  isPlatformAdmin: boolean;
  canManageBilling: boolean;
  subscriptionStatus: WorkspaceSubscriptionStatus;
  effectiveSubscriptionStatus: WorkspaceSubscriptionStatus;
  planCode: "solo" | "team" | null;
  planName: string | null;
  priceMonthlyCents: number;
  currency: string;
  seatLimit: number | null;
  statementsLimit: number | null;
  normalizedRowsLimit: number | null;
  aiRequestsLimit: number | null;
  seatsUsed: number;
  periodStartMonth: string;
  statementsUsed: number;
  normalizedRowsUsed: number;
  aiRequestsUsed: number;
  statementsUsageRatio: number;
  rowsUsageRatio: number;
  aiUsageRatio: number;
  sponsorExpiresAt: string | null;
  currentPeriodEnd: string | null;
  needsActivation: boolean;
  softLimitReached: boolean;
  hardLimitReached: boolean;
}

export const EMPTY_WORKSPACE_SUBSCRIPTION_STATE: WorkspaceSubscriptionState = {
  companyId: null,
  companyName: null,
  activeMembershipRole: null,
  isPlatformAdmin: false,
  canManageBilling: false,
  subscriptionStatus: "inactive",
  effectiveSubscriptionStatus: "inactive",
  planCode: null,
  planName: null,
  priceMonthlyCents: 0,
  currency: "USD",
  seatLimit: null,
  statementsLimit: null,
  normalizedRowsLimit: null,
  aiRequestsLimit: null,
  seatsUsed: 0,
  periodStartMonth: new Date().toISOString().slice(0, 10),
  statementsUsed: 0,
  normalizedRowsUsed: 0,
  aiRequestsUsed: 0,
  statementsUsageRatio: 0,
  rowsUsageRatio: 0,
  aiUsageRatio: 0,
  sponsorExpiresAt: null,
  currentPeriodEnd: null,
  needsActivation: true,
  softLimitReached: false,
  hardLimitReached: false,
};

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toBoolean(value: unknown): boolean {
  return Boolean(value);
}

function toStatus(value: unknown): WorkspaceSubscriptionStatus {
  if (value === "active_paid" || value === "active_sponsored" || value === "past_due" || value === "canceled") {
    return value;
  }
  return "inactive";
}

export function normalizeWorkspaceSubscriptionState(
  raw: WorkspaceSubscriptionStateRow | null | undefined,
): WorkspaceSubscriptionState {
  if (!raw) return { ...EMPTY_WORKSPACE_SUBSCRIPTION_STATE };

  const periodStartMonth =
    typeof raw.period_start_month === "string" && raw.period_start_month.length > 0
      ? raw.period_start_month
      : new Date().toISOString().slice(0, 10);

  return {
    companyId: raw.company_id,
    companyName: raw.company_name,
    activeMembershipRole: raw.active_membership_role,
    isPlatformAdmin: toBoolean(raw.is_platform_admin),
    canManageBilling: toBoolean(raw.can_manage_billing),
    subscriptionStatus: toStatus(raw.subscription_status),
    effectiveSubscriptionStatus: toStatus(raw.effective_subscription_status),
    planCode: raw.plan_code,
    planName: raw.plan_name,
    priceMonthlyCents: toNumber(raw.price_monthly_cents),
    currency: raw.currency ?? "USD",
    seatLimit: raw.seat_limit,
    statementsLimit: raw.statements_limit,
    normalizedRowsLimit: raw.normalized_rows_limit,
    aiRequestsLimit: raw.ai_requests_limit,
    seatsUsed: toNumber(raw.seats_used),
    periodStartMonth,
    statementsUsed: toNumber(raw.statements_used),
    normalizedRowsUsed: toNumber(raw.normalized_rows_used),
    aiRequestsUsed: toNumber(raw.ai_requests_used),
    statementsUsageRatio: toNumber(raw.statements_usage_ratio),
    rowsUsageRatio: toNumber(raw.rows_usage_ratio),
    aiUsageRatio: toNumber(raw.ai_usage_ratio),
    sponsorExpiresAt: raw.sponsor_expires_at,
    currentPeriodEnd: raw.current_period_end,
    needsActivation: toBoolean(raw.needs_activation),
    softLimitReached: toBoolean(raw.soft_limit_reached),
    hardLimitReached: toBoolean(raw.hard_limit_reached),
  };
}
