import { useEffect, useMemo, useState, useRef, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Loader2,
  MailCheck,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

// ─── Step machine ────────────────────────────────────────────────────────────
//  processing      → verifying the token / establishing the session
//  set_password    → token ok, need to choose a password
//  complete_profile → password set, need to fill name/workspace details
//  recovery        → token expired/invalid; ask them to re-request an invite link
//  error           → unrecoverable error
type AcceptStep = "processing" | "set_password" | "complete_profile" | "recovery" | "error";

// ─── URL parsing ─────────────────────────────────────────────────────────────
type InviteUrlState = {
  accessToken: string | null;
  refreshToken: string | null;
  code: string | null;
  tokenHash: string | null;
  rawToken: string | null;
  flowType: string | null;
  authError: string | null;
  authErrorDescription: string | null;
  invitedEmailHint: string | null;
  hasAuthParams: boolean;
};

function parseInviteUrlState(): InviteUrlState {
  const hashParams = new URLSearchParams(
    window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash
  );
  const searchParams = new URLSearchParams(window.location.search);
  const read = (key: string) => hashParams.get(key) ?? searchParams.get(key);

  const accessToken = read("access_token");
  const refreshToken = read("refresh_token");
  const code = read("code");
  const tokenHash = read("token_hash");
  const rawToken = read("token");
  const flowType = read("type");
  const authError = read("error");
  const authErrorDescription = read("error_description");
  const invitedEmailHint = read("email");

  const hasAuthParams = Boolean(
    accessToken || refreshToken || code || tokenHash || rawToken || flowType || authError || authErrorDescription
  );

  return {
    accessToken,
    refreshToken,
    code,
    tokenHash,
    rawToken,
    flowType,
    authError,
    authErrorDescription,
    invitedEmailHint,
    hasAuthParams,
  };
}

function decodeAuthError(errorDescription: string | null): string | null {
  if (!errorDescription) return null;
  try {
    return decodeURIComponent(errorDescription.replaceAll("+", " "));
  } catch {
    return errorDescription;
  }
}

// ─── Statement volume options (same as Onboarding page) ──────────────────────
const statementVolumeOptions = [
  { value: "0-25", label: "0-25 / month" },
  { value: "26-100", label: "26-100 / month" },
  { value: "101-500", label: "101-500 / month" },
  { value: "500+", label: "500+ / month" },
];

// ─── Component ───────────────────────────────────────────────────────────────
export default function AcceptInvite() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [urlState] = useState<InviteUrlState>(() => parseInviteUrlState());

  // ── Step state ──────────────────────────────────────────────────────────
  const [step, setStepState] = useState<AcceptStep>("processing");
  const currentStepRef = useRef<AcceptStep>("processing");

  const setStep = (newStep: AcceptStep) => {
    currentStepRef.current = newStep;
    setStepState(newStep);
  };

  const [detail, setDetail] = useState("Verifying your invite and creating a secure session.");
  const [sessionRef, setSessionRef] = useState<Session | null>(null);

  // ── Step 2: Set password ─────────────────────────────────────────────────
  const [inviteEmail, setInviteEmail] = useState(urlState.invitedEmailHint ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  // ── Step 3: Complete profile ──────────────────────────────────────────────
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState("USD");
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  );
  const [monthlyStatementVolume, setMonthlyStatementVolume] = useState("");
  const [primaryCmoCount, setPrimaryCmoCount] = useState("");
  const [onboardingState, setOnboardingState] = useState<{
    companyId: string | null;
    companyLocked: boolean;
    canEditWorkspace: boolean;
    inviteRole: string | null;
  }>({ companyId: null, companyLocked: false, canEditWorkspace: true, inviteRole: null });
  const [submittingProfile, setSubmittingProfile] = useState(false);

  // ── Recovery ──────────────────────────────────────────────────────────────
  const [recoveryEmail, setRecoveryEmail] = useState(urlState.invitedEmailHint ?? "");
  const [sendingResend, setSendingResend] = useState(false);

  // ─── Token resolution effect ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let redirectedToVerify = false;

    const failToRecovery = (message: string) => {
      if (cancelled) return;
      setStep("recovery");
      setDetail(message);
    };

    const failWithError = (message: string) => {
      if (cancelled) return;
      setStep("error");
      setDetail(message);
    };

    const handleSessionReady = async (session: Session) => {
      if (cancelled) return;
      const email = session.user.email ?? "";
      if (email) {
        setInviteEmail(email);
        setRecoveryEmail(email);
      }

      // All invite flows require setting a password on first entry
      // (new user = no password set yet). Non-invite flows (e.g. existing
      // members clicking a magic link) are already onboarded — send them home.
      const flowType = urlState.flowType;
      const isInviteFlow = !flowType || flowType === "invite" || flowType === "email";

      setSessionRef(session);

      if (isInviteFlow) {
        // Load onboarding state to pre-fill profile and understand workspace context
        await loadOnboardingStateForProfile();

        // GUARD: Only move to set_password if we are currently in processing.
        // This prevents the auth state change (triggered by updateUser) from
        // resetting the wizard back to the password step after success.
        if (!cancelled && currentStepRef.current === "processing") {
          setStep("set_password");
        }
        return;
      }

      // Recovery (password reset from Settings page) — go to settings
      if (flowType === "recovery") {
        navigate("/settings?password_reset=1", { replace: true });
        return;
      }

      // Fallback: if already onboarded, just go home
      navigate("/", { replace: true });
    };

    const loadOnboardingStateForProfile = async () => {
      try {
        const { data } = await (supabase as any).rpc("get_my_onboarding_state");
        const state = Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
        if (!state) return;

        setFirstName(state.first_name ?? "");
        setLastName(state.last_name ?? "");
        setJobTitle(state.job_title ?? "");
        setPhone(state.phone ?? "");
        setCompanyName(state.company_name ?? "");
        setWebsite(state.website ?? "");
        setCountryCode(state.country_code ?? "");
        setDefaultCurrency(state.default_currency ?? "USD");
        setTimezone(state.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"));
        setMonthlyStatementVolume(state.monthly_statement_volume ?? "");
        setPrimaryCmoCount(state.primary_cmo_count == null ? "" : String(state.primary_cmo_count));

        const companyId = state.company_id ?? null;
        const inviteRole = state.pending_invitation_role ?? null;
        const activeMembershipRole = state.active_membership_role ?? null;
        const effectiveRole = activeMembershipRole ?? inviteRole;
        const canEdit = !companyId || effectiveRole === "owner" || effectiveRole === "admin";

        setOnboardingState({
          companyId,
          companyLocked: Boolean(companyId),
          canEditWorkspace: canEdit,
          inviteRole: inviteRole
            ? inviteRole.charAt(0).toUpperCase() + inviteRole.slice(1)
            : null,
        });
      } catch {
        // Non-fatal — profile fields will just be empty
      }
    };

    // Auth state change listener (handles PKCE code flows)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled || redirectedToVerify) return;
      if (session) void handleSessionReady(session);
    });

    const resolveInvite = async () => {
      // 1. Direct token pair (legacy hash flow)
      if (urlState.accessToken && urlState.refreshToken) {
        const { data, error } = await supabase.auth.setSession({
          access_token: urlState.accessToken,
          refresh_token: urlState.refreshToken,
        });
        if (error) { failWithError(error.message); return; }
        if (data.session) { await handleSessionReady(data.session); return; }
      }

      // 2. PKCE code
      if (urlState.code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(urlState.code);
        if (error) { failWithError(error.message); return; }
        if (data.session) { await handleSessionReady(data.session); return; }
      }

      // 3. OTP token_hash (email OTP / invite links with token_hash param)
      if (urlState.tokenHash && urlState.flowType && !urlState.accessToken && !urlState.refreshToken && !urlState.code) {
        const normalizedType = urlState.flowType.toLowerCase();
        const otpTypes =
          normalizedType === "invite"
            ? ["invite", "email"]
            : normalizedType === "email"
              ? ["email", "invite"]
              : [normalizedType];

        let lastOtpError: string | null = null;
        for (const otpType of otpTypes) {
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: urlState.tokenHash,
            type: otpType as any,
          });

          if (!error && data.session) {
            await handleSessionReady(data.session);
            return;
          }

          if (!error) continue;

          lastOtpError = error.message;
          const message = error.message.toLowerCase();
          const tokenIssue = message.includes("expired") || message.includes("invalid");
          if (!tokenIssue) {
            failWithError(error.message);
            return;
          }
        }

        if (lastOtpError) {
          failToRecovery("Invite link has expired or is no longer valid. Enter your email to receive a new invite link.");
          return;
        }
      }

      // 4. Raw token → redirect through Supabase verify endpoint
      if (urlState.rawToken && urlState.flowType && !urlState.accessToken && !urlState.refreshToken && !urlState.code) {
        redirectedToVerify = true;
        const verifyUrl = new URL("/auth/v1/verify", import.meta.env.VITE_SUPABASE_URL);
        verifyUrl.searchParams.set("token", urlState.rawToken);
        verifyUrl.searchParams.set("type", urlState.flowType);
        verifyUrl.searchParams.set("redirect_to", `${window.location.origin}/accept-invite`);
        window.location.replace(verifyUrl.toString());
        return;
      }

      // 5. Session may already exist (e.g. page reload after partial flow)
      const sessionResult = await supabase.auth.getSession();
      if (sessionResult.error) { failWithError(sessionResult.error.message); return; }
      if (sessionResult.data.session) { await handleSessionReady(sessionResult.data.session); return; }

      // 6. Poll for a session that might be set asynchronously (auth state change fires)
      if (urlState.hasAuthParams) {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const { data, error } = await supabase.auth.getSession();
          if (cancelled) return;
          if (error) { failWithError(error.message); return; }
          if (data.session) { await handleSessionReady(data.session); return; }
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }

      // 7. Auth error from the URL (e.g. expired token redirect from Supabase)
      const decodedAuthError = decodeAuthError(urlState.authErrorDescription);
      if (decodedAuthError) {
        failToRecovery(`${decodedAuthError} Enter your email to receive a new invite link.`);
        return;
      }

      failToRecovery("Invite verification did not complete. Enter your email to receive a new invite link.");
    };

    void resolveInvite();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Step 2: Set password ──────────────────────────────────────────────────
  const handleSetPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", description: "Both fields must match.", variant: "destructive" });
      return;
    }

    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);

    if (error) {
      setStep("error");
      setDetail(error.message);
      return;
    }

    toast({ title: "Password set", description: "Secure. Now let's finish your profile." });
    setStep("complete_profile");
  };

  // ─── Step 3: Complete profile ──────────────────────────────────────────────
  const handleCompleteProfile = async (event: FormEvent) => {
    event.preventDefault();

    if (!firstName.trim() || !lastName.trim() || !jobTitle.trim()) {
      toast({
        title: "Missing required fields",
        description: "First name, last name, and job title are required.",
        variant: "destructive",
      });
      return;
    }

    if (onboardingState.canEditWorkspace && !onboardingState.companyLocked && !companyName.trim()) {
      toast({
        title: "Workspace name required",
        description: "Enter a workspace name to finish setup.",
        variant: "destructive",
      });
      return;
    }

    const parsedCmoCount = primaryCmoCount.trim() === "" ? null : Number(primaryCmoCount);
    if (
      onboardingState.canEditWorkspace &&
      parsedCmoCount !== null &&
      (!Number.isInteger(parsedCmoCount) || parsedCmoCount < 0)
    ) {
      toast({
        title: "Invalid CMO count",
        description: "Must be a whole number ≥ 0.",
        variant: "destructive",
      });
      return;
    }

    setSubmittingProfile(true);
    const { error } = await (supabase as any).rpc("complete_partner_onboarding", {
      p_first_name: firstName.trim(),
      p_last_name: lastName.trim(),
      p_job_title: jobTitle.trim(),
      p_phone: phone.trim() || null,
      p_company_name: onboardingState.canEditWorkspace ? companyName.trim() || null : null,
      p_website: onboardingState.canEditWorkspace ? website.trim() || null : null,
      p_country_code: onboardingState.canEditWorkspace ? countryCode.trim() || null : null,
      p_default_currency: defaultCurrency.trim() || "USD",
      p_timezone: timezone.trim() || "UTC",
      p_monthly_statement_volume: onboardingState.canEditWorkspace ? monthlyStatementVolume || null : null,
      p_primary_cmo_count: onboardingState.canEditWorkspace ? parsedCmoCount : null,
    });
    setSubmittingProfile(false);

    if (error) {
      toast({ title: "Profile setup failed", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Welcome!", description: "Your workspace is ready." });
    navigate("/", { replace: true });
  };

  // ─── Recovery: resend invite link ─────────────────────────────────────────
  // Recovery sends a fresh auth link back to /accept-invite so users can
  // re-enter this wizard without being redirected into Settings.
  const handleResendInviteLink = async (event: FormEvent) => {
    event.preventDefault();
    const email = recoveryEmail.trim().toLowerCase();
    if (!email) {
      toast({ title: "Email required", description: "Enter your invited email address.", variant: "destructive" });
      return;
    }

    setSendingResend(true);

    // Attempt: use resetPasswordForEmail but redirect back to /accept-invite
    // so the user re-enters the same wizard flow (not /settings recovery).
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/accept-invite`,
    });
    setSendingResend(false);

    if (error) {
      setStep("error");
      setDetail(error.message);
      return;
    }

    toast({
      title: "Link sent",
      description: "Check your inbox for a new setup link. It will land back on this page.",
    });
  };

  // ─── Derived display values ────────────────────────────────────────────────
  const stepTitle = useMemo(() => {
    switch (step) {
      case "processing": return "Accepting Invite";
      case "set_password": return "Set Your Password";
      case "complete_profile": return "Complete Your Profile";
      case "recovery": return "Get a New Link";
      case "error": return "Something Went Wrong";
    }
  }, [step]);

  const stepIcon = useMemo(() => {
    switch (step) {
      case "processing": return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
      case "set_password": return <ShieldCheck className="h-5 w-5 text-primary" />;
      case "complete_profile": return <CheckCircle2 className="h-5 w-5 text-primary" />;
      case "recovery": return <MailCheck className="h-5 w-5 text-primary" />;
      case "error": return <AlertCircle className="h-5 w-5 text-destructive" />;
    }
  }, [step]);

  // ─── Step indicator (processing + set_password + complete_profile) ─────────
  const progressSteps = [
    { id: "set_password", label: "Set password" },
    { id: "complete_profile", label: "Your profile" },
  ];
  const activeProgressIdx =
    step === "set_password" ? 0 : step === "complete_profile" ? 1 : -1;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background p-4 md:p-6 flex items-center justify-center">
      <Card className="w-full max-w-lg border border-border/50">
        <CardHeader className="text-center pb-3">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-background">
            {stepIcon}
          </div>
          <CardTitle className="text-xl">{stepTitle}</CardTitle>
          {(step === "set_password" || step === "complete_profile") && (
            <CardDescription>
              {step === "set_password"
                ? `Setting up account for ${inviteEmail || "your email"}`
                : `Joining as${onboardingState.inviteRole ? ` ${onboardingState.inviteRole}` : ""} · ${companyName || "New workspace"}`}
            </CardDescription>
          )}

          {/* Step progress indicator */}
          {activeProgressIdx >= 0 && (
            <div className="mt-3 flex items-center justify-center gap-2">
              {progressSteps.map((s, idx) => (
                <div key={s.id} className="flex items-center gap-2">
                  <div className="flex flex-col items-center gap-0.5">
                    <div
                      className={`h-1.5 w-12 rounded-full transition-colors ${idx <= activeProgressIdx
                        ? "bg-primary"
                        : "bg-border"
                        }`}
                    />
                    <span className="text-[10px] text-muted-foreground">{s.label}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          {/* ── PROCESSING ── */}
          {step === "processing" && (
            <p className="text-center text-sm text-muted-foreground">{detail}</p>
          )}

          {/* ── SET PASSWORD ── */}
          {step === "set_password" && (
            <form onSubmit={handleSetPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input id="invite-email" type="email" value={inviteEmail} disabled />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  minLength={8}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat password"
                  minLength={8}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={savingPassword}>
                {savingPassword ? "Securing account..." : "Set Password & Continue →"}
              </Button>
            </form>
          )}

          {/* ── COMPLETE PROFILE ── */}
          {step === "complete_profile" && (
            <form onSubmit={handleCompleteProfile} className="space-y-5">
              {/* User profile */}
              <div className="space-y-3">
                <div className="flex items-center gap-1.5">
                  <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    Your profile
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="firstName">First name *</Label>
                    <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lastName">Last name *</Label>
                    <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="jobTitle">Job title *</Label>
                    <Input id="jobTitle" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1..." />
                  </div>
                </div>
              </div>

              {/* Workspace section */}
              {onboardingState.canEditWorkspace ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      Publisher workspace
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="companyName">Workspace name *</Label>
                    <Input
                      id="companyName"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      required={!onboardingState.companyLocked}
                      disabled={onboardingState.companyLocked}
                    />
                    {onboardingState.companyLocked && (
                      <p className="text-xs text-muted-foreground">
                        Set by your administrator — not editable here.
                      </p>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="website">Website</Label>
                      <Input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="countryCode">Country (ISO)</Label>
                      <Input
                        id="countryCode"
                        value={countryCode}
                        onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
                        placeholder="US"
                        maxLength={3}
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="defaultCurrency">Default currency</Label>
                      <Input
                        id="defaultCurrency"
                        value={defaultCurrency}
                        onChange={(e) => setDefaultCurrency(e.target.value.toUpperCase())}
                        placeholder="USD"
                        maxLength={3}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="timezone">Timezone</Label>
                      <Input
                        id="timezone"
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                        placeholder="UTC"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Monthly statement volume</Label>
                    <div className="grid gap-2 grid-cols-2">
                      {statementVolumeOptions.map((opt) => (
                        <Button
                          key={opt.value}
                          type="button"
                          variant={monthlyStatementVolume === opt.value ? "default" : "outline"}
                          className="justify-start text-xs h-8"
                          onClick={() => setMonthlyStatementVolume(opt.value)}
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="primaryCmoCount">Primary CMO relationships</Label>
                    <Input
                      id="primaryCmoCount"
                      type="number"
                      min={0}
                      value={primaryCmoCount}
                      onChange={(e) => setPrimaryCmoCount(e.target.value)}
                      placeholder="e.g. 6"
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-border/40 bg-muted/20 p-4 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      Workspace access
                    </p>
                  </div>
                  <p className="text-sm">
                    You are joining{" "}
                    <span className="font-medium">{companyName || "your workspace"}</span>
                    {onboardingState.inviteRole ? (
                      <> as <span className="font-medium">{onboardingState.inviteRole}</span></>
                    ) : null}.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Workspace settings are managed by owners/admins.
                  </p>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={submittingProfile}>
                {submittingProfile ? "Finalizing..." : "Enter Workspace →"}
              </Button>
            </form>
          )}

          {/* ── RECOVERY ── */}
          {step === "recovery" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">{detail}</p>
              <form onSubmit={handleResendInviteLink} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="recovery-email">Your invited email</Label>
                  <Input
                    id="recovery-email"
                    type="email"
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={sendingResend}>
                  {sendingResend ? "Sending..." : "Send New Invite Link"}
                </Button>
              </form>
            </div>
          )}

          {/* ── ERROR ── */}
          {step === "error" && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">{detail}</p>
              <Button variant="default" className="w-full" onClick={() => navigate("/", { replace: true })}>
                Go to Sign In
              </Button>
            </div>
          )}

          {/* Go to sign-in escape hatch (recovery step) */}
          {step === "recovery" && (
            <div className="text-center pt-1">
              <Button variant="ghost" size="sm" onClick={() => navigate("/", { replace: true })}>
                Back to Sign In
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
