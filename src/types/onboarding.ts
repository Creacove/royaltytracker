export interface OnboardingStateRow {
  onboarding_complete: boolean | null;
  has_active_membership: boolean | null;
  has_pending_invitation: boolean | null;
  pending_invitation_role: string | null;
  active_membership_role: string | null;
  is_platform_admin: boolean | null;
  company_id: string | null;
  company_name: string | null;
  website: string | null;
  country_code: string | null;
  default_currency: string | null;
  timezone: string | null;
  monthly_statement_volume: string | null;
  primary_cmo_count: number | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  phone: string | null;
}

export interface OnboardingState {
  onboardingComplete: boolean;
  hasActiveMembership: boolean;
  hasPendingInvitation: boolean;
  pendingInvitationRole: string | null;
  activeMembershipRole: string | null;
  isPlatformAdmin: boolean;
  companyId: string | null;
  companyName: string | null;
  website: string | null;
  countryCode: string | null;
  defaultCurrency: string;
  timezone: string;
  monthlyStatementVolume: string | null;
  primaryCmoCount: number | null;
  firstName: string;
  lastName: string;
  jobTitle: string;
  phone: string;
}

export const EMPTY_ONBOARDING_STATE: OnboardingState = {
  onboardingComplete: false,
  hasActiveMembership: false,
  hasPendingInvitation: false,
  pendingInvitationRole: null,
  activeMembershipRole: null,
  isPlatformAdmin: false,
  companyId: null,
  companyName: null,
  website: null,
  countryCode: null,
  defaultCurrency: "USD",
  timezone: "UTC",
  monthlyStatementVolume: null,
  primaryCmoCount: null,
  firstName: "",
  lastName: "",
  jobTitle: "",
  phone: "",
};

export function normalizeOnboardingState(raw: OnboardingStateRow | null | undefined): OnboardingState {
  if (!raw) {
    return { ...EMPTY_ONBOARDING_STATE };
  }

  return {
    onboardingComplete: Boolean(raw.onboarding_complete),
    hasActiveMembership: Boolean(raw.has_active_membership),
    hasPendingInvitation: Boolean(raw.has_pending_invitation),
    pendingInvitationRole: raw.pending_invitation_role,
    activeMembershipRole: raw.active_membership_role,
    isPlatformAdmin: Boolean(raw.is_platform_admin),
    companyId: raw.company_id,
    companyName: raw.company_name,
    website: raw.website,
    countryCode: raw.country_code,
    defaultCurrency: raw.default_currency ?? "USD",
    timezone: raw.timezone ?? "UTC",
    monthlyStatementVolume: raw.monthly_statement_volume,
    primaryCmoCount: raw.primary_cmo_count,
    firstName: raw.first_name ?? "",
    lastName: raw.last_name ?? "",
    jobTitle: raw.job_title ?? "",
    phone: raw.phone ?? "",
  };
}
