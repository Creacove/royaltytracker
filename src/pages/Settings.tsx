import { useEffect, useMemo, useState } from "react";
import { KeyRound, UserRound } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
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
    if (subscriptionLoading) return "Plan: ...";
    const planName = subscriptionState.planName ?? "Inactive";
    const status = subscriptionState.effectiveSubscriptionStatus.replaceAll("_", " ");
    return `Plan: ${planName} (${status})`;
  }, [subscriptionLoading, subscriptionState.effectiveSubscriptionStatus, subscriptionState.planName]);

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
    <div className="space-y-5">
      <Card className="overflow-hidden border-border/60">
        <CardContent className="grid gap-3 bg-[linear-gradient(140deg,hsl(var(--brand-accent-ghost))/80,transparent_65%)] p-6 md:grid-cols-[1.3fr_1fr]">
          <div className="space-y-2">
            <p className="font-display text-xs uppercase tracking-[0.08em] text-muted-foreground">Account</p>
            <h1 className="font-display text-3xl tracking-[0.04em]">User Settings</h1>
            <p className="text-sm text-muted-foreground">
              Manage your profile information and authentication settings.
            </p>
          </div>
          <div className="flex items-start justify-start gap-2 md:justify-end">
            <Badge variant="outline">{onboardingState.companyName ?? "No workspace"}</Badge>
            <Badge variant="outline">{planBadgeLabel}</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <Card className="border-border/60">
          <CardHeader>
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-muted-foreground" />
              <CardTitle>Profile</CardTitle>
            </div>
            <CardDescription>Your identity and contact metadata for the workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSaveProfile}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={userEmail} disabled />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First name</Label>
                  <Input id="firstName" value={firstName} onChange={(event) => setFirstName(event.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last name</Label>
                  <Input id="lastName" value={lastName} onChange={(event) => setLastName(event.target.value)} required />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="jobTitle">Job title</Label>
                  <Input id="jobTitle" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1..." />
                </div>
              </div>
              <Button type="submit" disabled={savingProfile}>
                {savingProfile ? "Saving..." : "Save Profile"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <CardTitle>Security</CardTitle>
            </div>
            <CardDescription>
              {isRecoveryFlow
                ? "Recovery mode active. Set a new password to restore account access."
                : "Confirm your current password, then set a new password."}
            </CardDescription>
          </CardHeader>
          <CardContent>
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
              <Button type="submit" disabled={savingPassword}>
                {savingPassword ? "Updating..." : "Update Password"}
              </Button>
            </form>
            {!isRecoveryFlow && (
              <div className="mt-4 border-t border-border/50 pt-4">
                <p className="text-xs text-muted-foreground">
                  Don&apos;t remember your current password or never set one from invite onboarding?
                </p>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto px-0 py-1 text-xs"
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
  );
}
