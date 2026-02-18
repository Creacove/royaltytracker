import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingEmailConfirmation, setPendingEmailConfirmation] = useState(false);
  const { toast } = useToast();

  const emailRedirectTo = useMemo(() => {
    return window.location.origin;
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          const msg = error.message || "Login failed";
          toast({ title: "Login failed", description: msg, variant: "destructive" });

          if (msg.toLowerCase().includes("confirm") || msg.toLowerCase().includes("not confirmed")) {
            setPendingEmailConfirmation(true);
          }
        } else {
          setPendingEmailConfirmation(false);
        }
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo },
        });

        if (error) {
          toast({ title: "Sign up failed", description: error.message, variant: "destructive" });
        } else {
          const needsEmailConfirm = !data.session;
          setPendingEmailConfirmation(needsEmailConfirm);

          toast({
            title: needsEmailConfirm ? "Check your email" : "Account created",
            description: needsEmailConfirm
              ? "We sent you a confirmation link. You must confirm before you can sign in."
              : "You're signed in.",
          });
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email) {
      toast({ title: "Missing email", description: "Enter your email first.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo },
      });

      if (error) {
        toast({ title: "Resend failed", description: error.message, variant: "destructive" });
        return;
      }

      toast({ title: "Email resent", description: "Check spam/junk if it doesn't arrive." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md !border-0 border-y border-border bg-transparent py-3">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 overflow-hidden border border-border bg-background p-1">
            <img src="/ordersounds-logo.png" alt="OrderSounds logo" className="h-full w-full object-contain" />
          </div>
          <CardTitle className="text-3xl">OrderSounds</CardTitle>
          <CardDescription>Forensic Royalty Platform</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="********"
                minLength={6}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Loading..." : isLogin ? "Sign In" : "Sign Up"}
            </Button>

            {pendingEmailConfirmation && (
              <Button type="button" variant="outline" className="w-full" disabled={loading} onClick={handleResend}>
                Resend confirmation email
              </Button>
            )}
          </form>
          <div className="mt-4 text-center text-sm text-muted-foreground">
            {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setPendingEmailConfirmation(false);
              }}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              {isLogin ? "Sign Up" : "Sign In"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
