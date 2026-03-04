import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Loader2, MailCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type AcceptStatus = "processing" | "setup_password" | "error";

function parseAuthParams() {
  const hashParams = new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash);
  const searchParams = new URLSearchParams(window.location.search);
  const keys = ["access_token", "refresh_token", "token", "token_hash", "code", "type"];

  const hasAuthParams = keys.some((key) => hashParams.has(key) || searchParams.has(key));
  const flowType = hashParams.get("type") ?? searchParams.get("type");

  return { hasAuthParams, flowType };
}

export default function AcceptInvite() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [{ hasAuthParams, flowType }] = useState(() => parseAuthParams());
  const [status, setStatus] = useState<AcceptStatus>("processing");
  const [detail, setDetail] = useState("Verifying your invite and creating a secure session.");
  const [inviteEmail, setInviteEmail] = useState("");
  const [sendingSetupLink, setSendingSetupLink] = useState(false);
  const passwordResetRedirectTo = useMemo(() => `${window.location.origin}/settings?password_reset=1`, []);

  const flowLabel = useMemo(() => {
    if (!flowType) return "Invitation";
    return flowType.charAt(0).toUpperCase() + flowType.slice(1);
  }, [flowType]);

  useEffect(() => {
    let cancelled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (session) {
        navigate("/onboarding", { replace: true });
      }
    });

    const resolveInviteSession = async () => {
      if (!hasAuthParams) {
        const { data, error } = await supabase.auth.getSession();
        if (cancelled) return;

        if (error) {
          setStatus("error");
          setDetail(error.message);
          return;
        }

        if (data.session) {
          navigate("/onboarding", { replace: true });
          return;
        }

        setStatus("setup_password");
        setDetail(
          "This invite link did not include a sign-in token. Enter the invited email and we will send a secure password setup link."
        );
        return;
      }

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const { data, error } = await supabase.auth.getSession();
        if (cancelled) return;

        if (error) {
          setStatus("error");
          setDetail(error.message);
          return;
        }

        if (data.session) {
          navigate("/onboarding", { replace: true });
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      if (cancelled) return;
      setStatus("setup_password");
      setDetail("Invite token is invalid or expired. Enter the invited email to receive a fresh password setup link.");
    };

    void resolveInviteSession();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [hasAuthParams, navigate]);

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
      description: "Check your inbox, set your password, then sign in to continue onboarding.",
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
            ) : (
              <MailCheck className="h-5 w-5 text-primary" />
            )}
          </div>
          <CardTitle>
            {status === "processing" ? "Accepting Invite" : status === "error" ? "Invite Error" : "Set Your Password"}
          </CardTitle>
          <CardDescription>{flowLabel} flow</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">{detail}</p>

          {status === "setup_password" && (
            <form onSubmit={handleSendSetupLink} className="space-y-3 text-left">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Invited email</Label>
                <Input
                  id="invite-email"
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
            <div className="flex items-center justify-center gap-2">
              <Button variant={status === "setup_password" ? "ghost" : "default"} onClick={() => navigate("/", { replace: true })}>
                Go To Sign In
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
