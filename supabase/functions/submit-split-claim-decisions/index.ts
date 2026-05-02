import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type SplitDecisionAction = "approve" | "reject" | "keep_existing" | "replace_existing";
type SplitDecisionRequest = {
  claim_ids?: unknown;
  source_report_id?: unknown;
  work_group_keys?: unknown;
  action: SplitDecisionAction;
  note?: string;
};
type JsonRecord = Record<string, unknown>;

function parseJwtClaims(token: string): { role?: string; sub?: string; user_id?: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(b64 + pad));
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalizeText(value: string | null): string | null {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? null;
}

function splitClaimToCatalogClaimPayload(claim: JsonRecord): JsonRecord {
  return {
    split_claim_id: claim.id,
    work_title: claim.work_title,
    iswc: claim.iswc,
    source_work_code: claim.source_work_code,
    party_name: claim.party_name,
    ipi_number: claim.ipi_number,
    source_role: claim.source_role,
    source_rights_code: claim.source_rights_code,
    source_rights_label: claim.source_rights_label,
    canonical_rights_stream: claim.canonical_rights_stream,
    share_pct: claim.share_pct,
    territory_scope: claim.territory_scope,
    raw_payload: claim.raw_payload,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase env.");
    const supabase = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    const jwt = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!jwt) throw new Error("Missing Authorization header");

    const claims = parseJwtClaims(jwt);
    const requesterRole = claims?.role ?? null;
    let requesterId = claims?.sub ?? claims?.user_id ?? null;

    if (requesterRole !== "service_role") {
      const { data: authData, error: authErr } = await supabase.auth.getUser(jwt);
      if (authErr || !authData?.user?.id) {
        return new Response(JSON.stringify({ error: "Invalid or expired access token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      requesterId = authData.user.id;
    }

    const body = (await req.json().catch(() => ({}))) as Partial<SplitDecisionRequest>;
    let claimIds = Array.isArray(body.claim_ids)
      ? (body.claim_ids.map(String).filter(Boolean))
      : [];
    const action = body.action as SplitDecisionAction | undefined;
    const note = asString(body.note);
    const sourceReportId = asString(body.source_report_id);
    const workGroupKeys = Array.isArray(body.work_group_keys)
      ? body.work_group_keys.map(String).filter(Boolean)
      : [];

    if (!["approve", "reject", "keep_existing", "replace_existing"].includes(action ?? "")) {
      throw new Error('action must be "approve", "reject", "keep_existing", or "replace_existing"');
    }

    if (claimIds.length === 0 && sourceReportId) {
      let claimQuery = supabase
        .from("catalog_split_claims")
        .select("id")
        .eq("source_report_id", sourceReportId);
      if (workGroupKeys.length > 0) claimQuery = claimQuery.in("split_group_key", workGroupKeys);
      const { data: groupedClaims, error: groupedErr } = await claimQuery;
      if (groupedErr) throw new Error(`Failed to resolve split case claims: ${groupedErr.message}`);
      claimIds = (groupedClaims ?? []).map((claim: JsonRecord) => String(claim.id)).filter(Boolean);
    }

    if (claimIds.length === 0) throw new Error("claim_ids or source_report_id is required");

    const { data: splitClaims, error: claimsErr } = await supabase
      .from("catalog_split_claims")
      .select("*")
      .in("id", claimIds);
    if (claimsErr) throw new Error(`Failed to load split claims: ${claimsErr.message}`);
    if (!splitClaims || splitClaims.length === 0) throw new Error("No split claims found.");

    const companyIds = new Set(splitClaims.map((claim: JsonRecord) => asString(claim.company_id)).filter(Boolean));
    if (companyIds.size !== 1) throw new Error("Split claim decisions must target one company at a time.");
    const companyId = Array.from(companyIds)[0]!;

    if (requesterRole !== "service_role") {
      const { data: allowed, error: accessErr } = await supabase.rpc("can_access_company_data", {
        p_company_id: companyId,
      });
      if (accessErr || !allowed) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (action === "reject" || action === "keep_existing") {
      const nextReviewCaseStatus = action === "keep_existing" ? "archived" : "rejected";
      const { error: rejectErr } = await supabase
        .from("catalog_split_claims")
        .update({
          review_status: "rejected",
          review_case_status: nextReviewCaseStatus,
          dedupe_status: action === "keep_existing" ? "manual" : "new_needs_review",
        })
        .in("id", claimIds);
      if (rejectErr) {
        const missingCaseColumns = rejectErr.message.includes("review_case_status") || rejectErr.message.includes("dedupe_status");
        if (!missingCaseColumns) throw new Error(`Failed to reject split claims: ${rejectErr.message}`);
        const { error: legacyRejectErr } = await supabase
          .from("catalog_split_claims")
          .update({ review_status: "rejected" })
          .in("id", claimIds);
        if (legacyRejectErr) throw new Error(`Failed to reject split claims: ${legacyRejectErr.message}`);
      }

      const events = splitClaims.map((claim: JsonRecord) => ({
        company_id: claim.company_id,
        entity_type: "catalog_split_claim",
        entity_id: claim.id,
        event_type: action === "keep_existing" ? "split_conflict_kept_existing" : "split_claim_rejected",
        previous_state: { review_status: claim.review_status },
        new_state: { review_status: "rejected", review_case_status: nextReviewCaseStatus, note },
        decided_by: requesterId,
      }));
      const { error: eventErr } = await supabase.from("catalog_resolution_events").insert(events);
      if (eventErr) throw new Error(`Failed to write rejection events: ${eventErr.message}`);

      return new Response(
        JSON.stringify({
          action,
          updated_claims: splitClaims.length,
          promoted_rights_positions: 0,
          created_or_linked_works: 0,
          created_or_linked_parties: 0,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let updatedClaims = 0;
    let promotedRightsPositions = 0;
    let createdOrLinkedWorks = 0;
    let createdOrLinkedParties = 0;

    for (const claim of splitClaims as JsonRecord[]) {
      let workId = asString(claim.work_id);
      if (!workId) {
        const iswc = asString(claim.iswc);
        const sourceWorkCode = asString(claim.source_work_code);
        const workTitle = asString(claim.work_title) ?? "Untitled work";

        let workQuery = supabase.from("catalog_works").select("id").eq("company_id", claim.company_id);
        if (iswc) workQuery = workQuery.eq("iswc", iswc);
        else if (sourceWorkCode) workQuery = workQuery.eq("source_work_code", sourceWorkCode);
        else workQuery = workQuery.eq("normalized_title", normalizeText(workTitle));

        const { data: existingWork, error: workLookupErr } = await workQuery.maybeSingle();
        if (workLookupErr) throw new Error(`Failed to find catalog work: ${workLookupErr.message}`);

        if (existingWork?.id) {
          workId = existingWork.id;
        } else {
          const { data: work, error: workErr } = await supabase.from("catalog_works").upsert({
            company_id: claim.company_id,
            canonical_title: workTitle,
            normalized_title: normalizeText(workTitle),
            iswc,
            source_work_code: sourceWorkCode,
            status: "active",
          }).select("id").single();
          if (workErr || !work?.id) throw new Error(`Failed to upsert catalog work: ${workErr?.message ?? "missing id"}`);
          workId = work.id;
        }
        createdOrLinkedWorks += 1;
      }

      let partyId = asString(claim.party_id);
      if (!partyId) {
        const partyName = asString(claim.party_name) ?? "Unknown party";
        const ipiNumber = asString(claim.ipi_number);

        let partyQuery = supabase.from("catalog_parties").select("id").eq("company_id", claim.company_id);
        if (ipiNumber) partyQuery = partyQuery.eq("ipi_number", ipiNumber);
        else partyQuery = partyQuery.eq("normalized_name", normalizeText(partyName));

        const { data: existingParty, error: partyLookupErr } = await partyQuery.maybeSingle();
        if (partyLookupErr) throw new Error(`Failed to find catalog party: ${partyLookupErr.message}`);

        if (existingParty?.id) {
          partyId = existingParty.id;
        } else {
          const { data: party, error: partyErr } = await supabase.from("catalog_parties").upsert({
            company_id: claim.company_id,
            party_type: "unknown",
            display_name: partyName,
            legal_name: partyName,
            normalized_name: normalizeText(partyName),
            ipi_number: ipiNumber,
            status: "active",
          }).select("id").single();
          if (partyErr || !party?.id) throw new Error(`Failed to upsert catalog party: ${partyErr?.message ?? "missing id"}`);
          partyId = party.id;
        }
        createdOrLinkedParties += 1;
      }

      let catalogClaimId: string | null = null;
      {
        const { data: existingClaim, error: existingClaimErr } = await supabase
          .from("catalog_claims")
          .select("id")
          .eq("company_id", claim.company_id)
          .contains("payload", { split_claim_id: claim.id })
          .maybeSingle();
        if (existingClaimErr) throw new Error(`Failed to find catalog claim: ${existingClaimErr.message}`);
        catalogClaimId = existingClaim?.id ?? null;
      }

      if (!catalogClaimId) {
        const { data: catalogClaim, error: catalogClaimErr } = await supabase
          .from("catalog_claims")
          .insert({
            company_id: claim.company_id,
            claim_type: "split_sheet",
            basis_type: "registered",
            source_report_id: claim.source_report_id,
            source_row_id: claim.source_row_id,
            subject_entity_type: "work",
            subject_entity_id: workId,
            related_entity_type: "party",
            related_entity_id: partyId,
            payload: splitClaimToCatalogClaimPayload(claim),
            confidence: claim.confidence,
            resolution_status: "resolved",
          })
          .select("id")
          .single();
        if (catalogClaimErr || !catalogClaim?.id) {
          throw new Error(`Failed to create catalog claim: ${catalogClaimErr?.message ?? "missing id"}`);
        }
        catalogClaimId = catalogClaim.id;
      } else {
        const { error: catalogClaimUpdateErr } = await supabase
          .from("catalog_claims")
          .update({
            subject_entity_type: "work",
            subject_entity_id: workId,
            related_entity_type: "party",
            related_entity_id: partyId,
            resolution_status: "resolved",
            payload: splitClaimToCatalogClaimPayload(claim),
          })
          .eq("id", catalogClaimId);
        if (catalogClaimUpdateErr) throw new Error(`Failed to update catalog claim: ${catalogClaimUpdateErr.message}`);
      }

      await supabase.from("catalog_rights_positions").delete().eq("source_claim_id", catalogClaimId);
      if (action === "replace_existing") {
        let replaceQuery = supabase
          .from("catalog_rights_positions")
          .delete()
          .eq("company_id", claim.company_id)
          .eq("asset_type", "work")
          .eq("asset_id", workId)
          .eq("party_id", partyId)
          .eq("rights_stream", asString(claim.canonical_rights_stream) ?? "unknown");
        const territory = asString(claim.territory_scope);
        if (territory) replaceQuery = replaceQuery.eq("territory_scope", territory);
        const { error: replaceDeleteErr } = await replaceQuery;
        if (replaceDeleteErr) throw new Error(`Failed to replace existing rights position: ${replaceDeleteErr.message}`);
      }
      const { error: rightsPositionErr } = await supabase.from("catalog_rights_positions").upsert({
        company_id: claim.company_id,
        asset_type: "work",
        asset_id: workId,
        party_id: partyId,
        rights_family: "publishing",
        rights_stream: asString(claim.canonical_rights_stream) ?? "unknown",
        share_kind: "registered",
        share_pct: claim.share_pct,
        territory_scope: claim.territory_scope,
        valid_from: claim.valid_from,
        valid_to: claim.valid_to,
        basis_type: "registered",
        source_claim_id: catalogClaimId,
        confidence: claim.confidence,
        is_conflicted: false,
      });
      if (rightsPositionErr) throw new Error(`Failed to promote rights position: ${rightsPositionErr.message}`);

      const { error: claimUpdateErr } = await supabase
        .from("catalog_split_claims")
        .update({
          review_status: "approved",
          review_case_status: "approved",
          dedupe_status: action === "replace_existing" ? "manual" : claim.dedupe_status ?? "manual",
          work_id: workId,
          party_id: partyId,
          matched_existing_rights_position_id: null,
        })
        .eq("id", claim.id);
      if (claimUpdateErr) {
        const missingCaseColumns =
          claimUpdateErr.message.includes("review_case_status") ||
          claimUpdateErr.message.includes("dedupe_status") ||
          claimUpdateErr.message.includes("matched_existing_rights_position_id");
        if (!missingCaseColumns) throw new Error(`Failed to approve split claim: ${claimUpdateErr.message}`);
        const { error: legacyClaimUpdateErr } = await supabase
          .from("catalog_split_claims")
          .update({ review_status: "approved", work_id: workId, party_id: partyId })
          .eq("id", claim.id);
        if (legacyClaimUpdateErr) throw new Error(`Failed to approve split claim: ${legacyClaimUpdateErr.message}`);
      }

      const { error: eventErr } = await supabase.from("catalog_resolution_events").insert({
        company_id: claim.company_id,
        entity_type: "catalog_split_claim",
        entity_id: claim.id,
        event_type: action === "replace_existing" ? "split_conflict_replaced_existing" : "split_claim_approved",
        previous_state: { review_status: claim.review_status, work_id: claim.work_id, party_id: claim.party_id },
        new_state: { review_status: "approved", review_case_status: "approved", work_id: workId, party_id: partyId, source_claim_id: catalogClaimId, note },
        decided_by: requesterId,
      });
      if (eventErr) throw new Error(`Failed to write approval event: ${eventErr.message}`);

      updatedClaims += 1;
      promotedRightsPositions += 1;
    }

    return new Response(
      JSON.stringify({
        action,
        updated_claims: updatedClaims,
        promoted_rights_positions: promotedRightsPositions,
        created_or_linked_works: createdOrLinkedWorks,
        created_or_linked_parties: createdOrLinkedParties,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
