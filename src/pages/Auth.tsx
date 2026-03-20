import { useState } from "react";

import { EntryShell } from "@/components/layout/EntryShell";
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
import { ArrowRight, AudioWaveform, Bot, ShieldCheck } from "lucide-react";

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
    <EntryShell
      title="Bring music reporting into one decision workspace."
      description="Sign in to work across statements, PRO reports, royalty reports, and other music reporting in one workspace for normalization, analysis, and faster decisions."
      points={[
        {
          icon: <AudioWaveform className="h-4 w-4" />,
          title: "Normalize what comes in",
          description: "Bring statements, PRO reports, royalty reports, and other music reporting into one shared operating view.",
        },
        {
          icon: <Bot className="h-4 w-4" />,
          title: "Ask questions from the reporting",
          description: "Use AI analysis that stays grounded in the uploaded reporting and the evidence behind it.",
        },
        {
          icon: <ShieldCheck className="h-4 w-4" />,
          title: "Keep access controlled",
          description: "Every workspace stays restricted to approved operators, owners, and decision-makers.",
        },
      ]}
    >
      <Card surface="hero" className="w-full">
        <CardHeader className="space-y-3 border-b border-[hsl(var(--border)/0.1)]">
          <div className="space-y-2">
            <CardTitle className="text-[1.9rem]">Sign in</CardTitle>
            <CardDescription>Use the work email and password attached to your invited workspace.</CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-6">
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
                placeholder="Enter your password"
                minLength={6}
              />
            </div>

            <Button type="submit" className="w-full" disabled={activeAction !== null}>
              {activeAction === "password" ? "Signing in..." : "Enter workspace"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>

          <div className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.74)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">Need access for your team?</p>
                <p className="text-sm text-muted-foreground">Request access and we&apos;ll set your team up in the right Desk workspace.</p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRequestDialogOpen(true)}
                disabled={activeAction !== null}
              >
                Request access
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={requestDialogOpen} onOpenChange={setRequestDialogOpen}>
        <DialogContent className="w-[min(92vw,580px)] max-w-[580px] surface-hero">
          <DialogHeader>
            <DialogTitle className="text-[1.6rem]">Request access</DialogTitle>
            <DialogDescription>
              Share the essentials. We will review the workspace request and reply with the right path.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAccessRequest} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
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
              <Label htmlFor="request-message">Message</Label>
              <Textarea
                id="request-message"
                value={requestMessage}
                onChange={(event) => setRequestMessage(event.target.value)}
                placeholder="Tell us who needs access and what workspace you want to operate."
                className="min-h-[120px]"
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

            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setRequestDialogOpen(false)} disabled={activeAction !== null}>
                Cancel
              </Button>
              <Button type="submit" variant="outline" disabled={activeAction !== null}>
                {activeAction === "request" ? "Submitting..." : "Send request"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </EntryShell>
  );
}
