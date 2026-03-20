import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, CreditCard, MailPlus, Shield, Users2 } from "lucide-react";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useWorkspaceSubscriptionState } from "@/hooks/useWorkspaceSubscriptionState";
import { supabase } from "@/integrations/supabase/client";
import type { OnboardingState } from "@/types/onboarding";

type CompanyProps = {
  onboardingState: OnboardingState;
  schemaReady: boolean;
  onCompanyUpdated: () => Promise<void> | void;
};

type CompanyMember = {
  member_user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  phone: string | null;
  role: string;
  membership_status: string;
  joined_at: string | null;
};

type CompanyInvitation = {
  invitation_id: string;
  email: string;
  role: string;
  status: string;
  company_id: string | null;
  company_name: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  latest_invite_link: string | null;
  latest_invite_link_generated_at: string | null;
  auth_delivery_status: string | null;
  auth_delivery_error: string | null;
};

type InvitableWorkspace = {
  company_id: string;
  company_name: string;
};

type SendInviteResponse = {
  invitation_id: string;
  auth_status: "invited" | "already_exists" | "manual_link";
  manual_invite_link?: string | null;
  auth_warning?: string | null;
};

type PartnerCodeResponseRow = {
  company_id: string;
  partner_code: string;
  sponsor_months: number;
  expires_at: string | null;
};

type GeneratedPartnerCode = {
  companyId: string;
  companyName: string;
  partnerCode: string;
  sponsorMonths: number;
  expiresAt: string | null;
  generatedAt: string;
};

type PlatformTargetMode = "current" | "existing" | "new";

const roleOptions = ["owner", "admin", "member", "viewer"];
const bootstrapRoleOptions = ["owner", "admin"];
const expiryOptions = [7, 14, 30];
const sponsorMonthOptions = [1, 3, 6, 12];

async function resolveFunctionErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const payload = await error.context.json();
      if (payload && typeof payload.error === "string") {
        return payload.error;
      }
      return JSON.stringify(payload);
    } catch {
      try {
        return await error.context.text();
      } catch {
        return error.message;
      }
    }
  }

  if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Request failed.";
}

