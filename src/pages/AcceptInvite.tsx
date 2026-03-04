import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { AlertCircle, Loader2, MailCheck, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type AcceptStatus = "processing" | "set_password" | "recovery" | "error";

type InviteUrlState = {
  accessToken: string | null;
  refreshToken: string | null;
  code: string | null;
  verifyToken: string | null;
  flowType: string | null;
  authError: string | null;
  authErrorDescription: string | null;
  invitedEmailHint: string | null;
  hasAuthParams: boolean;
};

function parseInviteUrlState(): InviteUrlState {
  const hashParams = new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash);
  const searchParams = new URLSearchParams(window.location.search);
  const read = (key: string) => hashParams.get(key) ?? searchParams.get(key);

  const accessToken = read("access_token");
  const refreshToken = read("refresh_token");
  const code = read("code");
  const verifyToken = read("token") ?? read("token_hash");
  const flowType = read("type");
  const authError = read("error");
  const authErrorDescription = read("error_description");
  const invitedEmailHint = read("email");

  const hasAuthParams = Boolean(
    accessToken ||
      refreshToken ||
      code ||
      verifyToken ||
      flowType ||
      authError ||
      authErrorDescription,
  );

  return {
    accessToken,
    refreshToken,
    code,
    verifyToken,
    flowType,
    authError,
    authErrorDescription,
    invitedEmailHint,
    hasAuthParams,
  };
}

function humanizeFlowType(flowType: string | null): string {
  if (!flowType) return "Invitation";
  return flowType.charAt(0).toUpperCase() + flowType.slice(1);
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
  const [status, setStatus] = useState<AcceptStatus>("processing");
  const [detail, setDetail] = useState("Verifying your invite and creating a secure session.");

  const [inviteEmail, setInviteEmail] = useState(urlState.invitedEmailHint ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [sendingSetupLink, setSendingSetupLink] = useState(false);

  const flowLabel = useMemo(() => humanizeFlowType(urlState.flowType), [urlState.flowType]);
  const passwordResetRedirectTo = useMemo(() => `${window.location.origin}/settings?password_reset=1`, []);
  const inviteFlow = urlState.flowType === "invite";

  useEffect(() => {
    let cancelled = false;
    let redirectedToVerify = false;

    const handleSessionReady = async (session: Session) => {
      if (cancelled) return;
      const email = session.user.email ?? "";
      if (email) {
        setInviteEmail(email);
      }

      if (inviteFlow) {
        setStatus("set_password");
        setDetail("Invite confirmed. Set your password to activate this account.");
        return;
      }

      setStatus("processing");
      setDetail("Invite confirmed. Redirecting...");
      navigate("/onboarding", { replace: true });
    };

    const failToRecovery = (message: string) => {
      if (cancelled) return;
      setStatus("recovery");
      setDetail(message);
    };

    const failWithError = (message: string) => {
      if (cancelled) return;
      setStatus("error");
      setDetail(message);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled || redirectedToVerify) return;
      if (session) {
        void handleSessionReady(session);
      }
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

      if (urlState.verifyToken && urlState.flowType && !urlState.accessToken && !urlState.refreshToken && !urlState.code) {
        redirectedToVerify = true;
        const verifyUrl = new URL("/auth/v1/verify", import.meta.env.VITE_SUPABASE_URL);
        verifyUrl.searchParams.set("token", urlState.verifyToken);
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
        for (let attempt = 0; attempt < 25; attempt += 1) {
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
        failToRecovery(`${decodedAuthError} Enter your invited email to receive a password setup link.`);
        return;
      }

      failToRecovery(
        "Invite verification did not complete. Enter your invited email to receive a password setup link."
      );
    };

    void resolveInvite();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [inviteFlow, navigate, urlState]);

  const handleSetPassword = async (event: FormEvent) => {
    event.preventDefault();

    if (newPassword.length < 8) {
      toast({
        title: "Password too short",
        description: "Use at least 8 characters.",
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
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);

    if (error) {
      setStatus("error");
      setDetail(error.message);
      return;
    }

    toast({
      title: "Password set",
      description: "Account secured. Redirecting to onboarding.",
    });
    navigate("/onboarding", { replace: true });
  };

  const handleSendSetupLink = async (event: FormEvent) => {
    event.preventDefault();

    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      toast({
        title: "Email required",
        description: "Enter the invited email address.",
        variant: "destructive",
      });
      return;
    }

    setSendingSetupLink(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: passwordResetRedirectTo,
    });
    setSendingSetupLink(false);

    if (error) {
      setStatus("error");
      setDetail(error.message);
      return;
    }

    toast({
      title: "Password setup link sent",
      description: "Check your inbox and complete password setup.",
    });
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 flex items-center justify-center">
      <Card className="w-full max-w-md border border-border/50">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-border/60">
            {status === "processing" ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : status === "error" ? (
              <AlertCircle className="h-5 w-5 text-destructive" />
            ) : status === "set_password" ? (
              <ShieldCheck className="h-5 w-5 text-primary" />
            ) : (
              <MailCheck className="h-5 w-5 text-primary" />
            )}
          </div>
          <CardTitle>
            {status === "processing"
              ? "Accepting Invite"
              : status === "set_password"
                ? "Set Your Password"
                : status === "recovery"
                  ? "Recover Invite Access"
                  : "Invite Error"}
          </CardTitle>
          <CardDescription>{flowLabel} flow</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">{detail}</p>

          {status === "set_password" && (
            <form onSubmit={handleSetPassword} className="space-y-3 text-left">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Invited email</Label>
                <Input id="invite-email" type="email" value={inviteEmail} disabled />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="At least 8 characters"
                  minLength={8}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Repeat new password"
                  minLength={8}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={savingPassword}>
                {savingPassword ? "Saving..." : "Set Password And Continue"}
              </Button>
            </form>
          )}

          {status === "recovery" && (
            <form onSubmit={handleSendSetupLink} className="space-y-3 text-left">
              <div className="space-y-2">
                <Label htmlFor="recovery-email">Invited email</Label>
                <Input
                  id="recovery-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="you@company.com"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={sendingSetupLink}>
                {sendingSetupLink ? "Sending..." : "Send Password Setup Link"}
              </Button>
            </form>
          )}

          {status !== "processing" && (
            <div className="flex items-center justify-center">
              <Button variant={status === "error" ? "default" : "ghost"} onClick={() => navigate("/", { replace: true })}>
                Go To Sign In
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
