import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [requestName, setRequestName] = useState("");
  const [requestEmail, setRequestEmail] = useState("");
  const [requestCompany, setRequestCompany] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [activeAction, setActiveAction] = useState<"password" | "request" | null>(null);
  const { toast } = useToast();

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

  const handleAccessRequest = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!requestName.trim() || !requestEmail.trim()) {
      toast({
        title: "Missing details",
        description: "Please provide your full name and email.",
        variant: "destructive",
      });
      return;
    }

    setActiveAction("request");

    const { error } = await supabase.functions.invoke("request-access", {
      body: {
        fullName: requestName.trim(),
        email: requestEmail.trim(),
        companyName: requestCompany.trim() || null,
        message: requestMessage.trim() || null,
        website: honeypot,
      },
    });

    if (error) {
      toast({
        title: "Request failed",
        description: error.message || "Unable to submit request right now.",
        variant: "destructive",
      });
      setActiveAction(null);
      return;
    }

    toast({
      title: "Request submitted",
      description: "Thanks. We received your access request and will get back to you.",
    });

    setRequestName("");
    setRequestEmail("");
    setRequestCompany("");
    setRequestMessage("");
    setHoneypot("");
    setRequestDialogOpen(false);
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
              <h1 className="type-display-section text-4xl leading-none text-[hsl(var(--brand-accent))]">OrderSounds</h1>
              <p className="text-sm text-muted-foreground">
                Forensic royalty intelligence for statement normalization, issue resolution, and payout confidence.
              </p>
            </div>
          </div>

          <div className="space-y-2 border-t border-border/45 pt-5">
            <p className="type-micro text-xs text-muted-foreground">Need access?</p>
            <p className="text-sm">Share your details in the request form. Our team will review and follow up.</p>
          </div>
        </section>

        <section className="flex items-center justify-center bg-background p-4 md:p-8">
          <Card className="w-full max-w-md border-0 bg-transparent shadow-none">
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-sm border border-border bg-background p-1 md:hidden">
                <img src="/ordersounds-logo.png" alt="OrderSounds logo" className="h-full w-full object-contain" />
              </div>
              <CardTitle className="text-3xl">Workspace Access</CardTitle>
              <CardDescription>Sign in with your invited organization credentials.</CardDescription>
            </CardHeader>

            <CardContent className="space-y-5">
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
              </form>

              <div className="flex items-center justify-between border-t border-border/45 pt-4">
                <p className="text-xs text-muted-foreground">Need access for your team?</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRequestDialogOpen(true)}
                  disabled={activeAction !== null}
                >
                  Request Access
                </Button>
              </div>
            </CardContent>
          </Card>

          <Dialog open={requestDialogOpen} onOpenChange={setRequestDialogOpen}>
            <DialogContent className="w-[min(92vw,560px)] max-w-[560px]">
              <DialogHeader>
                <DialogTitle>Request Access</DialogTitle>
                <DialogDescription>
                  Share your details and we will review your request.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleAccessRequest} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="request-name">Full name</Label>
                  <Input
                    id="request-name"
                    value={requestName}
                    onChange={(event) => setRequestName(event.target.value)}
                    required
                    placeholder="Your full name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="request-email">Work email</Label>
                  <Input
                    id="request-email"
                    type="email"
                    value={requestEmail}
                    onChange={(event) => setRequestEmail(event.target.value)}
                    required
                    placeholder="you@company.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="request-company">Company name</Label>
                  <Input
                    id="request-company"
                    value={requestCompany}
                    onChange={(event) => setRequestCompany(event.target.value)}
                    placeholder="Company / Publisher"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="request-message">Message (optional)</Label>
                  <Textarea
                    id="request-message"
                    value={requestMessage}
                    onChange={(event) => setRequestMessage(event.target.value)}
                    placeholder="Tell us your use case."
                    className="min-h-[110px]"
                  />
                </div>

                <Input
                  value={honeypot}
                  onChange={(event) => setHoneypot(event.target.value)}
                  className="hidden"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                />

                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button type="button" variant="ghost" onClick={() => setRequestDialogOpen(false)} disabled={activeAction !== null}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="outline" disabled={activeAction !== null}>
                    {activeAction === "request" ? "Submitting request..." : "Send Request"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </section>
      </div>
    </div>
  );
}
