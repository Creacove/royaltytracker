import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { AlertCircle, CheckCircle2, Loader2, MailCheck, ShieldCheck } from "lucide-react";

import { EntryShell } from "@/components/layout/EntryShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type AcceptStep = "processing" | "set_password" | "recovery" | "error";

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
    window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash,
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
    hasAuthParams: Boolean(
      accessToken || refreshToken || code || tokenHash || rawToken || flowType || authError || authErrorDescription,
    ),
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

export default function AcceptInvite() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [urlState] = useState<InviteUrlState>(() => parseInviteUrlState());

  const [step, setStepState] = useState<AcceptStep>("processing");
  const currentStepRef = useRef<AcceptStep>("processing");
  const setStep = (nextStep: AcceptStep) => {
    currentStepRef.current = nextStep;
    setStepState(nextStep);
  };

  const [detail, setDetail] = useState("Verifying your invite and creating a secure session.");
  const [inviteEmail, setInviteEmail] = useState(urlState.invitedEmailHint ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState(urlState.invitedEmailHint ?? "");
  const [sendingResend, setSendingResend] = useState(false);

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

      const flowType = urlState.flowType;
      const isInviteFlow = !flowType || flowType === "invite" || flowType === "email";

      if (isInviteFlow) {
        if (!cancelled && currentStepRef.current === "processing") {
          setStep("set_password");
        }
        return;
      }

      if (flowType === "recovery") {
        navigate("/settings?password_reset=1", { replace: true });
        return;
      }

      navigate("/", { replace: true });
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled || redirectedToVerify) return;
      if (session) void handleSessionReady(session);
    });

    const resolveInvite = async () => {
      if (urlState.accessToken && urlState.refreshToken) {
        const { data, error } = await supabase.auth.setSession({
          access_token: urlState.accessToken,
          refresh_token: urlState.refreshToken,
        });
        if (error) {
          failWithError(error.message);
          return;
        }
        if (data.session) {
          await handleSessionReady(data.session);
          return;
        }
      }

      if (urlState.code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(urlState.code);
        if (error) {
          failWithError(error.message);
          return;
        }
        if (data.session) {
          await handleSessionReady(data.session);
          return;
        }
      }

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

      if (urlState.rawToken && urlState.flowType && !urlState.accessToken && !urlState.refreshToken && !urlState.code) {
        redirectedToVerify = true;
        const verifyUrl = new URL("/auth/v1/verify", import.meta.env.VITE_SUPABASE_URL);
        verifyUrl.searchParams.set("token", urlState.rawToken);
        verifyUrl.searchParams.set("type", urlState.flowType);
        verifyUrl.searchParams.set("redirect_to", `${window.location.origin}/accept-invite`);
        window.location.replace(verifyUrl.toString());
        return;
      }

      const sessionResult = await supabase.auth.getSession();
      if (sessionResult.error) {
        failWithError(sessionResult.error.message);
        return;
      }
      if (sessionResult.data.session) {
        await handleSessionReady(sessionResult.data.session);
        return;
      }

      if (urlState.hasAuthParams) {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const { data, error } = await supabase.auth.getSession();
          if (cancelled) return;
          if (error) {
            failWithError(error.message);
            return;
          }
          if (data.session) {
            await handleSessionReady(data.session);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }

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
    navigate("/", { replace: true });
  };

  const handleResendInviteLink = async (event: FormEvent) => {
    event.preventDefault();
    const email = recoveryEmail.trim().toLowerCase();

    if (!email) {
      toast({ title: "Email required", description: "Enter your invited email address.", variant: "destructive" });
      return;
    }

    setSendingResend(true);
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

  const stepTitle = useMemo(() => {
    switch (step) {
      case "processing":
        return "Verifying invite";
      case "set_password":
        return "Create your password";
      case "recovery":
        return "Request a new link";
      case "error":
        return "Invite unavailable";
    }
  }, [step]);

  const stepDescription = useMemo(() => {
    switch (step) {
      case "processing":
        return "We are confirming the secure invite token and preparing the workspace session.";
      case "set_password":
        return `This secures access for ${inviteEmail || "your invited email"} before you enter the workspace.`;
      case "recovery":
        return "The previous link can no longer be used. Send a fresh invite to the same email.";
      case "error":
        return "We could not complete the invite flow from this link. You can return to sign in and try again.";
    }
  }, [step, inviteEmail]);

  const shellTitle = useMemo(() => {
    switch (step) {
      case "processing":
        return "Secure workspace entry is being prepared.";
      case "set_password":
        return "Finish the first secure step.";
      case "recovery":
        return "Expired link. Clean recovery.";
      case "error":
        return "The invite did not complete cleanly.";
    }
  }, [step]);

  const shellDescription = useMemo(() => {
    switch (step) {
      case "processing":
        return "OrderSounds verifies every invite before the reporting workspace opens, so access stays explicit and traceable.";
      case "set_password":
        return "A one-time password step locks the account to the invited identity before the user enters the reporting workspace.";
      case "recovery":
        return "Recovery should be simple. Re-issue the link and return the user to the same secure setup flow.";
      case "error":
        return "If the link cannot be trusted or completed, the safest outcome is to stop here and restart from a clean sign-in path.";
    }
  }, [step]);

  const stepIcon = useMemo(() => {
    switch (step) {
      case "processing":
        return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
      case "set_password":
        return <ShieldCheck className="h-5 w-5 text-primary" />;
      case "recovery":
        return <MailCheck className="h-5 w-5 text-primary" />;
      case "error":
        return <AlertCircle className="h-5 w-5 text-destructive" />;
    }
  }, [step]);

  return (
    <EntryShell
      eyebrow="Invitation flow"
      title={shellTitle}
      description={shellDescription}
      badge={step === "set_password" ? "Invite confirmed" : step === "processing" ? "Verifying" : "Secure recovery"}
      points={[
        {
          icon: <ShieldCheck className="h-4 w-4" />,
          title: "Identity first",
          description: "The invited email is confirmed before a password or reporting session is accepted.",
        },
        {
          icon: <CheckCircle2 className="h-4 w-4" />,
          title: "Clean handoff",
          description: "Once the password is set, the user moves directly into the Desk without another setup loop.",
        },
      ]}
    >
      <Card surface="hero" className="w-full">
        <CardHeader className="space-y-3 border-b border-[hsl(var(--border)/0.1)]">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.78)]">
              {stepIcon}
            </div>
            <div className="space-y-1">
              <Badge
                variant="outline"
                className="w-fit border-[hsl(var(--brand-accent)/0.14)] bg-[hsl(var(--brand-accent-ghost)/0.62)] text-[hsl(var(--brand-accent))]"
              >
                {step === "set_password"
                  ? "Secure setup"
                  : step === "processing"
                    ? "Validating invite"
                    : step === "recovery"
                      ? "Recovery"
                      : "Blocked"}
              </Badge>
              <CardTitle className="text-[1.85rem]">{stepTitle}</CardTitle>
            </div>
          </div>
          <CardDescription>{stepDescription}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 pt-6">
          {step === "processing" && (
            <div className="space-y-4 rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.74)] p-5 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-elevated)/0.88)]">
                <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--brand-accent))]" />
              </div>
              <p className="text-sm leading-6 text-muted-foreground">{detail}</p>
            </div>
          )}

          {step === "set_password" && (
            <form onSubmit={handleSetPassword} className="space-y-4">
              <div className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.74)] p-4">
                <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Invited email</p>
                <p className="mt-2 text-sm font-semibold text-foreground">{inviteEmail || "your email"}</p>
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
                {savingPassword ? "Securing account..." : "Set password and continue"}
              </Button>
            </form>
          )}

          {step === "recovery" && (
            <div className="space-y-4">
              <div className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.74)] p-4 text-sm leading-6 text-muted-foreground">
                {detail}
              </div>

              <form onSubmit={handleResendInviteLink} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="recovery-email">Invited email</Label>
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
                  {sendingResend ? "Sending..." : "Send new invite link"}
                </Button>
              </form>

              <Button variant="ghost" className="w-full" onClick={() => navigate("/", { replace: true })}>
                Back to sign in
              </Button>
            </div>
          )}

          {step === "error" && (
            <div className="space-y-4">
              <div className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--tone-critical)/0.18)] bg-[hsl(var(--tone-critical)/0.08)] p-4 text-sm leading-6 text-foreground/82">
                {detail}
              </div>

              <Button className="w-full" onClick={() => navigate("/", { replace: true })}>
                Go to sign in
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </EntryShell>
  );
}
