import { useEffect, useMemo, useState } from "react";
import { Building2, Copy, MailPlus, Shield, Users2 } from "lucide-react";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
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

const roleOptions = ["owner", "admin", "member", "viewer"];
const expiryOptions = [7, 14, 30];

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

export default function Company({ onboardingState, schemaReady, onCompanyUpdated }: CompanyProps) {
  const { toast } = useToast();

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

  const [workspaceMode, setWorkspaceMode] = useState<"existing" | "new">("existing");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(onboardingState.companyId ?? "");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");

  useEffect(() => {
    setWorkspaceName(onboardingState.companyName ?? "");
    setWebsite(onboardingState.website ?? "");
    setCountryCode(onboardingState.countryCode ?? "");
    setDefaultCurrency(onboardingState.defaultCurrency);
    setTimezone(onboardingState.timezone);
    setMonthlyStatementVolume(onboardingState.monthlyStatementVolume ?? "");
    setPrimaryCmoCount(onboardingState.primaryCmoCount === null ? "" : String(onboardingState.primaryCmoCount));
    if (onboardingState.companyId) {
      setSelectedWorkspaceId(onboardingState.companyId);
    }
  }, [onboardingState]);

  const loadWorkspaceData = async () => {
    if (!schemaReady) return;
    setLoading(true);

    if (hasWorkspace) {
      const calls = [(supabase as any).rpc("list_my_company_members")] as Array<Promise<any>>;
      if (canManageWorkspace) {
        calls.push((supabase as any).rpc("list_my_company_invitations", { p_limit: 100 }));
      }

      const [membersResult, invitesResult] = await Promise.all(calls);

      if (membersResult?.error) {
        toast({
          title: "Could not load workspace members",
          description: membersResult.error.message,
          variant: "destructive",
        });
      } else {
        setMembers((membersResult?.data ?? []) as CompanyMember[]);
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

      setGlobalWorkspaces([]);
    } else if (onboardingState.isPlatformAdmin) {
      const [workspacesResult, invitesResult] = await Promise.all([
        (supabase as any).rpc("list_invitable_companies"),
        (supabase as any).rpc("list_visible_partner_invitations", { p_limit: 100 }),
      ]);

      if (workspacesResult.error) {
        toast({
          title: "Could not load workspaces",
          description: workspacesResult.error.message,
          variant: "destructive",
        });
      } else {
        const rows = (workspacesResult.data ?? []) as InvitableWorkspace[];
        setGlobalWorkspaces(rows);
        if (!selectedWorkspaceId && rows.length > 0) {
          setSelectedWorkspaceId(rows[0].company_id);
        }
      }

      if (invitesResult.error) {
        toast({
          title: "Could not load invitations",
          description: invitesResult.error.message,
          variant: "destructive",
        });
      } else {
        setInvites((invitesResult.data ?? []) as CompanyInvitation[]);
      }

      setMembers([]);
    } else {
      setMembers([]);
      setInvites([]);
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

    if (!inviteEmail.trim()) {
      toast({
        title: "Missing email",
        description: "Enter an invite email address.",
        variant: "destructive",
      });
      return;
    }

    const payload: Record<string, unknown> = {
      email: inviteEmail.trim(),
      role: inviteRole,
      expiresInDays: inviteExpiryDays,
      redirectTo: window.location.origin,
    };

    if (hasWorkspace && onboardingState.companyId) {
      payload.companyId = onboardingState.companyId;
    } else if (onboardingState.isPlatformAdmin) {
      if (workspaceMode === "existing") {
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
    setInviteRole("member");
    setInviteExpiryDays(14);
    if (onboardingState.isPlatformAdmin && !hasWorkspace) {
      setNewWorkspaceName("");
    }

    await loadWorkspaceData();
    setSendingInvite(false);
  };

  const roleBadgeLabel = onboardingState.isPlatformAdmin
    ? "Platform Admin"
    : titleCaseRole(onboardingState.activeMembershipRole);

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-border/60">
        <CardContent className="grid gap-4 bg-[linear-gradient(140deg,hsl(var(--brand-accent-ghost))/80,transparent_65%)] p-6 md:grid-cols-[1.35fr_1fr]">
          <div className="space-y-2">
            <p className="font-display text-xs uppercase tracking-[0.08em] text-muted-foreground">Workspace</p>
            <h1 className="font-display text-3xl tracking-[0.04em]">
              {onboardingState.companyName ?? "Workspace profile pending"}
            </h1>
            <p className="text-sm text-muted-foreground">
              Identity, team directory, and controlled access for your workspace.
            </p>
          </div>
          <div className="flex flex-wrap items-start justify-start gap-2 md:justify-end">
            <Badge variant="outline">{roleBadgeLabel}</Badge>
            {hasWorkspace && <Badge variant="outline">{members.length} Members</Badge>}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Workspace Profile</CardTitle>
            <CardDescription>
              {canManageWorkspace
                ? "Control defaults for this workspace."
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
              <div className="rounded-sm border border-border/50 p-4 text-sm text-muted-foreground">
                This account is not currently attached to a workspace.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader>
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
                    <div key={member.member_user_id} className="rounded-sm border border-border/50 p-3">
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

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Access & Invitations</CardTitle>
          <CardDescription>
            {canManageWorkspace
              ? "Invite teammates and monitor invitation status."
              : "Only workspace owners/admins can send invites."}
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
                  <Label htmlFor="inviteRole">Role</Label>
                  <select
                    id="inviteRole"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={inviteRole}
                    onChange={(event) => setInviteRole(event.target.value)}
                  >
                    {roleOptions.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="expiryDays">Invite expiry</Label>
                  <select
                    id="expiryDays"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={String(inviteExpiryDays)}
                    onChange={(event) => setInviteExpiryDays(Number(event.target.value))}
                  >
                    {expiryOptions.map((days) => (
                      <option key={days} value={days}>
                        {days} days
                      </option>
                    ))}
                  </select>
                </div>
                {!hasWorkspace && onboardingState.isPlatformAdmin && (
                  <>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Workspace target</Label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Button
                          type="button"
                          variant={workspaceMode === "existing" ? "default" : "outline"}
                          onClick={() => setWorkspaceMode("existing")}
                        >
                          Existing workspace
                        </Button>
                        <Button
                          type="button"
                          variant={workspaceMode === "new" ? "default" : "outline"}
                          onClick={() => setWorkspaceMode("new")}
                        >
                          New workspace
                        </Button>
                      </div>
                    </div>
                    {workspaceMode === "existing" ? (
                      <div className="space-y-2 md:col-span-3">
                        <Label htmlFor="targetWorkspace">Select workspace</Label>
                        <select
                          id="targetWorkspace"
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={selectedWorkspaceId}
                          onChange={(event) => setSelectedWorkspaceId(event.target.value)}
                        >
                          <option value="">Choose workspace...</option>
                          {globalWorkspaces.map((workspace) => (
                            <option key={workspace.company_id} value={workspace.company_id}>
                              {workspace.company_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="space-y-2 md:col-span-3">
                        <Label htmlFor="newWorkspaceName">New workspace name</Label>
                        <Input
                          id="newWorkspaceName"
                          value={newWorkspaceName}
                          onChange={(event) => setNewWorkspaceName(event.target.value)}
                          placeholder="Nexus Music Publishing"
                        />
                      </div>
                    )}
                  </>
                )}
              </div>

              <Button type="submit" disabled={sendingInvite} className="w-full sm:w-auto">
                <MailPlus className="mr-2 h-4 w-4" />
                {sendingInvite ? "Sending invite..." : "Send Invite"}
              </Button>
            </form>
          ) : (
            <div className="rounded-sm border border-border/50 p-4 text-sm text-muted-foreground">
              Admins manage invitations for this workspace. Contact your workspace owner/admin for access updates.
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Users2 className="h-4 w-4 text-muted-foreground" />
              <p className="font-medium">Recent invitations</p>
            </div>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading invitations...</p>
            ) : invites.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invitations recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {invites.map((invite) => (
                  <div key={invite.invitation_id} className="rounded-sm border border-border/50 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{invite.email}</p>
                      <Badge variant="outline">{titleCaseRole(invite.role)}</Badge>
                      <Badge variant="outline">{titleCaseRole(invite.status)}</Badge>
                      <Badge variant="outline">{titleCaseStatus(invite.auth_delivery_status)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {invite.company_name ?? "Workspace pending"} | Created{" "}
                      {new Date(invite.created_at).toLocaleString()} | Expires {new Date(invite.expires_at).toLocaleString()}
                    </p>
                    {invite.auth_delivery_error && (
                      <p className="mt-1 text-xs text-muted-foreground">{invite.auth_delivery_error}</p>
                    )}
                    {invite.latest_invite_link && (
                      <div className="mt-2 space-y-2">
                        <Input
                          readOnly
                          value={invite.latest_invite_link}
                          className="h-8 text-xs"
                          onFocus={(event) => event.currentTarget.select()}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          {invite.latest_invite_link_generated_at && (
                            <p className="text-xs text-muted-foreground">
                              Generated {new Date(invite.latest_invite_link_generated_at).toLocaleString()}
                            </p>
                          )}
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
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!schemaReady && (
        <Card className="border-border/60">
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
