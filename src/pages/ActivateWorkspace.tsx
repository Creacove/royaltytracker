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
  const canManageBillingAccess =
    subscriptionState.canManageBilling ||
    onboardingState.activeMembershipRole === "owner" ||
    onboardingState.activeMembershipRole === "admin" ||
    onboardingState.isPlatformAdmin;

  return (
    <div className="space-y-6 pb-8">
      <Card surface="hero" className="overflow-hidden">
        <CardContent className="grid gap-5 p-6 lg:grid-cols-[minmax(0,1.1fr)_360px] lg:p-7">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Activation</Badge>
              <Badge variant="outline">{onboardingState.companyName ?? "Workspace"}</Badge>
              {currentPlan ? <Badge variant="outline">{currentPlan.name}</Badge> : null}
            </div>
            <div className="space-y-2">
              <h1 className="type-display-hero text-[clamp(2.2rem,2vw+1.5rem,3.5rem)] leading-[0.94] text-foreground">
                Activate the workspace behind the reporting.
              </h1>
              <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
                Choose the plan or apply a partner code that unlocks one workspace for music reporting, analysis,
                anomaly detection, and faster decisions.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <div className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.76)] p-4">
              <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Workspace</p>
              <p className="mt-2 text-sm font-semibold text-foreground">{onboardingState.companyName ?? "Pending workspace"}</p>
            </div>
            <div className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.76)] p-4">
              <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Status</p>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {subscriptionState.effectiveSubscriptionStatus.replaceAll("_", " ")}
              </p>
            </div>
            <div className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.76)] p-4">
              <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Access</p>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {canManageBillingAccess ? "Billing manager" : "Owner or admin required"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {!canManageBillingAccess && (
        <Card surface="elevated">
          <CardHeader>
            <CardTitle>Billing access required</CardTitle>
            <CardDescription>Only workspace owners or admins can activate billing for this workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/settings">Open settings</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {canManageBillingAccess && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_360px]">
          <div className="space-y-6">
            <Card surface="elevated">
              <CardHeader>
                <CardTitle>Choose a plan</CardTitle>
                <CardDescription>Pick the plan that matches the reporting volume and team using the Desk.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-2">
                {PLAN_CATALOG.map((plan) => {
                  const isCurrent = subscriptionState.planCode === plan.planCode;
                  return (
                    <Card
                      key={plan.planCode}
                      surface={plan.featured ? "hero" : "elevated"}
                      className="h-full border-[hsl(var(--border)/0.12)]"
                    >
                      <CardHeader className="space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <CardTitle>{plan.name}</CardTitle>
                              {plan.featured ? <Badge variant="outline">Recommended</Badge> : null}
                              {isCurrent ? <Badge variant="outline">Current</Badge> : null}
                            </div>
                            <CardDescription>{plan.priceLabel}</CardDescription>
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-panel)/0.74)] p-3">
                            <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Seats</p>
                            <p className="mt-2 text-sm font-semibold text-foreground">
                              {plan.seats} workspace seat{plan.seats > 1 ? "s" : ""}
                            </p>
                          </div>
                          <div className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-panel)/0.74)] p-3">
                            <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Statements</p>
                            <p className="mt-2 text-sm font-semibold text-foreground">{plan.statements} / month</p>
                          </div>
                          <div className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-panel)/0.74)] p-3">
                            <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Rows</p>
                            <p className="mt-2 text-sm font-semibold text-foreground">{plan.rows}</p>
                          </div>
                          <div className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-panel)/0.74)] p-3">
                            <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">AI requests</p>
                            <p className="mt-2 text-sm font-semibold text-foreground">{plan.aiRequests} / month</p>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <Button
                          className="w-full"
                          onClick={() => void handleStartCheckout(plan.planCode)}
                          disabled={pendingPlan !== null}
                        >
                          <Rocket className="mr-2 h-4 w-4" />
                          {pendingPlan === plan.planCode ? "Redirecting..." : "Activate workspace"}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </CardContent>
            </Card>

            {!subscriptionState.needsActivation && (
              <Card surface="elevated">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[hsl(var(--tone-success))]" />
                    Workspace active
                  </CardTitle>
                  <CardDescription>
                    Billing status: {subscriptionState.effectiveSubscriptionStatus.replaceAll("_", " ")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.1)] p-3">
                      <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Seats</p>
                      <p className="mt-2 text-sm font-semibold text-foreground">
                        {subscriptionState.seatsUsed}
                        {subscriptionState.seatLimit ? ` / ${subscriptionState.seatLimit}` : ""}
                      </p>
                    </div>
                    <div className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.1)] p-3">
                      <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Statements</p>
                      <p className="mt-2 text-sm font-semibold text-foreground">
                        {subscriptionState.statementsUsed}
                        {subscriptionState.statementsLimit ? ` / ${subscriptionState.statementsLimit}` : ""}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{toPercent(subscriptionState.statementsUsageRatio)}</p>
                    </div>
                    <div className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.1)] p-3">
                      <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">AI requests</p>
                      <p className="mt-2 text-sm font-semibold text-foreground">
                        {subscriptionState.aiRequestsUsed}
                        {subscriptionState.aiRequestsLimit ? ` / ${subscriptionState.aiRequestsLimit}` : ""}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{toPercent(subscriptionState.aiUsageRatio)}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button asChild>
                      <Link to="/">Enter workspace</Link>
                    </Button>
                    {subscriptionState.canManageBilling && subscriptionState.effectiveSubscriptionStatus === "active_paid" && (
                      <Button variant="outline" onClick={handleOpenBillingPortal} disabled={openingPortal}>
                        {openingPortal ? "Opening portal..." : "Manage billing"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card surface="elevated">
              <CardHeader>
                <CardTitle>Partner code</CardTitle>
                <CardDescription>Apply sponsorship here if this reporting workspace was provisioned through a partner agreement.</CardDescription>
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
                  <Button type="submit" variant="outline" className="w-full" disabled={redeemingCode}>
                    <Lock className="mr-2 h-4 w-4" />
                    {redeemingCode ? "Applying code..." : "Apply code"}
                  </Button>
                </form>

                {sponsoredMessage ? (
                  <div className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--brand-accent)/0.12)] bg-[hsl(var(--brand-accent-ghost)/0.5)] p-4 text-sm leading-6 text-muted-foreground">
                    {sponsoredMessage}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card surface="muted">
              <CardHeader>
                <CardTitle>What activation unlocks</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
                <p>The workspace can start ingesting and reviewing music reporting under the selected plan limits.</p>
                <p>Seats, statement volume, and AI usage become visible across the workspace and billing views.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
