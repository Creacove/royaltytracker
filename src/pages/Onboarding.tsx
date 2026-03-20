import { useEffect, useMemo, useState } from "react";
import { Building2, ShieldCheck, UserRound } from "lucide-react";

import { EntryShell } from "@/components/layout/EntryShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { OnboardingState } from "@/types/onboarding";

const statementVolumeOptions = [
  { value: "0-25", label: "0-25 statements / month" },
  { value: "26-100", label: "26-100 statements / month" },
  { value: "101-500", label: "101-500 statements / month" },
  { value: "500+", label: "500+ statements / month" },
];

type OnboardingProps = {
  initialState: OnboardingState;
  onCompleted: () => Promise<void> | void;
};

export default function Onboarding({ initialState, onCompleted }: OnboardingProps) {
  const [firstName, setFirstName] = useState(initialState.firstName);
  const [lastName, setLastName] = useState(initialState.lastName);
  const [jobTitle, setJobTitle] = useState(initialState.jobTitle);
  const [phone, setPhone] = useState(initialState.phone);
  const [companyName, setCompanyName] = useState(initialState.companyName ?? "");
  const [website, setWebsite] = useState(initialState.website ?? "");
  const [countryCode, setCountryCode] = useState(initialState.countryCode ?? "");
  const [defaultCurrency, setDefaultCurrency] = useState(initialState.defaultCurrency);
  const [timezone, setTimezone] = useState(initialState.timezone);
  const [monthlyStatementVolume, setMonthlyStatementVolume] = useState(initialState.monthlyStatementVolume ?? "");
  const [primaryCmoCount, setPrimaryCmoCount] = useState(
    initialState.primaryCmoCount === null ? "" : String(initialState.primaryCmoCount),
  );
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setFirstName(initialState.firstName);
    setLastName(initialState.lastName);
    setJobTitle(initialState.jobTitle);
    setPhone(initialState.phone);
    setCompanyName(initialState.companyName ?? "");
    setWebsite(initialState.website ?? "");
    setCountryCode(initialState.countryCode ?? "");
    setDefaultCurrency(initialState.defaultCurrency);
    setTimezone(initialState.timezone);
    setMonthlyStatementVolume(initialState.monthlyStatementVolume ?? "");
    setPrimaryCmoCount(initialState.primaryCmoCount === null ? "" : String(initialState.primaryCmoCount));
  }, [initialState]);

  const companyLocked = Boolean(initialState.companyId);
  const effectiveWorkspaceRole = initialState.activeMembershipRole ?? initialState.pendingInvitationRole;
  const canEditWorkspaceProfile = useMemo(() => {
    if (initialState.isPlatformAdmin) return true;
    if (!initialState.companyId) return true;
    return effectiveWorkspaceRole === "owner" || effectiveWorkspaceRole === "admin";
  }, [effectiveWorkspaceRole, initialState.companyId, initialState.isPlatformAdmin]);
  const inviteRole = useMemo(() => {
    if (!initialState.pendingInvitationRole) return null;
    return initialState.pendingInvitationRole.charAt(0).toUpperCase() + initialState.pendingInvitationRole.slice(1);
  }, [initialState.pendingInvitationRole]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!firstName.trim() || !lastName.trim() || !jobTitle.trim()) {
      toast({
        title: "Missing required fields",
        description: "First name, last name, and job title are required.",
        variant: "destructive",
      });
      return;
    }

    if (canEditWorkspaceProfile && !companyLocked && !companyName.trim()) {
      toast({
        title: "Workspace name required",
        description: "Enter your workspace name to finish onboarding.",
        variant: "destructive",
      });
      return;
    }

    const parsedCmoCount = primaryCmoCount.trim() === "" ? null : Number(primaryCmoCount);
    if (canEditWorkspaceProfile && parsedCmoCount !== null && (!Number.isInteger(parsedCmoCount) || parsedCmoCount < 0)) {
      toast({
        title: "Invalid CMO count",
        description: "Primary CMO count must be a whole number greater than or equal to 0.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);

    const { error } = await (supabase as any).rpc("complete_partner_onboarding", {
      p_first_name: firstName.trim(),
      p_last_name: lastName.trim(),
      p_job_title: jobTitle.trim(),
      p_phone: phone.trim() || null,
      p_company_name: canEditWorkspaceProfile ? companyName.trim() || null : null,
      p_website: canEditWorkspaceProfile ? website.trim() || null : null,
      p_country_code: canEditWorkspaceProfile ? countryCode.trim() || null : null,
      p_default_currency: defaultCurrency.trim() || "USD",
      p_timezone: timezone.trim() || "UTC",
      p_monthly_statement_volume: canEditWorkspaceProfile ? monthlyStatementVolume || null : null,
      p_primary_cmo_count: canEditWorkspaceProfile ? parsedCmoCount : null,
    });

    if (error) {
      toast({
        title: "Onboarding failed",
        description: error.message,
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }

    toast({
      title: "Onboarding completed",
      description: "Your workspace is ready.",
    });

    await onCompleted();
    setSubmitting(false);
  };

  return (
    <EntryShell
      eyebrow="OrderSounds Desk setup"
      title="Set up the workspace behind the reporting."
      description="Capture the operator profile and workspace defaults that let music reporting land in one normalized workspace for analysis and decision-making."
      badge={inviteRole ? `${inviteRole} invite` : "Partner onboarding"}
      points={[
        {
          icon: <UserRound className="h-4 w-4" />,
          title: "Identity and role",
          description: "Capture the operator details that will appear throughout support, audit, and approvals.",
        },
        {
          icon: <Building2 className="h-4 w-4" />,
          title: "Workspace defaults",
          description: "Set the currency, timezone, and reporting profile that statement normalization depends on.",
        },
        {
          icon: <ShieldCheck className="h-4 w-4" />,
          title: "Tight access model",
          description: "Only owners, admins, or platform administrators can change workspace-wide setup.",
        },
      ]}
      contentClassName="max-w-[760px]"
    >
      <Card surface="hero" className="w-full">
        <CardHeader className="space-y-3 border-b border-[hsl(var(--border)/0.1)]">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-[hsl(var(--brand-accent)/0.14)] bg-[hsl(var(--brand-accent-ghost)/0.62)] text-[hsl(var(--brand-accent))]"
            >
              Workspace setup
            </Badge>
            {initialState.hasPendingInvitation ? <Badge variant="outline">Invitation detected</Badge> : null}
            {inviteRole ? <Badge variant="outline">Role: {inviteRole}</Badge> : null}
          </div>
          <div className="space-y-2">
            <CardTitle className="text-[1.95rem]">Complete onboarding</CardTitle>
            <CardDescription>Only the fields that affect operator identity, workspace defaults, and reporting normalization stay here.</CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="surface-elevated forensic-frame space-y-4 rounded-[calc(var(--radius-sm))] p-4">
              <div className="space-y-1">
                <p className="editorial-kicker">Operator</p>
                <h3 className="text-base font-semibold text-foreground">Who is entering the workspace?</h3>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First name</Label>
                  <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last name</Label>
                  <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="jobTitle">Job title</Label>
                  <Input id="jobTitle" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1..." />
                </div>
              </div>
            </div>

            {canEditWorkspaceProfile ? (
              <div className="surface-elevated forensic-frame space-y-4 rounded-[calc(var(--radius-sm))] p-4">
                <div className="space-y-1">
                  <p className="editorial-kicker">Workspace</p>
                  <h3 className="text-base font-semibold text-foreground">Set the operating defaults</h3>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="companyName">Workspace name</Label>
                  <Input
                    id="companyName"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    required={!companyLocked}
                    disabled={companyLocked}
                  />
                  {companyLocked ? (
                    <p className="text-sm text-muted-foreground">This workspace name is locked by the invitation and cannot be changed here.</p>
                  ) : null}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="website">Website</Label>
                    <Input
                      id="website"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="https://"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="countryCode">Country</Label>
                    <Input
                      id="countryCode"
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      placeholder="US"
                      maxLength={3}
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="defaultCurrency">Default currency</Label>
                    <Input
                      id="defaultCurrency"
                      value={defaultCurrency}
                      onChange={(e) => setDefaultCurrency(e.target.value.toUpperCase())}
                      placeholder="USD"
                      maxLength={3}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="timezone">Timezone</Label>
                    <Input
                      id="timezone"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      placeholder="UTC"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Monthly statement volume</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {statementVolumeOptions.map((option) => (
                      <Button
                        key={option.value}
                        type="button"
                        variant={monthlyStatementVolume === option.value ? "default" : "quiet"}
                        className="justify-start"
                        onClick={() => setMonthlyStatementVolume(option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="primaryCmoCount">Primary CMO relationships</Label>
                  <Input
                    id="primaryCmoCount"
                    type="number"
                    min={0}
                    value={primaryCmoCount}
                    onChange={(e) => setPrimaryCmoCount(e.target.value)}
                    placeholder="Example: 6"
                  />
                </div>
              </div>
            ) : (
              <div className="surface-elevated forensic-frame space-y-3 rounded-[calc(var(--radius-sm))] p-4">
                <div className="space-y-1">
                  <p className="editorial-kicker">Workspace access</p>
                  <h3 className="text-base font-semibold text-foreground">Your membership is ready</h3>
                </div>
                <p className="text-sm text-foreground/82">
                  You are joining <span className="font-semibold">{companyName || "your workspace"}</span> as{" "}
                  <span className="font-semibold">{inviteRole ?? "member"}</span>.
                </p>
                <p className="text-sm text-muted-foreground">
                  Workspace-wide defaults are managed by owners and admins, so this step only confirms your identity and role.
                </p>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Finalizing..." : "Enter workspace"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </EntryShell>
  );
}
