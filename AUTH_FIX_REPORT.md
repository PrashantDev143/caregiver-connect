# Auth Fix Report – Signup / Login and Schema

## What Was Wrong

### 1. **Project / key mismatch (most likely cause of “empty Users”)**

- **.env** had two projects referenced:
  - **Commented (old):** `wenhlqkdptptdhwudgex` – URL and anon key for project A.
  - **Active:** `yvknoxijjccmkrgburfn` – URL and anon key for project B.
- If the app was ever built or run with the **wrong** project (e.g. cached build, or wrong env), then:
  - **Signup** would hit project A → user created in A.
  - You look at **Dashboard → Authentication → Users** for project **B** → list is **empty**.
- **“User already registered”** = that email already exists in **the project the app is actually using** (possibly A).
- **“Invalid login credentials”** = no user with that email/password in **the project the app is using** (e.g. B if you pointed env at B but the user was created in A).

So the issue was almost certainly **wrong project keys or cached env**: app and Dashboard were not pointing at the same Supabase project.

### 2. **No visibility into which project was used**

- There were no runtime logs for Supabase URL or anon key.
- Hard to confirm that the frontend was using the same project as the Dashboard.

### 3. **Possible .env formatting**

- Trailing space after `VITE_SUPABASE_PROJECT_ID` and a leading space before `VITE_SUPABASE_URL` could, in some setups, result in a wrong or invalid URL/key being read. These have been removed.

### 4. **Auth usage**

- Signup and login were already using only `supabase.auth.signUp` and `supabase.auth.signInWithPassword`, with `options.data: { name, role }` for signup. No auth misuse was required to fix; only logging and schema were changed.

---

## What Was Done

### 1. Auth config (verify)

- **`src/integrations/supabase/client.ts`**
  - Reads **only** from env: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or `VITE_SUPABASE_ANON_KEY`).
  - No hardcoded URL or key.
  - **Runtime logs** (browser console):
    - `[Supabase] URL:` … (full URL)
    - `[Supabase] Anon key prefix:` … (first 30 chars + `...`)
  - You can compare these with **Supabase Dashboard → Settings → API** (Project URL and anon public key) to confirm they match.

### 2. Signup & login logic

- **`src/context/AuthContext.tsx`**
  - **Signup:** still only `supabase.auth.signUp` with `options.data: { name, role: selectedRole }`. Full error is logged: `[Auth] signUp error: { message, name, status, full }`.
  - **Login:** still only `supabase.auth.signInWithPassword`. Full error is logged: `[Auth] signIn error: { message, name, status, full }`.
  - Return values include `data` where useful (e.g. signUp returns `data` for future use); callers that only use `error` are unchanged.

### 3. Database schema replaced

- **New migration:** `supabase/migrations/20260201000000_replace_schema_auth_fix.sql`
  - **Removes** old schema: trigger on `auth.users`, old `handle_new_user`, triggers on profiles/geofences, tables (alerts, location_logs, geofences, patients, caregivers, user_roles, profiles), old functions (`get_user_role`, `get_caregiver_id`, `get_patient_id`, `has_role`, `update_updated_at_column`), and enum `app_role`.
  - **Creates** the exact schema you specified:
    - Enum `app_role`, tables `profiles`, `user_roles`, `caregivers`, `patients`.
    - Helpers: `current_caregiver_id()`, `current_patient_id()`, and **`get_user_role(_user_id)`** (required by the frontend).
    - RLS enabled and minimal policies as specified.
    - Trigger `on_auth_user_created` → `handle_new_user()` that fills profiles, user_roles, and caregivers or patients from `raw_user_meta_data.role` and `raw_user_meta_data.name`.

**Important:** Geofences, location_logs, and alerts are **not** in this schema. Any code that uses those tables will break until you re-add them or adjust the app. The auth and role flow (signup → trigger → login → get_user_role) are aligned with this schema.

### 4. .env

- Trailing/leading spaces around `VITE_SUPABASE_PROJECT_ID` and `VITE_SUPABASE_URL` were removed so URL and keys are read correctly.

---

## How to Validate

1. **Confirm project**
   - Open the app, open browser DevTools → Console.
   - Check `[Supabase] URL:` and `[Supabase] Anon key prefix:`.
   - In Supabase Dashboard, open the **same** project you want the app to use → **Settings → API**.
   - Confirm URL and anon key (first ~30 chars) match. If they don’t, fix `.env` so they match and restart the dev server (and clear cache if needed).

2. **Apply migration**
   - Link the same project: `supabase link` (if not already).
   - Run: `supabase db push` or apply the migration `20260201000000_replace_schema_auth_fix.sql` via Dashboard SQL editor (in that project).

3. **Signup as caregiver**
   - Use a new email. Submit signup.
   - In Dashboard → **Authentication → Users**, you should see the new user.
   - In **Table Editor**: `profiles`, `user_roles`, `caregivers` should each have one row for that user.

4. **Signup as patient**
   - Same with another email; check `profiles`, `user_roles`, `patients`.

5. **Login**
   - Login with one of those users; you should be routed to the correct dashboard (caregiver vs patient) and see no “Invalid login credentials” if the project and credentials match.

6. **“User already registered”**
   - Should only appear if that email **already exists** in the **same** project whose URL/key the app is using. If Users is empty and you still get this, the app is still using a different project (check console URL/key again).

---

## Conclusion

- **Root cause:** Almost certainly **wrong Supabase project keys or cached env**: the app was talking to one project while the Dashboard (Authentication → Users) was showing another, leading to “User already registered” + “Invalid login credentials” and “empty” Users.
- **Not:** A fundamental misuse of Supabase Auth (signUp/signInWithPassword and options.data were already correct).
- **Fixes applied:**  
  - Single source of config (env only), runtime logs to verify URL and anon key.  
  - Full error logging for signUp/signIn.  
  - .env spaces removed.  
  - Schema replaced with your clean schema + `get_user_role` and trigger so signup creates profile/role/caregiver-or-patient and login can resolve role.

After ensuring **one** project is used everywhere (env, Dashboard, migration) and applying the migration, the system should be stable for auth and role-based routing. Remove or reduce the `[Supabase]` / `[Auth]` console logs once you’re satisfied.
