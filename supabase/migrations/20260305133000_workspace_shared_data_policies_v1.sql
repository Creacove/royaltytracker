-- Workspace-shared data access for collaborative cleanup/review.
-- Broadens read/update from creator-only to same-workspace members.

CREATE OR REPLACE FUNCTION public.can_access_workspace_member_data(
  p_target_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.is_platform_admin(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.company_memberships self_m
        INNER JOIN public.company_memberships target_m
          ON target_m.company_id = self_m.company_id
        WHERE self_m.user_id = auth.uid()
          AND self_m.membership_status = 'active'
          AND target_m.user_id = p_target_user_id
          AND target_m.membership_status = 'active'
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_access_workspace_member_data(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_workspace_member_data(UUID) TO service_role;

-- cmo_reports
DROP POLICY IF EXISTS "Users can view their own reports" ON public.cmo_reports;
DROP POLICY IF EXISTS "Users can update their own reports" ON public.cmo_reports;
DROP POLICY IF EXISTS "Workspace members can view reports" ON public.cmo_reports;
DROP POLICY IF EXISTS "Workspace members can update reports" ON public.cmo_reports;

CREATE POLICY "Workspace members can view reports"
ON public.cmo_reports FOR SELECT
USING (public.can_access_workspace_member_data(user_id));

CREATE POLICY "Workspace members can update reports"
ON public.cmo_reports FOR UPDATE
USING (public.can_access_workspace_member_data(user_id))
WITH CHECK (public.can_access_workspace_member_data(user_id));

-- royalty_transactions
DROP POLICY IF EXISTS "Users can view their own transactions" ON public.royalty_transactions;
DROP POLICY IF EXISTS "Workspace members can view transactions" ON public.royalty_transactions;
DROP POLICY IF EXISTS "Workspace members can update transactions" ON public.royalty_transactions;

CREATE POLICY "Workspace members can view transactions"
ON public.royalty_transactions FOR SELECT
USING (public.can_access_workspace_member_data(user_id));

CREATE POLICY "Workspace members can update transactions"
ON public.royalty_transactions FOR UPDATE
USING (public.can_access_workspace_member_data(user_id))
WITH CHECK (public.can_access_workspace_member_data(user_id));

-- validation_errors
DROP POLICY IF EXISTS "Users can view their own errors" ON public.validation_errors;
DROP POLICY IF EXISTS "Workspace members can view validation errors" ON public.validation_errors;
DROP POLICY IF EXISTS "Workspace members can update validation errors" ON public.validation_errors;

CREATE POLICY "Workspace members can view validation errors"
ON public.validation_errors FOR SELECT
USING (public.can_access_workspace_member_data(user_id));

CREATE POLICY "Workspace members can update validation errors"
ON public.validation_errors FOR UPDATE
USING (public.can_access_workspace_member_data(user_id))
WITH CHECK (public.can_access_workspace_member_data(user_id));

-- document_ai_report_items
DROP POLICY IF EXISTS "Users can view their own document ai report items" ON public.document_ai_report_items;
DROP POLICY IF EXISTS "Workspace members can view document ai report items" ON public.document_ai_report_items;
DROP POLICY IF EXISTS "Workspace members can update document ai report items" ON public.document_ai_report_items;

CREATE POLICY "Workspace members can view document ai report items"
ON public.document_ai_report_items FOR SELECT
USING (public.can_access_workspace_member_data(user_id));

CREATE POLICY "Workspace members can update document ai report items"
ON public.document_ai_report_items FOR UPDATE
USING (public.can_access_workspace_member_data(user_id))
WITH CHECK (public.can_access_workspace_member_data(user_id));

-- ingestion_files
DROP POLICY IF EXISTS "Users can view their own ingestion files" ON public.ingestion_files;
DROP POLICY IF EXISTS "Users can update their own ingestion files" ON public.ingestion_files;
DROP POLICY IF EXISTS "Workspace members can view ingestion files" ON public.ingestion_files;
DROP POLICY IF EXISTS "Workspace members can update ingestion files" ON public.ingestion_files;

CREATE POLICY "Workspace members can view ingestion files"
ON public.ingestion_files FOR SELECT
USING (public.can_access_workspace_member_data(user_id));

CREATE POLICY "Workspace members can update ingestion files"
ON public.ingestion_files FOR UPDATE
USING (public.can_access_workspace_member_data(user_id))
WITH CHECK (public.can_access_workspace_member_data(user_id));

-- source_rows
DROP POLICY IF EXISTS "Users can view their own source rows" ON public.source_rows;
DROP POLICY IF EXISTS "Workspace members can view source rows" ON public.source_rows;
DROP POLICY IF EXISTS "Workspace members can update source rows" ON public.source_rows;

CREATE POLICY "Workspace members can view source rows"
ON public.source_rows FOR SELECT
USING (public.can_access_workspace_member_data(user_id));

CREATE POLICY "Workspace members can update source rows"
ON public.source_rows FOR UPDATE
USING (public.can_access_workspace_member_data(user_id))
WITH CHECK (public.can_access_workspace_member_data(user_id));

-- source_fields
DROP POLICY IF EXISTS "Users can view their own source fields" ON public.source_fields;
DROP POLICY IF EXISTS "Workspace members can view source fields" ON public.source_fields;
DROP POLICY IF EXISTS "Workspace members can update source fields" ON public.source_fields;

CREATE POLICY "Workspace members can view source fields"
ON public.source_fields FOR SELECT
USING (public.can_access_workspace_member_data(user_id));

CREATE POLICY "Workspace members can update source fields"
ON public.source_fields FOR UPDATE
USING (public.can_access_workspace_member_data(user_id))
WITH CHECK (public.can_access_workspace_member_data(user_id));

-- review_tasks
DROP POLICY IF EXISTS "Users can view their own review tasks" ON public.review_tasks;
DROP POLICY IF EXISTS "Users can update their own review tasks" ON public.review_tasks;
DROP POLICY IF EXISTS "Workspace members can view review tasks" ON public.review_tasks;
DROP POLICY IF EXISTS "Workspace members can update review tasks" ON public.review_tasks;

CREATE POLICY "Workspace members can view review tasks"
ON public.review_tasks FOR SELECT
USING (public.can_access_workspace_member_data(user_id));

CREATE POLICY "Workspace members can update review tasks"
ON public.review_tasks FOR UPDATE
USING (public.can_access_workspace_member_data(user_id))
WITH CHECK (public.can_access_workspace_member_data(user_id));

-- normalization_rules
DROP POLICY IF EXISTS "Users can view their own normalization rules" ON public.normalization_rules;
DROP POLICY IF EXISTS "Users can update their own normalization rules" ON public.normalization_rules;
DROP POLICY IF EXISTS "Workspace members can view normalization rules" ON public.normalization_rules;
DROP POLICY IF EXISTS "Workspace members can update normalization rules" ON public.normalization_rules;

CREATE POLICY "Workspace members can view normalization rules"
ON public.normalization_rules FOR SELECT
USING (public.can_access_workspace_member_data(user_id));

CREATE POLICY "Workspace members can update normalization rules"
ON public.normalization_rules FOR UPDATE
USING (public.can_access_workspace_member_data(user_id))
WITH CHECK (public.can_access_workspace_member_data(user_id));
