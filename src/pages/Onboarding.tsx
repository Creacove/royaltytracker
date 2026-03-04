import { useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, ShieldCheck, UserRound } from "lucide-react";

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
    initialState.primaryCmoCount === null ? "" : String(initialState.primaryCmoCount)
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
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1200px] overflow-hidden rounded-md border border-border/50 md:grid-cols-[1.05fr_1fr]">
        <section className="relative hidden border-r border-border/50 bg-[linear-gradient(145deg,hsl(var(--brand-accent-ghost))/80,transparent_72%)] p-8 md:flex md:flex-col md:justify-between">
          <div className="space-y-6">
            <img src="/ordersounds-logo.png" alt="OrderSounds" className="h-8 w-auto object-contain" />
            <div className="space-y-2">
              <h1 className="font-display text-4xl leading-none tracking-[0.04em]">Partner Onboarding</h1>
              <p className="text-sm text-muted-foreground">
                We configure your publisher workspace for clean statement ingestion and reliable royalty visibility.
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <UserRound className="mt-0.5 h-4 w-4 text-[hsl(var(--brand-accent))]" />
                <div>
                  <p className="text-sm font-medium">Account identity</p>
                  <p className="text-xs text-muted-foreground">Capture role and contact metadata for support and audit.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Building2 className="mt-0.5 h-4 w-4 text-[hsl(var(--brand-accent))]" />
                <div>
                  <p className="text-sm font-medium">Publisher setup</p>
                  <p className="text-xs text-muted-foreground">
                    Configure workspace defaults for onboarding and statement normalization.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-[hsl(var(--brand-accent))]" />
                <div>
                  <p className="text-sm font-medium">Invitation-only access</p>
                  <p className="text-xs text-muted-foreground">
                    Workspace access remains restricted to approved partner identities.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2 border-t border-border/45 pt-5">
            <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Activation</p>
            <p className="text-sm">Once this form is completed, you enter the production workspace immediately.</p>
          </div>
        </section>

        <section className="flex items-center justify-center bg-background p-4 md:p-8">
          <Card className="w-full max-w-xl border-0 bg-transparent shadow-none">
            <CardHeader className="px-0">
              <div className="mb-2 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-[hsl(var(--brand-accent))]" />
                <CardTitle className="text-3xl">Complete Workspace Setup</CardTitle>
              </div>
              <CardDescription>Tell us about your role and publisher profile to finalize onboarding.</CardDescription>
              {initialState.hasPendingInvitation && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">Invitation detected</Badge>
                  {inviteRole && <Badge variant="outline">Role: {inviteRole}</Badge>}
                </div>
              )}
            </CardHeader>

            <CardContent className="px-0">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-3">
                  <p className="font-display text-xs uppercase tracking-[0.08em] text-muted-foreground">User profile</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First name</Label>
                      <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last name</Label>
                      <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
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
                  <div className="space-y-3">
                    <p className="font-display text-xs uppercase tracking-[0.08em] text-muted-foreground">
                      Publisher workspace
                    </p>

                    <div className="space-y-2">
                      <Label htmlFor="companyName">Workspace name</Label>
                      <Input
                        id="companyName"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        required={!companyLocked}
                        disabled={companyLocked}
                      />
                      {companyLocked && (
                        <p className="text-xs text-muted-foreground">
                          Workspace name is fixed by your invitation and cannot be changed here.
                        </p>
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
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
                        <Label htmlFor="countryCode">Country (ISO code)</Label>
                        <Input
                          id="countryCode"
                          value={countryCode}
                          onChange={(e) => setCountryCode(e.target.value)}
                          placeholder="US"
                          maxLength={3}
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
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
                            variant={monthlyStatementVolume === option.value ? "default" : "outline"}
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
                  <div className="space-y-2 rounded-md border border-border/50 bg-muted/20 p-4">
                    <p className="font-display text-xs uppercase tracking-[0.08em] text-muted-foreground">Workspace access</p>
                    <p className="text-sm">
                      You are joining <span className="font-medium">{companyName || "your workspace"}</span> as{" "}
                      <span className="font-medium">{inviteRole ?? "member"}</span>.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Workspace profile settings are managed by owners/admins and are not editable during member onboarding.
                    </p>
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Finalizing..." : "Enter Workspace"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