function titleCaseRole(role: string | null | undefined): string {
  if (!role) return "Member";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function titleCaseStatus(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .split("_")
    .map((part) => (part.length ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function toUsagePercent(value: number): string {
  return `${Math.max(0, Math.round(value * 100))}%`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "N/A";
  return new Date(value).toLocaleString();
}

export default function Company({ onboardingState, schemaReady, onCompanyUpdated }: CompanyProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();

  const hasWorkspace = Boolean(onboardingState.companyId);
  const canManageWorkspace = useMemo(() => {
    if (onboardingState.isPlatformAdmin) return true;
    return onboardingState.activeMembershipRole === "owner" || onboardingState.activeMembershipRole === "admin";
  }, [onboardingState.activeMembershipRole, onboardingState.isPlatformAdmin]);

  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [invites, setInvites] = useState<CompanyInvitation[]>([]);
  const [globalWorkspaces, setGlobalWorkspaces] = useState<InvitableWorkspace[]>([]);

  const [loading, setLoading] = useState(false);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [openingBillingPortal, setOpeningBillingPortal] = useState(false);

  const {
    state: subscriptionState,
    loading: subscriptionLoading,
    loaded: subscriptionLoaded,
    refresh: refreshSubscriptionState,
  } = useWorkspaceSubscriptionState(user?.id ?? null);

  const [workspaceName, setWorkspaceName] = useState(onboardingState.companyName ?? "");
  const [website, setWebsite] = useState(onboardingState.website ?? "");
  const [countryCode, setCountryCode] = useState(onboardingState.countryCode ?? "");
  const [defaultCurrency, setDefaultCurrency] = useState(onboardingState.defaultCurrency);
  const [timezone, setTimezone] = useState(onboardingState.timezone);
  const [monthlyStatementVolume, setMonthlyStatementVolume] = useState(onboardingState.monthlyStatementVolume ?? "");
  const [primaryCmoCount, setPrimaryCmoCount] = useState(
    onboardingState.primaryCmoCount === null ? "" : String(onboardingState.primaryCmoCount),
  );

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteExpiryDays, setInviteExpiryDays] = useState(14);
  const [activeSection, setActiveSection] = useState("overview");

  const [platformTargetMode, setPlatformTargetMode] = useState<PlatformTargetMode>(
    onboardingState.companyId ? "current" : "existing",
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(onboardingState.companyId ?? "");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [partnerCodeWorkspaceId, setPartnerCodeWorkspaceId] = useState(onboardingState.companyId ?? "");
  const [partnerCodeMonths, setPartnerCodeMonths] = useState(3);
  const [generatingPartnerCode, setGeneratingPartnerCode] = useState(false);
  const [generatedPartnerCode, setGeneratedPartnerCode] = useState<GeneratedPartnerCode | null>(null);

  const workspaceNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const workspace of globalWorkspaces) {
      map.set(workspace.company_id, workspace.company_name);
    }
    if (onboardingState.companyId && onboardingState.companyName) {
      map.set(onboardingState.companyId, onboardingState.companyName);
    }
    return map;
  }, [globalWorkspaces, onboardingState.companyId, onboardingState.companyName]);

  useEffect(() => {
    setWorkspaceName(onboardingState.companyName ?? "");
    setWebsite(onboardingState.website ?? "");
    setCountryCode(onboardingState.countryCode ?? "");
    setDefaultCurrency(onboardingState.defaultCurrency);
    setTimezone(onboardingState.timezone);
    setMonthlyStatementVolume(onboardingState.monthlyStatementVolume ?? "");
    setPrimaryCmoCount(onboardingState.primaryCmoCount === null ? "" : String(onboardingState.primaryCmoCount));
    if (onboardingState.companyId) {
      setSelectedWorkspaceId((current) => current || onboardingState.companyId || "");
      setPartnerCodeWorkspaceId((current) => current || onboardingState.companyId || "");
    } else {
      setPlatformTargetMode((current) => (current === "current" ? "existing" : current));
    }
  }, [onboardingState]);

  useEffect(() => {
    if (!onboardingState.isPlatformAdmin && activeSection === "platform") {
      setActiveSection("overview");
    }
  }, [activeSection, onboardingState.isPlatformAdmin]);

  useEffect(() => {
    if (
      onboardingState.isPlatformAdmin &&
      platformTargetMode === "new" &&
      !bootstrapRoleOptions.includes(inviteRole)
    ) {
      setInviteRole("owner");
    }
  }, [inviteRole, onboardingState.isPlatformAdmin, platformTargetMode]);

  const loadWorkspaceData = async () => {
    if (!schemaReady) return;
    setLoading(true);

    const emptyResult = Promise.resolve({ data: [], error: null });
    const membersPromise = hasWorkspace ? (supabase as any).rpc("list_my_company_members") : emptyResult;
    const invitesPromise = canManageWorkspace
      ? onboardingState.isPlatformAdmin
        ? (supabase as any).rpc("list_visible_partner_invitations", { p_limit: 100 })
        : hasWorkspace
          ? (supabase as any).rpc("list_my_company_invitations", { p_limit: 100 })
          : emptyResult
      : emptyResult;
    const workspacesPromise = onboardingState.isPlatformAdmin ? (supabase as any).rpc("list_invitable_companies") : emptyResult;

    const [membersResult, invitesResult, workspacesResult] = await Promise.all([
      membersPromise,
      invitesPromise,
      workspacesPromise,
    ]);

    if (hasWorkspace) {
      if (membersResult?.error) {
        toast({
          title: "Could not load workspace members",
          description: membersResult.error.message,
          variant: "destructive",
        });
      } else {
        setMembers((membersResult?.data ?? []) as CompanyMember[]);
      }
    } else {
      setMembers([]);
    }

    if (canManageWorkspace) {
      if (invitesResult?.error) {
        toast({
          title: "Could not load invitations",
          description: invitesResult.error.message,
          variant: "destructive",
        });
      } else {
        setInvites((invitesResult?.data ?? []) as CompanyInvitation[]);
      }
    } else {
      setInvites([]);
    }

    if (onboardingState.isPlatformAdmin) {
      if (workspacesResult?.error) {
        toast({
          title: "Could not load workspaces",
          description: workspacesResult.error.message,
          variant: "destructive",
        });
      } else {
        const rows = (workspacesResult?.data ?? []) as InvitableWorkspace[];
        setGlobalWorkspaces(rows);

        const workspaceIds = new Set(rows.map((workspace) => workspace.company_id));
        const preferredWorkspaceId =
          onboardingState.companyId && workspaceIds.has(onboardingState.companyId)
            ? onboardingState.companyId
            : (rows[0]?.company_id ?? "");

        if (!selectedWorkspaceId || !workspaceIds.has(selectedWorkspaceId)) {
          setSelectedWorkspaceId(preferredWorkspaceId);
        }
        if (!partnerCodeWorkspaceId || !workspaceIds.has(partnerCodeWorkspaceId)) {
          setPartnerCodeWorkspaceId(preferredWorkspaceId);
        }
      }
    } else {
      setGlobalWorkspaces([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadWorkspaceData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaReady, hasWorkspace, canManageWorkspace, onboardingState.isPlatformAdmin]);

  const handleSaveWorkspaceProfile = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!schemaReady) {
      toast({
        title: "Schema not ready",
        description: "Apply latest migrations, then try again.",
        variant: "destructive",
      });
      return;
    }

    if (!hasWorkspace) {
      toast({
        title: "No active workspace",
        description: "Join a workspace first.",
        variant: "destructive",
      });
      return;
    }

    if (!canManageWorkspace) {
      toast({
        title: "Permission denied",
        description: "Only owners/admins can update workspace profile.",
        variant: "destructive",
      });
      return;
    }

    if (!workspaceName.trim()) {
      toast({
        title: "Workspace name required",
        description: "Enter a valid workspace name.",
        variant: "destructive",
      });
      return;
    }

    const parsedCmoCount = primaryCmoCount.trim() === "" ? null : Number(primaryCmoCount);
    if (parsedCmoCount !== null && (!Number.isInteger(parsedCmoCount) || parsedCmoCount < 0)) {
      toast({
        title: "Invalid CMO count",
        description: "Primary CMO count must be a whole number greater than or equal to 0.",
        variant: "destructive",
      });
      return;
    }

    setSavingWorkspace(true);

    const { error } = await (supabase as any).rpc("update_my_company_profile", {
      p_company_name: workspaceName.trim(),
      p_website: website.trim() || null,
      p_country_code: countryCode.trim() || null,
      p_default_currency: defaultCurrency.trim() || null,
      p_timezone: timezone.trim() || null,
      p_monthly_statement_volume: monthlyStatementVolume.trim() || null,
      p_primary_cmo_count: parsedCmoCount,
    });

    if (error) {
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive",
      });
      setSavingWorkspace(false);
      return;
    }

    await onCompanyUpdated();
    await loadWorkspaceData();
    toast({
      title: "Workspace updated",
      description: "Workspace profile settings saved.",
    });
    setSavingWorkspace(false);
  };

  const handleSendInvite = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!schemaReady) {
      toast({
        title: "Schema not ready",
        description: "Apply latest migrations, then retry.",
        variant: "destructive",
      });
      return;
    }

    if (!canManageWorkspace) {
      toast({
        title: "Permission denied",
        description: "Only owners/admins can invite members.",
        variant: "destructive",
      });
      return;
    }

    const shouldValidateCurrentWorkspaceLimits = !onboardingState.isPlatformAdmin;

    if (shouldValidateCurrentWorkspaceLimits && subscriptionLoaded && subscriptionState.needsActivation) {
      toast({
        title: "Workspace not active",
        description: "Activate billing before inviting teammates.",
        variant: "destructive",
      });
      return;
    }

    if (
      shouldValidateCurrentWorkspaceLimits &&
      subscriptionLoaded &&
      subscriptionState.seatLimit !== null &&
      subscriptionState.seatsUsed >= subscriptionState.seatLimit
    ) {
      toast({
        title: "Seat limit reached",
        description: "Upgrade your plan to invite more members.",
        variant: "destructive",
      });
      return;
    }

    if (!inviteEmail.trim()) {
      toast({
        title: "Missing email",
        description: "Enter an invite email address.",
        variant: "destructive",
      });
      return;
    }

    if (
      onboardingState.isPlatformAdmin &&
      platformTargetMode === "new" &&
      !bootstrapRoleOptions.includes(inviteRole)
    ) {
      toast({
        title: "Owner/admin role required",
        description: "The first invite for a new workspace must be Owner or Admin.",
        variant: "destructive",
      });
      return;
    }

    const payload: Record<string, unknown> = {
      email: inviteEmail.trim(),
      role: inviteRole,
      expiresInDays: inviteExpiryDays,
      redirectTo: `${window.location.origin}/accept-invite`,
    };

    if (onboardingState.isPlatformAdmin) {
      if (platformTargetMode === "current") {
        if (!onboardingState.companyId) {
          toast({
            title: "No current workspace",
            description: "Choose an existing workspace or create a new workspace target.",
            variant: "destructive",
          });
          return;
        }
        payload.companyId = onboardingState.companyId;
      } else if (platformTargetMode === "existing") {
        if (!selectedWorkspaceId) {
          toast({
            title: "Choose a workspace",
            description: "Select a target workspace for this invite.",
            variant: "destructive",
          });
          return;
        }
        payload.companyId = selectedWorkspaceId;
      } else {
        if (!newWorkspaceName.trim()) {
          toast({
            title: "Workspace name required",
            description: "Enter a new workspace name.",
            variant: "destructive",
          });
          return;
        }
        payload.companyName = newWorkspaceName.trim();
      }
    } else if (hasWorkspace && onboardingState.companyId) {
      payload.companyId = onboardingState.companyId;
    }

    setSendingInvite(true);

    const { data, error } = await supabase.functions.invoke("send-partner-invite", {
      body: payload,
    });

    if (error) {
      const details = await resolveFunctionErrorMessage(error);
      toast({
        title: "Invite failed",
        description: details,
        variant: "destructive",
      });
      setSendingInvite(false);
      return;
    }

    const response = (data ?? {}) as SendInviteResponse;
    if (response.auth_status === "manual_link") {
      const link = response.manual_invite_link ?? "";
      if (link && typeof navigator !== "undefined" && navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(link);
        } catch {
          // non-fatal
        }
      }

      toast({
        title: "Invite created (manual link)",
        description:
          `${response.auth_warning ?? "Auth email delivery failed."} ` +
          `Share this link with the user: ${link}`,
      });
    } else {
      toast({
        title: "Invite sent",
        description:
          response.auth_status === "already_exists"
            ? "Member already has an account. Invitation was still recorded."
            : "Invitation recorded and email sent.",
      });
    }

    setInviteEmail("");
    setInviteRole(onboardingState.isPlatformAdmin && platformTargetMode === "new" ? "owner" : "member");
    setInviteExpiryDays(14);
    if (onboardingState.isPlatformAdmin && platformTargetMode === "new") {
      setNewWorkspaceName("");
    }

    await loadWorkspaceData();
    setSendingInvite(false);
  };

  const handleGeneratePartnerCode = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!schemaReady) {
      toast({
        title: "Schema not ready",
        description: "Apply latest migrations, then retry.",
        variant: "destructive",
      });
      return;
    }

    if (!onboardingState.isPlatformAdmin) {
      toast({
        title: "Permission denied",
        description: "Only platform admins can generate sponsored partner codes.",
        variant: "destructive",
      });
      return;
    }

    if (!partnerCodeWorkspaceId) {
      toast({
        title: "Choose a workspace",
        description: "Select a workspace before generating a partner code.",
        variant: "destructive",
      });
      return;
    }

    setGeneratingPartnerCode(true);

    const { data, error } = await (supabase as any).rpc("create_workspace_partner_code", {
      p_company_id: partnerCodeWorkspaceId,
      p_sponsor_months: partnerCodeMonths,
      p_expires_at: null,
    });

    if (error) {
      toast({
        title: "Partner code generation failed",
        description: error.message,
        variant: "destructive",
      });
      setGeneratingPartnerCode(false);
      return;
    }

    const row = (Array.isArray(data) ? data[0] : data) as PartnerCodeResponseRow | null;
    const partnerCode = row?.partner_code;
    if (!partnerCode) {
      toast({
        title: "Partner code generation failed",
        description: "No partner code was returned.",
        variant: "destructive",
      });
      setGeneratingPartnerCode(false);
      return;
    }

    const workspaceName =
      workspaceNameById.get(partnerCodeWorkspaceId) ??
      (partnerCodeWorkspaceId === onboardingState.companyId ? onboardingState.companyName : null) ??
      "Selected workspace";

    setGeneratedPartnerCode({
      companyId: partnerCodeWorkspaceId,
      companyName: workspaceName,
      partnerCode,
      sponsorMonths: row?.sponsor_months ?? partnerCodeMonths,
      expiresAt: row?.expires_at ?? null,
      generatedAt: new Date().toISOString(),
    });

    try {
      await navigator.clipboard.writeText(partnerCode);
    } catch {
      // non-fatal
    }

    toast({
      title: "Partner code generated",
      description: `Code copied to clipboard for ${workspaceName}.`,
    });

    setGeneratingPartnerCode(false);
  };

  const handleOpenBillingPortal = async () => {
    setOpeningBillingPortal(true);
    const { data, error } = await supabase.functions.invoke("create-billing-portal-session", {
      body: {
        return_url: `${window.location.origin}/workspace`,
      },
    });

    if (error) {
      toast({
        title: "Billing portal unavailable",
        description: error.message,
        variant: "destructive",
      });
      setOpeningBillingPortal(false);
      return;
    }

    const portalUrl = ((data ?? {}) as { portal_url?: string }).portal_url;
    if (!portalUrl) {
      toast({
        title: "Billing portal unavailable",
        description: "Portal URL was not returned.",
        variant: "destructive",
      });
      setOpeningBillingPortal(false);
      return;
    }

    window.location.assign(portalUrl);
  };

  const roleBadgeLabel = onboardingState.isPlatformAdmin
    ? "Platform Admin"
    : titleCaseRole(onboardingState.activeMembershipRole);
  const pendingInviteCount = invites.filter((invite) => invite.status === "pending").length;
  const workspaceCount = globalWorkspaces.length;
  const subscriptionStatusLabel = titleCaseStatus(subscriptionState.effectiveSubscriptionStatus);
  const planSummaryLabel = subscriptionState.planName
    ? subscriptionState.priceMonthlyCents > 0
      ? `${subscriptionState.planName} ($${(subscriptionState.priceMonthlyCents / 100).toFixed(0)}/mo)`
      : subscriptionState.planName
    : "Unassigned";
  const inviteTargetLabel =
    !onboardingState.isPlatformAdmin || platformTargetMode === "current"
      ? onboardingState.companyName ?? "Current workspace"
      : platformTargetMode === "existing"
        ? (workspaceNameById.get(selectedWorkspaceId) ?? "Select workspace")
        : newWorkspaceName.trim()
          ? `New workspace: ${newWorkspaceName.trim()}`
          : "New workspace name required";
  const canShowWorkspaceTargetSelect = onboardingState.isPlatformAdmin && platformTargetMode === "existing";
  const canShowNewWorkspaceInput = onboardingState.isPlatformAdmin && platformTargetMode === "new";
  const canShowCurrentWorkspaceHint = onboardingState.isPlatformAdmin && platformTargetMode === "current";
  const selectedPartnerCodeWorkspaceName = workspaceNameById.get(partnerCodeWorkspaceId) ?? "Workspace not selected";
  const panelClass = "surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-4";
  const mutedPanelClass = "surface-muted forensic-frame rounded-[calc(var(--radius-sm))] p-4";
  const intelligencePanelClass = "surface-intelligence forensic-frame rounded-[calc(var(--radius-sm))] p-4";
  const sectionHeaderClass = "border-b border-[hsl(var(--border)/0.1)] pb-4";

  return (
    <div className="rhythm-page">
      <PageHeader
        eyebrow="Workspace Console"
        title={onboardingState.companyName ?? "Workspace Profile Pending"}
        subtitle="Billing, profile defaults, team access, and cross-workspace controls in one place."
        meta={
          <>
            <span className="rounded-full border border-[hsl(var(--brand-accent)/0.16)] bg-[hsl(var(--brand-accent-ghost)/0.72)] px-2.5 py-1 text-[10px] font-ui uppercase tracking-[0.12em] text-[hsl(var(--brand-accent))]">
              {roleBadgeLabel}
            </span>
            <span className="rounded-full border border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-elevated)/0.72)] px-2.5 py-1 text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">
              {hasWorkspace ? `${members.length} members` : "No active workspace"}
            </span>
            {onboardingState.isPlatformAdmin ? (
              <span className="rounded-full border border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-panel)/0.72)] px-2.5 py-1 text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">
                {workspaceCount} visible workspaces
              </span>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <div className={panelClass}>
          <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Plan status</p>
          <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">
            {subscriptionLoading || !subscriptionLoaded ? "Loading..." : subscriptionStatusLabel}
          </p>
        </div>
        <div className={panelClass}>
          <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Plan</p>
          <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">
            {subscriptionLoading || !subscriptionLoaded ? "Loading..." : planSummaryLabel}
          </p>
        </div>
        <div className={intelligencePanelClass}>
          <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Pending invites</p>
          <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">{pendingInviteCount}</p>
        </div>
      </div>

      <Tabs value={activeSection} onValueChange={setActiveSection} className="space-y-5">
        <div className="overflow-x-auto">
          <TabsList variant="quiet" className="min-w-max">
            <TabsTrigger value="overview" variant="quiet" className="flex-none">
              Overview
            </TabsTrigger>
            <TabsTrigger value="access" variant="quiet" className="flex-none">
              Access
            </TabsTrigger>
            <TabsTrigger value="profile" variant="quiet" className="flex-none">
              Profile
            </TabsTrigger>
            {onboardingState.isPlatformAdmin && (
              <TabsTrigger value="platform" variant="quiet" className="flex-none">
                Platform
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-5">
          <Card surface="evidence" className="overflow-hidden">
              <CardHeader className={sectionHeaderClass}>
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-[hsl(var(--brand-accent))]" />
                  <CardTitle>Plan &amp; Billing</CardTitle>
                </div>
                <CardDescription>
                  {subscriptionState.canManageBilling
                    ? "Current subscription, usage limits, and billing actions for this workspace."
                    : "Billing is managed by workspace owners/admins."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {subscriptionLoading || !subscriptionLoaded ? (
                  <p className="text-sm text-muted-foreground">Loading billing state...</p>
                ) : !subscriptionState.companyId ? (
                  <p className="text-sm text-muted-foreground">
                    Billing state is available after workspace membership is active.
                  </p>
                ) : !subscriptionState.canManageBilling ? (
                  <p className="text-sm text-muted-foreground">
                    Your role does not manage billing for this workspace. Contact an owner/admin for billing actions.
                  </p>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className={panelClass}>
                        <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Plan</p>
                        <p className="mt-2 font-semibold text-foreground">
                          {subscriptionState.planName ?? "Unassigned"}{" "}
                          {subscriptionState.priceMonthlyCents > 0
                            ? `($${(subscriptionState.priceMonthlyCents / 100).toFixed(0)}/mo)`
                            : ""}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {titleCaseStatus(subscriptionState.effectiveSubscriptionStatus)}
                        </p>
                      </div>
                      <div className={panelClass}>
                        <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Seats</p>
                        <p className="mt-2 font-semibold text-foreground">
                          {subscriptionState.seatsUsed}
                          {subscriptionState.seatLimit !== null ? ` / ${subscriptionState.seatLimit}` : ""}
                        </p>
                      </div>
                      <div className={panelClass}>
                        <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Statements</p>
                        <p className="mt-2 font-semibold text-foreground">
                          {subscriptionState.statementsUsed}
                          {subscriptionState.statementsLimit !== null ? ` / ${subscriptionState.statementsLimit}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {toUsagePercent(subscriptionState.statementsUsageRatio)}
                        </p>
                      </div>
                      <div className={panelClass}>
                        <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">AI Requests</p>
                        <p className="mt-2 font-semibold text-foreground">
                          {subscriptionState.aiRequestsUsed}
                          {subscriptionState.aiRequestsLimit !== null ? ` / ${subscriptionState.aiRequestsLimit}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{toUsagePercent(subscriptionState.aiUsageRatio)}</p>
                      </div>
                    </div>

                    {subscriptionState.sponsorExpiresAt &&
                      subscriptionState.effectiveSubscriptionStatus === "active_sponsored" && (
                        <div className={mutedPanelClass}>
                          Partner sponsorship active through{" "}
                          {new Date(subscriptionState.sponsorExpiresAt).toLocaleDateString()}. After this date,
                          reactivate billing at $149/month to continue.
                        </div>
                      )}

                    {(subscriptionState.softLimitReached || subscriptionState.hardLimitReached) && (
                      <div className={mutedPanelClass}>
                        Usage is near or above current limits. Upgrade to prevent operational friction as volume grows.
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {(subscriptionState.needsActivation ||
                        subscriptionState.effectiveSubscriptionStatus === "past_due") && subscriptionState.canManageBilling && (
                        <Button onClick={() => navigate("/activate")}>Activate Workspace</Button>
                      )}
                      {!subscriptionState.needsActivation &&
                        subscriptionState.effectiveSubscriptionStatus === "active_paid" &&
                        subscriptionState.canManageBilling && (
                          <Button variant="outline" onClick={handleOpenBillingPortal} disabled={openingBillingPortal}>
                            {openingBillingPortal ? "Opening portal..." : "Manage Billing"}
                          </Button>
                        )}
                      <Button variant="ghost" onClick={() => void refreshSubscriptionState()} disabled={subscriptionLoading}>
                        Refresh Usage
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="profile" className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Card surface="evidence" className="overflow-hidden">
          <CardHeader className={sectionHeaderClass}>
            <CardTitle>Workspace Profile</CardTitle>
            <CardDescription>
              {canManageWorkspace
                ? "Set identity and defaults for this workspace."
                : "Workspace defaults are managed by your workspace admins."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasWorkspace ? (
              <form className="space-y-4" onSubmit={handleSaveWorkspaceProfile}>
                <div className="space-y-2">
                  <Label htmlFor="workspaceName">Workspace name</Label>
                  <Input
                    id="workspaceName"
                    value={workspaceName}
                    onChange={(event) => setWorkspaceName(event.target.value)}
                    disabled={!canManageWorkspace}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="website">Website</Label>
                    <Input
                      id="website"
                      value={website}
                      onChange={(event) => setWebsite(event.target.value)}
                      placeholder="https://"
                      disabled={!canManageWorkspace}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="countryCode">Country (ISO)</Label>
                    <Input
                      id="countryCode"
                      value={countryCode}
                      onChange={(event) => setCountryCode(event.target.value.toUpperCase())}
                      maxLength={3}
                      disabled={!canManageWorkspace}
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="currency">Default currency</Label>
                    <Input
                      id="currency"
                      value={defaultCurrency}
                      onChange={(event) => setDefaultCurrency(event.target.value.toUpperCase())}
                      maxLength={3}
                      disabled={!canManageWorkspace}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="timezone">Timezone</Label>
                    <Input
                      id="timezone"
                      value={timezone}
                      onChange={(event) => setTimezone(event.target.value)}
                      disabled={!canManageWorkspace}
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="volume">Monthly statement volume</Label>
                    <Input
                      id="volume"
                      value={monthlyStatementVolume}
                      onChange={(event) => setMonthlyStatementVolume(event.target.value)}
                      placeholder="Example: 101-500"
                      disabled={!canManageWorkspace}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cmoCount">Primary CMO relationships</Label>
                    <Input
                      id="cmoCount"
                      type="number"
                      min={0}
                      value={primaryCmoCount}
                      onChange={(event) => setPrimaryCmoCount(event.target.value)}
                      disabled={!canManageWorkspace}
                    />
                  </div>
                </div>
                {canManageWorkspace && (
                  <Button type="submit" disabled={savingWorkspace} className="w-full sm:w-auto">
                    {savingWorkspace ? "Saving..." : "Save Workspace Profile"}
                  </Button>
                )}
              </form>
            ) : (
              <div className={mutedPanelClass}>
                This account is not currently attached to a workspace.
              </div>
            )}
          </CardContent>
        </Card>

        <Card surface="muted" className="overflow-hidden">
          <CardHeader className={sectionHeaderClass}>
            <CardTitle>Team Directory</CardTitle>
            <CardDescription>Everyone with access to this workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading members...</p>
            ) : members.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members found yet.</p>
            ) : (
              <div className="space-y-3">
                {members.map((member) => {
                  const name = [member.first_name, member.last_name].filter(Boolean).join(" ").trim();
                  const displayName = name || member.email || "Unnamed user";
                  return (
                    <div key={member.member_user_id} className={panelClass}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{displayName}</p>
                          <p className="truncate text-xs text-muted-foreground">{member.email ?? "No email"}</p>
                          {member.job_title && <p className="mt-1 text-xs text-muted-foreground">{member.job_title}</p>}
                        </div>
                        <Badge variant="outline">{titleCaseRole(member.role)}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
          </div>
        </TabsContent>

        {onboardingState.isPlatformAdmin && (
          <TabsContent value="platform" className="space-y-5">
            <Card surface="intelligence" className="overflow-hidden">
          <CardHeader className={sectionHeaderClass}>
            <CardTitle>Platform Admin Controls</CardTitle>
            <CardDescription>
              Cross-workspace visibility and partner sponsorship controls for onboarding new companies.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3">
              <p className="text-sm font-medium">Workspace Directory</p>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading workspace list...</p>
              ) : globalWorkspaces.length === 0 ? (
                <p className="text-sm text-muted-foreground">No workspaces found yet.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {globalWorkspaces.map((workspace) => (
                    <div key={workspace.company_id} className={panelClass}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-medium">{workspace.company_name}</p>
                        {workspace.company_id === onboardingState.companyId && <Badge variant="outline">Current</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={panelClass}>
              <p className="text-sm font-medium">Generate Partner Code</p>
              <form className="space-y-3" onSubmit={handleGeneratePartnerCode}>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Workspace</Label>
                    <Select value={partnerCodeWorkspaceId || undefined} onValueChange={setPartnerCodeWorkspaceId}>
                      <SelectTrigger id="partnerCodeWorkspace">
                        <SelectValue
                          placeholder={globalWorkspaces.length === 0 ? "No workspaces available" : "Select workspace"}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {globalWorkspaces.map((workspace) => (
                          <SelectItem key={workspace.company_id} value={workspace.company_id}>
                            {workspace.company_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Selected workspace: {selectedPartnerCodeWorkspaceName}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Sponsor months</Label>
                    <Select value={String(partnerCodeMonths)} onValueChange={(value) => setPartnerCodeMonths(Number(value))}>
                      <SelectTrigger id="sponsorMonths">
                        <SelectValue placeholder="Select duration" />
                      </SelectTrigger>
                      <SelectContent>
                        {sponsorMonthOptions.map((months) => (
                          <SelectItem key={months} value={String(months)}>
                            {months} month{months > 1 ? "s" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button type="submit" variant="outline" disabled={generatingPartnerCode}>
                  {generatingPartnerCode ? "Generating..." : "Generate Partner Code"}
                </Button>
              </form>

              {generatedPartnerCode && (
                <div className={`${mutedPanelClass} mt-4 space-y-2`}>
                  <p className="text-xs text-muted-foreground">
                    {generatedPartnerCode.companyName} | {generatedPartnerCode.sponsorMonths} month sponsorship
                  </p>
                  <Input
                    readOnly
                    value={generatedPartnerCode.partnerCode}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(generatedPartnerCode.partnerCode);
                          toast({ title: "Partner code copied" });
                        } catch {
                          toast({
                            title: "Copy failed",
                            description: generatedPartnerCode.partnerCode,
                            variant: "destructive",
                          });
                        }
                      }}
                    >
                      <Copy className="mr-2 h-3 w-3" />
                      Copy Code
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Generated {formatDateTime(generatedPartnerCode.generatedAt)}
                    </p>
                  </div>
                  {generatedPartnerCode.expiresAt && (
                    <p className="text-xs text-muted-foreground">
                      Code expires {formatDateTime(generatedPartnerCode.expiresAt)}.
                    </p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="access" className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <Card surface="evidence" className="overflow-hidden">
              <CardHeader className={sectionHeaderClass}>
                <CardTitle>Invite Access</CardTitle>
                <CardDescription>
                  {canManageWorkspace
                    ? onboardingState.isPlatformAdmin
                      ? "Invite users into the current workspace, an existing workspace, or a newly created workspace."
                      : "Invite teammates and define role, expiry, and access scope."
                    : "Only workspace owners and admins can send invites."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {canManageWorkspace ? (
                  <form className="space-y-4" onSubmit={handleSendInvite}>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="inviteEmail">Invite email</Label>
                        <Input
                          id="inviteEmail"
                          type="email"
                          value={inviteEmail}
                          onChange={(event) => setInviteEmail(event.target.value)}
                          placeholder="teammate@publisher.com"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Role</Label>
                        <Select value={inviteRole} onValueChange={setInviteRole}>
                          <SelectTrigger id="inviteRole">
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                          <SelectContent>
                            {(onboardingState.isPlatformAdmin && platformTargetMode === "new"
                              ? bootstrapRoleOptions
                              : roleOptions
                            ).map((value) => (
                              <SelectItem key={value} value={value}>
                                {titleCaseRole(value)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {onboardingState.isPlatformAdmin && platformTargetMode === "new" ? (
                          <p className="text-xs text-muted-foreground">
                            First invite into a new workspace must be Owner or Admin.
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Invite expiry</Label>
                        <Select value={String(inviteExpiryDays)} onValueChange={(value) => setInviteExpiryDays(Number(value))}>
                          <SelectTrigger id="expiryDays">
                            <SelectValue placeholder="Select expiry" />
                          </SelectTrigger>
                          <SelectContent>
                            {expiryOptions.map((days) => (
                              <SelectItem key={days} value={String(days)}>
                                {days} days
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {onboardingState.isPlatformAdmin ? (
                        <div className="space-y-2 md:col-span-2">
                          <Label>Workspace target mode</Label>
                          <Select
                            value={platformTargetMode}
                            onValueChange={(value) => setPlatformTargetMode(value as PlatformTargetMode)}
                          >
                            <SelectTrigger id="workspaceTargetMode">
                              <SelectValue placeholder="Select target mode" />
                            </SelectTrigger>
                            <SelectContent>
                              {hasWorkspace ? <SelectItem value="current">Current workspace</SelectItem> : null}
                              <SelectItem value="existing">Existing workspace</SelectItem>
                              <SelectItem value="new">New workspace</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}
                    </div>

                    {onboardingState.isPlatformAdmin && canShowWorkspaceTargetSelect ? (
                      <div className="space-y-2">
                        <Label>Target workspace</Label>
                        <Select value={selectedWorkspaceId || undefined} onValueChange={setSelectedWorkspaceId}>
                          <SelectTrigger id="targetWorkspace">
                            <SelectValue
                              placeholder={globalWorkspaces.length === 0 ? "No workspaces available" : "Select workspace"}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {globalWorkspaces.map((workspace) => (
                              <SelectItem key={workspace.company_id} value={workspace.company_id}>
                                {workspace.company_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {globalWorkspaces.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No workspace records found yet.</p>
                        ) : null}
                      </div>
                    ) : null}

                    {onboardingState.isPlatformAdmin && canShowNewWorkspaceInput ? (
                      <div className="space-y-2">
                        <Label htmlFor="newWorkspaceName">New workspace name</Label>
                        <Input
                          id="newWorkspaceName"
                          value={newWorkspaceName}
                          onChange={(event) => setNewWorkspaceName(event.target.value)}
                          placeholder="Nexus Music Publishing"
                        />
                      </div>
                    ) : null}

                    {onboardingState.isPlatformAdmin && canShowCurrentWorkspaceHint ? (
                      <div className="space-y-2">
                        <Label>Target workspace</Label>
                        <div className={panelClass}>
                          {onboardingState.companyName ?? "No current workspace selected"}
                        </div>
                      </div>
                    ) : null}

                    {onboardingState.isPlatformAdmin ? (
                      <div className={mutedPanelClass}>
                        Invite target: {inviteTargetLabel}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="submit" disabled={sendingInvite}>
                        <MailPlus className="mr-2 h-4 w-4" />
                        {sendingInvite ? "Sending invite..." : "Send Invite"}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className={mutedPanelClass}>
                    Admins manage invitations for this workspace. Contact your workspace owner/admin for access updates.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card surface="muted" className="overflow-hidden">
              <CardHeader className={sectionHeaderClass}>
                <div className="flex items-center gap-2">
                  <Users2 className="h-4 w-4 text-[hsl(var(--brand-accent))]" />
                  <CardTitle>Recent Invitations</CardTitle>
                </div>
                <CardDescription>Delivery status, workspace target, and reusable invite links.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {loading ? (
                  <p className="text-sm text-muted-foreground">Loading invitations...</p>
                ) : invites.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No invitations recorded yet.</p>
                ) : (
                  invites.map((invite) => (
                    <div key={invite.invitation_id} className={panelClass}>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{invite.email}</p>
                        <Badge variant="outline">{titleCaseRole(invite.role)}</Badge>
                        <Badge variant="outline">{titleCaseStatus(invite.status)}</Badge>
                        <Badge variant="outline">{titleCaseStatus(invite.auth_delivery_status)}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {invite.company_name ?? "Workspace pending"} | Created {formatDateTime(invite.created_at)} | Expires{" "}
                        {formatDateTime(invite.expires_at)}
                      </p>
                      {invite.auth_delivery_error ? (
                        <p className="mt-1 text-xs text-muted-foreground">{invite.auth_delivery_error}</p>
                      ) : null}
                      {invite.latest_invite_link ? (
                        <div className="mt-3 space-y-2">
                          <Input
                            readOnly
                            value={invite.latest_invite_link}
                            className="h-8 text-xs"
                            onFocus={(event) => event.currentTarget.select()}
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            {invite.latest_invite_link_generated_at ? (
                              <p className="text-xs text-muted-foreground">
                                Generated {formatDateTime(invite.latest_invite_link_generated_at)}
                              </p>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[10px]"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(invite.latest_invite_link ?? "");
                                  toast({ title: "Invite link copied" });
                                } catch {
                                  toast({
                                    title: "Copy failed",
                                    description: invite.latest_invite_link ?? "",
                                    variant: "destructive",
                                  });
                                }
                              }}
                            >
                              <Copy className="mr-1 h-3 w-3" />
                              Copy Link
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {!schemaReady && (
        <Card surface="muted" className="overflow-hidden">
          <CardContent className="flex items-start gap-2 p-4 text-sm text-muted-foreground">
            <Shield className="mt-0.5 h-4 w-4" />
            <p>
              Workspace features are not available yet. Apply the latest migrations to enable profile, member directory,
              and invitation controls.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

