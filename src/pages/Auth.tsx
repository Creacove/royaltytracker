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
import { Sparkles, Bot, RadioTower, AudioWaveform, ArrowRight } from "lucide-react";
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
    <div className="min-h-screen bg-background p-4 md:p-6 xl:p-8 flex items-center justify-center">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1440px] overflow-hidden rounded-xl border border-border/50 grid-cols-1 lg:grid-cols-[1.5fr_1fr] xl:grid-cols-[1.6fr_1fr]">
        <section className="relative flex w-full flex-col overflow-hidden lg:border-r border-border/45 bg-background p-6 md:p-10 xl:p-14 col-start-1 row-start-1">
          {/* Base paper grain texture */}
          <div className="absolute inset-0 z-0 opacity-[0.03] [background-image:radial-gradient(hsl(var(--primary))_1px,transparent_1px)] [background-size:16px_16px] [mask-image:linear-gradient(to_bottom,white,transparent)]" />

          {/* Premium "Red Antler" Ambient Brand Glows 
              These sit deep behind the UI, creating a sense of physical space and brand immersion without distracting from the content. */}
          <div className="absolute -left-40 -top-40 z-0 h-[1000px] w-[1000px] rounded-full bg-brand-accent/[0.04] blur-[140px]" />
          <div className="absolute bottom-[-10%] right-[0%] z-0 h-[800px] w-[800px] rounded-full bg-brand-accent/[0.03] blur-[120px]" />

          {/* Header Section (Hidden on mobile to focus purely on the graphic as a background) */}
          <div className="relative z-10 space-y-8 hidden lg:block">
            <img src="/ordersounds-logo.png" alt="OrderSounds" className="h-8 w-auto object-contain" />

            <div className="space-y-4">
              <h1 className="type-display-hero text-5xl leading-[0.9] tracking-tighter text-primary">
                DECISION <span className="text-[hsl(var(--brand-accent))]">ASSISTANT</span>
              </h1>
              <p className="max-w-[380px] text-sm leading-relaxed text-muted-foreground">
                Turn chaotic royalty statements into auditable truth. Surface missing revenue and make <strong>confident payout decisions</strong> with AI-powered forensic intelligence.
              </p>
            </div>
          </div>

          {/* High-Fidelity Dashboard Mockup Container */}
          <div className="absolute top-12 left-4 lg:relative lg:top-auto lg:left-auto lg:mt-12 lg:flex-1 w-[180%] sm:w-[140%] lg:w-full 2xl:w-[110%] animate-in fade-in slide-in-from-bottom-8 duration-1000 origin-top-left scale-75 md:scale-90 lg:scale-100 z-0 lg:z-10 opacity-60 lg:opacity-100 pointer-events-none lg:pointer-events-auto">
            {/* Adding glassmorphism here allows the faint purple background to subtly bleed through the dashboard itself */}
            <div className="absolute inset-x-0 bottom-0 top-0 flex flex-col overflow-hidden rounded-t-xl border-l border-t border-r border-border/60 bg-card/85 backdrop-blur-2xl shadow-[0_32px_64px_-12px_rgba(0,0,0,0.08)]">

              {/* Mockup Window Header */}
              <div className="flex h-10 items-center justify-between border-b border-border/40 bg-muted/40 px-4 backdrop-blur-md">
                <div className="flex gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-border/80" />
                  <div className="h-2 w-2 rounded-full bg-border/80" />
                  <div className="h-2 w-2 rounded-full bg-border/80" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3.5 w-24 rounded bg-border/20" />
                </div>
              </div>

              {/* Mockup Body */}
              <div className="flex flex-1 gap-5 p-5 bg-background/40 backdrop-blur-sm">

                {/* Left Side: Main Data Area */}
                <div className="flex flex-1 flex-col gap-5 min-w-0">
                  {/* Faux KPI Strip */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-sm border border-border/40 bg-background px-3 py-2.5 shadow-sm min-w-0">
                      <p className="type-micro text-[9px] uppercase tracking-widest text-muted-foreground truncate">Net Revenue</p>
                      <p className="type-display-section mt-1 text-lg text-primary truncate">€1,420,850</p>
                    </div>
                    <div className="rounded-sm border border-brand-accent/20 bg-[hsl(var(--brand-accent-ghost))]/50 px-3 py-2.5 shadow-sm min-w-0">
                      <p className="type-micro flex items-center gap-1 text-[9px] uppercase tracking-widest text-brand-accent truncate">
                        <Sparkles className="h-2.5 w-2.5 flex-shrink-0" /> Identified Gap
                      </p>
                      <p className="type-display-section mt-1 text-lg text-brand-accent truncate">+€45k</p>
                    </div>
                    <div className="rounded-sm border border-border/40 bg-background px-3 py-2.5 shadow-sm min-w-0">
                      <p className="type-micro text-[9px] uppercase tracking-widest text-muted-foreground truncate">Accuracy</p>
                      <p className="type-display-section mt-1 text-lg text-primary truncate">99.8%</p>
                    </div>
                  </div>

                  {/* Faux Chart Area */}
                  <div className="flex flex-1 flex-col rounded-sm border border-border/40 bg-background/80 p-4 shadow-sm backdrop-blur-sm">
                    <div className="mb-4 flex items-center justify-between">
                      <p className="type-mono text-[10px] uppercase tracking-widest text-primary">Territory Mix</p>
                      <div className="h-4 w-20 rounded bg-muted/40" />
                    </div>

                    {/* The Bars */}
                    <div className="flex flex-1 items-end gap-2 pb-2">
                      {[
                        { h: "h-[30%]", color: "bg-primary/20", label: "US" },
                        { h: "h-[50%]", color: "bg-primary/40", label: "UK" },
                        { h: "h-[40%]", color: "bg-brand-accent", label: "DE" },
                        { h: "h-[75%]", color: "bg-primary/60", label: "FR" },
                        { h: "h-[85%]", color: "bg-primary/80", label: "JP" },
                        { h: "h-[60%]", color: "bg-primary", label: "IT" }
                      ].map((bar, i) => (
                        <div key={i} className="group relative flex h-full w-full flex-col justify-end items-center gap-1.5">
                          <div
                            className={`w-full rounded-sm ${bar.color} transition-all duration-700 hover:opacity-80 animate-in slide-in-from-bottom-4 fade-in fill-mode-both ${bar.h}`}
                            style={{ animationDelay: `${i * 100 + 400}ms` }}
                          >
                          </div>
                          <span className="type-mono text-[8px] text-muted-foreground">{bar.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right Side: AI Assistant Faux Panel */}
                <div className="hidden xl:flex w-[280px] flex-col rounded-sm border border-brand-accent/20 bg-background/80 p-4 shadow-sm relative overflow-hidden backdrop-blur-md">

                  <p className="type-mono mb-4 flex items-center gap-2 text-[11px] uppercase tracking-widest text-brand-accent">
                    <Bot className="h-3.5 w-3.5" /> Assistant
                  </p>

                  <div className="flex flex-1 flex-col gap-4">
                    {/* Faux Chat Bubbles */}
                    <div className="w-[85%] rounded-xl rounded-tr-sm bg-muted/40 p-3 text-[11.5px] leading-relaxed text-primary shadow-sm border border-border/30 animate-in fade-in slide-in-from-bottom-2 fill-mode-both delay-700">
                      Show me the Q3 mechanicals gap in Germany.
                    </div>

                    <div className="ml-auto w-[90%] rounded-xl rounded-tl-sm border border-brand-accent/30 bg-brand-accent-ghost/30 p-3 text-[11.5px] leading-relaxed text-primary shadow-sm animate-in fade-in slide-in-from-bottom-2 fill-mode-both delay-1000">
                      Found <strong className="font-semibold text-brand-accent">€14k</strong> missing from GEMA. Primarily <span className="underline decoration-brand-accent/30 underline-offset-2">Unmatched Deals</span>.
                    </div>
                  </div>

                  <div className="relative mt-3 border-t border-border/40 pt-3">
                    <div className="w-full rounded-sm border border-border/50 bg-muted/20 py-2 px-3 text-[10px] text-muted-foreground shadow-inner flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-brand-accent animate-pulse" />
                      Ask about data...
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>


        <section className="relative flex items-center justify-center p-4 md:p-8 z-20 col-start-1 row-start-1 lg:col-start-2 lg:row-start-1 bg-transparent">
          <Card className="w-full max-w-md border border-border/40 lg:border-0 bg-background/85 lg:bg-transparent shadow-2xl lg:shadow-none backdrop-blur-xl lg:backdrop-blur-none transition-all duration-500">
            <CardHeader className="text-center pt-8 lg:pt-6">
              <div className="mx-auto mb-5 flex items-center justify-center lg:hidden">
                <img src="/ordersounds-logo.png" alt="OrderSounds" className="h-8 w-auto object-contain" />
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
