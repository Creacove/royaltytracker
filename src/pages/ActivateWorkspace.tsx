import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, Lock, Rocket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { OnboardingState } from "@/types/onboarding";
import type { WorkspaceSubscriptionState } from "@/types/workspace-billing";

type ActivateWorkspaceProps = {
  onboardingState: OnboardingState;
  subscriptionState: WorkspaceSubscriptionState;
  refreshSubscriptionState: () => Promise<void> | void;
};

const PLAN_CATALOG = [
  {
    planCode: "solo" as const,
    name: "Solo",
    priceLabel: "$49/mo",
    seats: 1,
    statements: 8,
    rows: "75,000",
    aiRequests: 30,
  },
  {
    planCode: "team" as const,
    name: "Team",
    priceLabel: "$149/mo",
    seats: 4,
    statements: 30,
    rows: "300,000",
    aiRequests: 150,
    featured: true,
  },
];

function toPercent(value: number): string {
  return `${Math.max(0, Math.round(value * 100))}%`;
}

export default function ActivateWorkspace({
  onboardingState,
  subscriptionState,
  refreshSubscriptionState,
}: ActivateWorkspaceProps) {
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  const [partnerCode, setPartnerCode] = useState("");
  const [pendingPlan, setPendingPlan] = useState<"solo" | "team" | null>(null);
  const [redeemingCode, setRedeemingCode] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);

  const currentPlan = useMemo(
    () => PLAN_CATALOG.find((plan) => plan.planCode === subscriptionState.planCode) ?? null,
    [subscriptionState.planCode],
  );

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const checkoutStatus = params.get("checkout");
    if (!checkoutStatus) return;

    if (checkoutStatus === "success") {
      toast({
        title: "Checkout submitted",
        description: "We are confirming subscription status. This can take a few seconds.",
      });
      void refreshSubscriptionState();
    }

    if (checkoutStatus === "canceled") {
      toast({
        title: "Checkout canceled",
        description: "No changes were made. You can choose a plan anytime.",
      });
    }

    params.delete("checkout");
    navigate(
      {
        pathname: "/activate",
        search: params.toString() ? `?${params.toString()}` : "",
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const handleStartCheckout = async (planCode: "solo" | "team") => {
    setPendingPlan(planCode);
    const successUrl = `${window.location.origin}/activate?checkout=success`;
    const cancelUrl = `${window.location.origin}/activate?checkout=canceled`;

    const { data, error } = await supabase.functions.invoke("create-billing-checkout-session", {
      body: {
        plan_code: planCode,
        success_url: successUrl,
        cancel_url: cancelUrl,
      },
    });

    if (error) {
      toast({
        title: "Checkout failed",
        description: error.message,
        variant: "destructive",
      });
      setPendingPlan(null);
      return;
    }

    const checkoutUrl = (data as { checkout_url?: string } | null)?.checkout_url;
    if (!checkoutUrl) {
      toast({
        title: "Checkout failed",
        description: "Checkout URL was not returned.",
        variant: "destructive",
      });
      setPendingPlan(null);
      return;
    }

    window.location.assign(checkoutUrl);
  };

  const handleRedeemCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!partnerCode.trim()) {
      toast({
        title: "Code required",
        description: "Enter your partner code to continue.",
        variant: "destructive",
      });
      return;
    }

    setRedeemingCode(true);
    const { error } = await (supabase as any).rpc("redeem_workspace_partner_code", {
      p_code: partnerCode.trim(),
    });

    if (error) {
      toast({
        title: "Code rejected",
        description: error.message,
        variant: "destructive",
      });
      setRedeemingCode(false);
      return;
    }

    setPartnerCode("");
    await refreshSubscriptionState();
    toast({
      title: "Partner sponsorship active",
      description: "Workspace access is now unlocked under sponsored Team access.",
    });
    setRedeemingCode(false);
  };

  const handleOpenBillingPortal = async () => {
    setOpeningPortal(true);
    const { data, error } = await supabase.functions.invoke("create-billing-portal-session", {
      body: {
        return_url: `${window.location.origin}/workspace`,
      },
    });

    if (error) {
      toast({
        title: "Portal unavailable",
        description: error.message,
        variant: "destructive",
      });
      setOpeningPortal(false);
      return;
    }

    const portalUrl = (data as { portal_url?: string } | null)?.portal_url;
    if (!portalUrl) {
      toast({
        title: "Portal unavailable",
        description: "Billing portal URL was not returned.",
        variant: "destructive",
      });
      setOpeningPortal(false);
      return;
    }

    window.location.assign(portalUrl);
  };

  const sponsoredMessage =
    subscriptionState.sponsorExpiresAt &&
    `Partner sponsorship active through ${new Date(subscriptionState.sponsorExpiresAt).toLocaleDateString()}. After this date, reactivate billing at $149/month to continue.`;

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-border/60">
        <CardContent className="grid gap-4 bg-[linear-gradient(140deg,hsl(var(--brand-accent-ghost))/80,transparent_65%)] p-6 md:grid-cols-[1.35fr_1fr]">
          <div className="space-y-2">
            <p className="font-display text-xs uppercase tracking-[0.08em] text-muted-foreground">Activation</p>
            <h1 className="font-display text-3xl tracking-[0.04em]">Activate your workspace</h1>
            <p className="text-sm text-muted-foreground">
              OrderSounds is a paid subscription service. Choose a plan to continue.
            </p>
          </div>
          <div className="flex flex-wrap items-start justify-start gap-2 md:justify-end">
            <Badge variant="outline">{onboardingState.companyName ?? "Workspace"}</Badge>
            {currentPlan && <Badge variant="outline">{currentPlan.name}</Badge>}
          </div>
        </CardContent>
      </Card>

      {!subscriptionState.canManageBilling && (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Billing access required</CardTitle>
            <CardDescription>
              Only workspace owners/admins can activate billing. Contact your workspace owner/admin to continue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/settings">Open Settings</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {subscriptionState.canManageBilling && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {PLAN_CATALOG.map((plan) => {
              const isCurrent = subscriptionState.planCode === plan.planCode;
              return (
                <Card key={plan.planCode} className="border-border/60">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          {plan.name}
                          {plan.featured && <Badge variant="outline">Most Popular</Badge>}
                        </CardTitle>
                        <CardDescription>{plan.priceLabel}</CardDescription>
                      </div>
                      {isCurrent && <Badge variant="outline">Current</Badge>}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p>{plan.seats} workspace seat{plan.seats > 1 ? "s" : ""}</p>
                    <p>{plan.statements} processed statements / month</p>
                    <p>{plan.rows} normalized rows / month</p>
                    <p>{plan.aiRequests} AI analysis requests / month</p>
                    <Button
                      className="w-full"
                      onClick={() => void handleStartCheckout(plan.planCode)}
                      disabled={pendingPlan !== null}
                    >
                      <Rocket className="mr-2 h-4 w-4" />
                      {pendingPlan === plan.planCode ? "Redirecting..." : "Activate Workspace"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>Partner access code</CardTitle>
              <CardDescription>Have a partner code? Apply it below for sponsored access.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form className="space-y-3" onSubmit={handleRedeemCode}>
                <div className="space-y-2">
                  <Label htmlFor="partner-code">Partner code</Label>
                  <Input
                    id="partner-code"
                    value={partnerCode}
                    onChange={(event) => setPartnerCode(event.target.value)}
                    placeholder="OSP-XXXXXXXXXXXX"
                  />
                </div>
                <Button type="submit" variant="outline" disabled={redeemingCode}>
                  <Lock className="mr-2 h-4 w-4" />
                  {redeemingCode ? "Applying code..." : "Apply code"}
                </Button>
              </form>

              {sponsoredMessage && (
                <div className="rounded-sm border border-border/50 bg-background/60 p-3 text-sm text-muted-foreground">
                  {sponsoredMessage}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {!subscriptionState.needsActivation && (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[hsl(var(--tone-success))]" />
              Workspace active
            </CardTitle>
            <CardDescription>
              Billing status: {subscriptionState.effectiveSubscriptionStatus.replaceAll("_", " ")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-sm border border-border/50 p-3">
                <p className="text-xs text-muted-foreground">Seats</p>
                <p className="font-medium">
                  {subscriptionState.seatsUsed}
                  {subscriptionState.seatLimit ? ` / ${subscriptionState.seatLimit}` : ""}
                </p>
              </div>
              <div className="rounded-sm border border-border/50 p-3">
                <p className="text-xs text-muted-foreground">Statements</p>
                <p className="font-medium">
                  {subscriptionState.statementsUsed}
                  {subscriptionState.statementsLimit ? ` / ${subscriptionState.statementsLimit}` : ""}
                </p>
                <p className="text-[11px] text-muted-foreground">{toPercent(subscriptionState.statementsUsageRatio)}</p>
              </div>
              <div className="rounded-sm border border-border/50 p-3">
                <p className="text-xs text-muted-foreground">AI Requests</p>
                <p className="font-medium">
                  {subscriptionState.aiRequestsUsed}
                  {subscriptionState.aiRequestsLimit ? ` / ${subscriptionState.aiRequestsLimit}` : ""}
                </p>
                <p className="text-[11px] text-muted-foreground">{toPercent(subscriptionState.aiUsageRatio)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/">Enter Workspace</Link>
              </Button>
              {subscriptionState.canManageBilling && subscriptionState.effectiveSubscriptionStatus === "active_paid" && (
                <Button variant="outline" onClick={handleOpenBillingPortal} disabled={openingPortal}>
                  {openingPortal ? "Opening portal..." : "Manage Billing"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
