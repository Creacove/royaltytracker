import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [activeAction, setActiveAction] = useState<"password" | "magic" | null>(null);
  const { toast } = useToast();

  const emailRedirectTo = useMemo(() => {
    return window.location.origin;
  }, []);

  const handlePasswordSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setActiveAction("password");

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      toast({
        title: "Sign in failed",
        description: error.message || "Unable to sign in.",
        variant: "destructive",
      });
      setActiveAction(null);
      return;
    }

    setActiveAction(null);
  };

  const handleMagicLink = async () => {
    if (!email.trim()) {
      toast({
        title: "Missing email",
        description: "Enter your invited work email first.",
        variant: "destructive",
      });
      return;
    }

    setActiveAction("magic");

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo,
        shouldCreateUser: false,
      },
    });

    if (error) {
      toast({
        title: "Secure link failed",
        description: error.message,
        variant: "destructive",
      });
      setActiveAction(null);
      return;
    }

    toast({
      title: "Secure link sent",
      description: "Check your inbox for a sign-in link.",
    });
    setActiveAction(null);
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1200px] overflow-hidden rounded-md border border-border/50 md:grid-cols-2">
        <section className="relative hidden border-r border-border/45 bg-[linear-gradient(140deg,hsl(var(--brand-accent-ghost))/70,transparent_60%)] p-8 md:flex md:flex-col md:justify-between">
          <div className="space-y-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-sm border border-border bg-background p-1">
              <img src="/ordersounds-logo.png" alt="OrderSounds logo" className="h-full w-full object-contain" />
            </div>
            <div className="space-y-2">
              <h1 className="font-display text-4xl leading-none tracking-[0.04em]">OrderSounds</h1>
              <p className="text-sm text-muted-foreground">
                Forensic royalty intelligence for statement normalization, issue resolution, and payout confidence.
              </p>
            </div>
          </div>

          <div className="space-y-2 border-t border-border/45 pt-5">
            <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Access model</p>
            <p className="text-sm">
              Invitation-only workspace. User access is controlled by partner invites, then finalized through first-login
              onboarding.
            </p>
          </div>
        </section>

        <section className="flex items-center justify-center bg-background p-4 md:p-8">
          <Card className="w-full max-w-md border-0 bg-transparent shadow-none">
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-sm border border-border bg-background p-1 md:hidden">
                <img src="/ordersounds-logo.png" alt="OrderSounds logo" className="h-full w-full object-contain" />
              </div>
              <CardTitle className="text-3xl">Workspace Access</CardTitle>
              <CardDescription>Use your invited organization email to continue.</CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handlePasswordSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Work email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    placeholder="you@publisher.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    placeholder="********"
                    minLength={6}
                  />
                </div>

                <Button type="submit" className="w-full" disabled={activeAction !== null}>
                  {activeAction === "password" ? "Signing in..." : "Sign In"}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={handleMagicLink}
                  disabled={activeAction !== null}
                >
                  {activeAction === "magic" ? "Sending link..." : "Email Me a Secure Sign-In Link"}
                </Button>
              </form>

              <p className="mt-4 text-center text-sm text-muted-foreground">
                No public sign-up is available. Request an invite from the OrderSounds team.
              </p>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
