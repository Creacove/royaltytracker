# Partner Onboarding Runbook (Invite-Only)

## Target Go-Live
- First external partner onboarding: **Monday, March 2, 2026**.
- Initial partner: **Nexus Music Publishing**.

## Access Model
- Public sign-up is disabled in UI.
- Every partner user must be pre-invited.
- Invited users can sign in with password or secure email link, then complete onboarding once.
- Platform admins and workspace owners/admins can send invites from `/admin/invites`.

## Data Collected During Onboarding
- User profile:
  - First name
  - Last name
  - Job title
  - Phone (optional)
- Partner company/workspace profile:
  - Company name
  - Website (optional)
  - Country code (optional)
  - Default reporting currency
  - Timezone
  - Monthly statement volume band
  - Primary CMO relationship count

## Standard Invite Flow
1. Sign in with a platform admin (or owner/admin workspace) account.
2. Open `/admin/invites`.
3. Enter invite email, role, and workspace target.
4. Submit invite (creates invitation record + sends auth invite email).
5. User signs in from app login screen.
6. User is forced to `/onboarding`, completes profile + company setup, and then enters workspace.

## Platform Admin Bootstrap
- The first authenticated user is auto-bootstrapped as platform admin.
- Additional admin grants can be done via SQL:
```sql
select public.grant_platform_admin_by_email(
  p_email => 'you@yourcompany.com',
  p_notes => 'Operations admin'
);
```

## Operator Checklist Before Sending Invite
1. Confirm exact invite email domain and spelling.
2. Confirm initial role (`owner`, `admin`, `member`, `viewer`).
3. Confirm company default currency and timezone.
4. Confirm onboarding contact person and phone.
5. Confirm statement volume band for support planning.

## Monday Launch Checklist
1. Run migrations:
   - `20260228112000_partner_invite_onboarding_v1.sql`
   - `20260228124500_platform_admin_invites_v1.sql`
2. Deploy edge function `send-partner-invite`.
3. Ensure Supabase Auth sign-ups are disabled (`enable_signup = false` in `supabase/config.toml`, then push config if needed).
4. Sign in as platform admin and open `/admin/invites`.
5. Send Nexus invite from the app.
6. Test login with a staging invited account.
7. Verify `app_users`, `company_memberships`, and `partner_companies` rows are created/updated after onboarding.
