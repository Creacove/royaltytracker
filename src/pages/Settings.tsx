import { useEffect, useMemo, useState } from "react";
import { Building2, KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useWorkspaceSubscriptionState } from "@/hooks/useWorkspaceSubscriptionState";
import { supabase } from "@/integrations/supabase/client";
import type { OnboardingState } from "@/types/onboarding";

type SettingsProps = {
  userId: string;
  userEmail: string;
  onboardingState: OnboardingState;
  onProfileUpdated: () => Promise<void> | void;
};

function titleCaseRole(role: string | null | undefined) {
  if (!role) return "Member";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default function Settings({ userId, userEmail, onboardingState, onProfileUpdated }: SettingsProps) {
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const { state: subscriptionState, loading: subscriptionLoading } = useWorkspaceSubscriptionState(userId);

  const [firstName, setFirstName] = useState(onboardingState.firstName);
  const [lastName, setLastName] = useState(onboardingState.lastName);
  const [jobTitle, setJobTitle] = useState(onboardingState.jobTitle);
  const [phone, setPhone] = useState(onboardingState.phone);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [sendingResetLink, setSendingResetLink] = useState(false);

  const isRecoveryFlow = useMemo(() => {
    const hashParams = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : location.hash);
    const searchParams = new URLSearchParams(location.search);
    return hashParams.get("type") === "recovery" || searchParams.get("password_reset") === "1";
  }, [location.hash, location.search]);

  const passwordResetRedirectTo = useMemo(() => `${window.location.origin}/settings?password_reset=1`, []);
  const planBadgeLabel = useMemo(() => {
    if (subscriptionLoading) return "Plan loading";
    const planName = subscriptionState.planName ?? "Inactive";
    const status = subscriptionState.effectiveSubscriptionStatus.replaceAll("_", " ");
    return `${planName} • ${status}`;
  }, [subscriptionLoading, subscriptionState.effectiveSubscriptionStatus, subscriptionState.planName]);
  const workspaceRoleLabel = useMemo(
    () => (onboardingState.isPlatformAdmin ? "Platform Admin" : titleCaseRole(onboardingState.activeMembershipRole)),
    [onboardingState.activeMembershipRole, onboardingState.isPlatformAdmin],
  );

  useEffect(() => {
    setFirstName(onboardingState.firstName);
    setLastName(onboardingState.lastName);
    setJobTitle(onboardingState.jobTitle);
    setPhone(onboardingState.phone);
  }, [onboardingState]);

  const handleSaveProfile = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!firstName.trim() || !lastName.trim() || !jobTitle.trim()) {
      toast({
        title: "Missing required fields",
        description: "First name, last name, and job title are required.",
        variant: "destructive",
      });
      return;
    }

    setSavingProfile(true);

    const { error } = await (supabase as any).from("app_users").upsert(
      {
        id: userId,
        email: userEmail.toLowerCase(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        job_title: jobTitle.trim(),
        phone: phone.trim() || null,
      },
      { onConflict: "id" },
    );

    if (error) {
      toast({
        title: "Profile save failed",
        description: error.message,
        variant: "destructive",
      });
      setSavingProfile(false);
      return;
    }

    await onProfileUpdated();
    toast({
      title: "Profile updated",
      description: "Your user profile settings are saved.",
    });
    setSavingProfile(false);
  };

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!isRecoveryFlow && !currentPassword) {
      toast({
        title: "Current password required",
        description: "Enter your current password to confirm this change.",
        variant: "destructive",
      });
      return;
    }

    if (newPassword.length < 8) {
      toast({
        title: "Password too short",
        description: "Use at least 8 characters.",
        variant: "destructive",
      });
      return;
    }

    if (!isRecoveryFlow && newPassword === currentPassword) {
      toast({
        title: "Choose a new password",
        description: "New password must be different from your current password.",
        variant: "destructive",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords do not match",
        description: "Confirm password must match new password.",
        variant: "destructive",
      });
      return;
    }

    setSavingPassword(true);
    if (!isRecoveryFlow) {
      const { data: verifyData, error: verifyError } = await supabase.auth.signInWithPassword({
        email: userEmail.toLowerCase(),
        password: currentPassword,
      });

      if (verifyError || verifyData.user?.id !== userId) {
        toast({
          title: "Current password is incorrect",
          description: "Re-enter your current password and try again.",
          variant: "destructive",
        });
        setSavingPassword(false);
        return;
      }
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      toast({
        title: "Password update failed",
        description: error.message,
        variant: "destructive",
      });
      setSavingPassword(false);
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    toast({
      title: "Password updated",
      description: "Use the new password on your next sign-in.",
    });
    if (isRecoveryFlow) {
      navigate("/settings", { replace: true });
    }
    setSavingPassword(false);
  };

  const handleSendResetLink = async () => {
    if (!userEmail.trim()) {
      toast({
        title: "Email unavailable",
        description: "Cannot send reset link because your email is missing.",
        variant: "destructive",
      });
      return;
    }

    setSendingResetLink(true);
    const { error } = await supabase.auth.resetPasswordForEmail(userEmail.toLowerCase(), {
      redirectTo: passwordResetRedirectTo,
    });

    if (error) {
      toast({
        title: "Reset link failed",
        description: error.message,
        variant: "destructive",
      });
      setSendingResetLink(false);
      return;
    }

    toast({
      title: "Reset link sent",
      description: "Check your inbox, open the link, then set a new password here.",
    });
    setSendingResetLink(false);
  };

  return (
    <div className="rhythm-page">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        subtitle={
          isRecoveryFlow
            ? "Recovery mode is active. Reset credentials and restore account access."
            : "Profile, workspace access, and sign-in security."
        }
        meta={
          <>
            <span className="rounded-full border border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-elevated)/0.72)] px-2.5 py-1 text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">
              {onboardingState.companyName ?? "No workspace"}
            </span>
            <span className="rounded-full border border-[hsl(var(--brand-accent)/0.16)] bg-[hsl(var(--brand-accent-ghost)/0.72)] px-2.5 py-1 text-[10px] font-ui uppercase tracking-[0.12em] text-[hsl(var(--brand-accent))]">
              {workspaceRoleLabel}
            </span>
            <span className="rounded-full border border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-panel)/0.72)] px-2.5 py-1 text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">
              {planBadgeLabel}
            </span>
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(320px,0.82fr)]">
        <Card surface="evidence" className="overflow-hidden">
          <CardHeader className="border-b border-[hsl(var(--border)/0.1)] pb-4">
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-[hsl(var(--brand-accent))]" />
              <CardTitle>Profile</CardTitle>
            </div>
            <CardDescription>Identity and contact details used across the workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="surface-muted forensic-frame rounded-[calc(var(--radius-sm))] p-4">
              <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Account email</p>
              <p className="mt-2 text-sm font-medium text-foreground">{userEmail}</p>
              <p className="mt-1 text-xs text-muted-foreground">Managed from authentication and used for sign-in.</p>
            </div>

            <form className="space-y-5" onSubmit={handleSaveProfile}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First name</Label>
                  <Input id="firstName" value={firstName} onChange={(event) => setFirstName(event.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last name</Label>
                  <Input id="lastName" value={lastName} onChange={(event) => setLastName(event.target.value)} required />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="jobTitle">Job title</Label>
                  <Input id="jobTitle" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1..." />
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={savingProfile}>
                  {savingProfile ? "Saving..." : "Save Profile"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-5">
          <Card surface="hero" className="overflow-hidden">
            <CardHeader className="border-b border-[hsl(var(--border)/0.1)] pb-4">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-[hsl(var(--brand-accent))]" />
                <CardTitle>Workspace Seat</CardTitle>
              </div>
              <CardDescription>Current workspace context for this account.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-4">
                <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Workspace</p>
                <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">
                  {onboardingState.companyName ?? "No workspace"}
                </p>
              </div>
              <div className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-4">
                <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Role</p>
                <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">{workspaceRoleLabel}</p>
              </div>
              <div className="surface-intelligence forensic-frame rounded-[calc(var(--radius-sm))] p-4">
                <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Plan</p>
                <p className="mt-2 text-sm leading-6 text-foreground">{planBadgeLabel}</p>
              </div>
            </CardContent>
          </Card>

          <Card surface={isRecoveryFlow ? "intelligence" : "evidence"} className="overflow-hidden">
            <CardHeader className="border-b border-[hsl(var(--border)/0.1)] pb-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[hsl(var(--brand-accent))]" />
                <CardTitle>Security</CardTitle>
              </div>
              <CardDescription>
                {isRecoveryFlow
                  ? "Set a new password to restore account access."
                  : "Confirm your current password, then rotate credentials."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {isRecoveryFlow ? (
                <div className="surface-intelligence forensic-frame rounded-[calc(var(--radius-sm))] p-4">
                  <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-[hsl(var(--brand-accent))]">
                    Recovery mode
                  </p>
                  <p className="mt-2 text-sm leading-6 text-foreground/82">
                    This session was opened from a password recovery link. Set a new password below.
                  </p>
                </div>
              ) : null}

              <form className="space-y-4" onSubmit={handleChangePassword}>
                {!isRecoveryFlow && (
                  <div className="space-y-2">
                    <Label htmlFor="currentPassword">Current password</Label>
                    <Input
                      id="currentPassword"
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      required
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="newPassword">New password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    minLength={8}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm new password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    minLength={8}
                    required
                  />
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={savingPassword}>
                    <KeyRound className="h-4 w-4" />
                    {savingPassword ? "Updating..." : "Update Password"}
                  </Button>
                </div>
              </form>

              {!isRecoveryFlow && (
                <div className="surface-muted forensic-frame rounded-[calc(var(--radius-sm))] p-4">
                  <p className="text-xs leading-6 text-muted-foreground">
                    Don&apos;t remember your current password or never set one from invite onboarding?
                  </p>
                  <Button
                    type="button"
                    variant="quiet"
                    size="sm"
                    className="mt-3"
                    onClick={handleSendResetLink}
                    disabled={sendingResetLink}
                  >
                    {sendingResetLink ? "Sending reset link..." : "Send Password Reset Link"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
