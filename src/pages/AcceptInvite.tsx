import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Loader2, MailCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

type AcceptStatus = "processing" | "invalid" | "error";

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
  const [{ hasAuthParams, flowType }] = useState(() => parseAuthParams());
  const [status, setStatus] = useState<AcceptStatus>("processing");
  const [detail, setDetail] = useState("Verifying your invite and creating a secure session.");

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

        setStatus("invalid");
        setDetail("Invite link is missing required authentication parameters.");
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
      setStatus("invalid");
      setDetail("Invite link is invalid, expired, or already used. Ask your workspace admin to resend it.");
    };

    void resolveInviteSession();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [hasAuthParams, navigate]);

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
            {status === "processing" ? "Accepting Invite" : status === "error" ? "Invite Error" : "Invite Not Available"}
          </CardTitle>
          <CardDescription>{flowLabel} flow</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">{detail}</p>

          {status !== "processing" && (
            <div className="flex items-center justify-center gap-2">
              <Button onClick={() => navigate("/", { replace: true })}>Go To Sign In</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
