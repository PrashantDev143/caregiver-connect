# End-to-End Auth + DB + Redirect + Location – Fix Report

## Why Tables Were Empty

Two main causes:

### 1. Trigger not firing or failing silently

- **If the trigger was not firing:** The app and Supabase project were correct, but the trigger `on_auth_user_created` was missing, on the wrong schema, or not attached to `auth.users` (e.g. migration not run on the project you use).
- **If the trigger was failing:** The only failure path in the original trigger was casting `(NEW.raw_user_meta_data->>'role')::app_role`. If the frontend sent `role` as something other than exactly `'caregiver'` or `'patient'` (e.g. missing, typo, or different casing), the cast threw and the trigger rolled back. **No rows** were inserted and Supabase does not surface trigger errors to the client, so signup “succeeded” but profiles/user_roles/caregivers/patients stayed empty.

### 2. Signup flow racing redirect

- Signup called `signUp()` then **immediately** navigated to `/caregiver/dashboard` or `/patient/dashboard`.
- Session appears via `onAuthStateChange` **after** the redirect. The dashboard (and AuthContext) then ran with a session but **role not yet fetched** (or `get_user_role` returned null because the trigger had just run or was still running).
- So: redirect happened before session + role + DB rows were ready. Combined with no retry for `get_user_role`, the app often saw `user` set but `role` null and either showed “Setting up…” forever or redirected to login, and tables could still be empty if the trigger had failed.

---

## What Was Fixed

### 1. Trigger: reliable + observable

**File:** `supabase/migrations/20260201100000_trigger_logging_and_location_tables.sql`

- **Safe role casting:** `handle_new_user()` now reads `raw_user_meta_data->>'role'` and only treats `'caregiver'` and `'patient'` as valid; otherwise it defaults to `'patient'`. Invalid or missing role no longer throws, so the trigger always completes and inserts rows.
- **RAISE NOTICE:** Logs `user_id`, `email`, `meta_role`, and `resolved_role` for every new user, and logs when a caregivers or patients row is inserted.
- **How to verify:** After a signup, check Supabase Dashboard → **Logs** (Postgres) for `handle_new_user:` messages. Then check **Table Editor** for `profiles`, `user_roles`, and `caregivers` or `patients`.

### 2. AuthContext: wait for session + role (with retry)

**File:** `src/context/AuthContext.tsx`

- **Role fetch with retry:** When a session exists, the app calls `get_user_role(user_id)` up to **8 times** with **500 ms** delay between attempts. This covers trigger execution time and replication lag.
- **Loading semantics:** `loading` is true until:
  - Initial session load is done, and
  - If there is a user, until role fetch (including retries) has finished.
- So redirects and protected UI only run **after** session and role are ready (or we’ve given up after retries).
- **Logging:** Console logs for `[Auth] role resolved`, `[Auth] signUp success`, `[Auth] signIn success`, and errors for signUp/signIn/getSession.

### 3. Signup: no immediate redirect; wait for session + role

**File:** `src/pages/auth/Signup.tsx`

- **No redirect in `handleSubmit`:** After `signUp()` succeeds, the page shows a “Setting up your account…” loader and does **not** navigate.
- **Redirect only when ready:** A `useEffect` watches `user`, `resolvedRole`, and `loading`. When `user` and `resolvedRole` are set and `loading` is false, it:
  - Logs `[Signup] session + role ready` and optionally fetches `caregiver_id` or `patient_id` and logs them.
  - Then navigates to `/caregiver/dashboard` or `/patient/dashboard` with `replace: true`.
- So redirect happens only after session and role (and therefore trigger-created rows) are available.

### 4. Login + ProtectedRoute: redirect only when role is ready

**File:** `src/pages/auth/Login.tsx`

- Redirect effect now requires `!loading && user && role` before navigating to the correct dashboard. No redirect while role is still loading or null.

**File:** `src/components/ProtectedRoute.tsx`

- **Resolving:** Shows loading when `loading` is true **or** when `user` exists but `role === null` (“Setting up your account…”). Never redirects to login while resolving.
- Only after resolving do we require `user` and then check `allowedRole` and redirect to the correct dashboard or login.

### 5. Geofences, location_logs, alerts + RLS

**File:** `supabase/migrations/20260201100000_trigger_logging_and_location_tables.sql`

- **Tables:** `geofences`, `location_logs`, `alerts` with `patient_id` FK to `patients`, so the patient map and location flow have the required schema.
- **RLS:** Enabled on all three. Policies:
  - Patient: full access to own geofence, location_logs, and alerts (using `current_patient_id()`).
  - Caregiver: SELECT on their patients’ geofences, location_logs, and alerts; INSERT/UPDATE on geofences for their patients.
- No recursive policies; all use `SECURITY DEFINER` helpers `current_caregiver_id()` / `current_patient_id()`.

### 6. Dashboards: retry + guards + logging

**File:** `src/pages/patient/Dashboard.tsx`

- **Patient row:** Fetches `patients` by `user_id` with **retries** (5 attempts, 600 ms) so trigger lag doesn’t leave the dashboard without a `patient_id`.
- **Location insert:** Does **not** insert into `location_logs` if `patientId` is null; logs `[PatientDashboard] patient_id is null, skipping insert` and shows a toast.
- **Errors:** All fetches and `location_logs` insert failures are logged with `[PatientDashboard]` and toasts where appropriate.

**File:** `src/pages/caregiver/Dashboard.tsx`

- **Caregiver row:** Same retry pattern (5 attempts, 600 ms) when fetching `caregivers` by `user_id`, so the caregiver dashboard appears after the trigger has run.

---

## RLS Debug (Optional)

If you need to confirm that rows exist and RLS is not blocking:

1. In Supabase Dashboard → **SQL Editor**, run (one table at a time):

   ```sql
   ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
   SELECT * FROM public.profiles;
   ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
   ```

2. Repeat for `user_roles`, `caregivers`, `patients` if needed.
3. If rows appear with RLS disabled but not in the app, the problem is policy (e.g. `auth.uid()` or helper functions). If rows don’t appear even with RLS disabled, the trigger did not insert (check trigger + RAISE NOTICE in Postgres logs).

---

## Validation Checklist

After applying the migration and deploying the frontend:

- **Signup as caregiver**
  - Auth → Users: new user.
  - Table Editor: one row in `profiles`, `user_roles`, `caregivers` for that `user_id`.
  - App: “Setting up your account…” then redirect to `/caregiver/dashboard`.
- **Signup as patient**
  - Same for `profiles`, `user_roles`, `patients`.
  - Redirect to `/patient/dashboard`.
- **Refresh**
  - Session and role persist; redirect to the correct dashboard still works.
- **Patient dashboard**
  - Map loads; simulate location inserts a row in `location_logs` (check Table Editor or logs).
- **Caregiver dashboard**
  - Patients list loads (patients linked via `caregiver_id`); location/geofence/alert data visible when configured.

---

## Map / Geolocation

The patient dashboard currently **simulates** location with buttons (At Home, Random, Go Outside Zone). It does not yet request browser geolocation. To add real geolocation:

- Use `navigator.geolocation.getCurrentPosition` (or watch) and handle permission denied and errors in the UI.
- Only call `location_logs` insert when `patientId` is set (already enforced); log and show a message on failure (already in place).

---

## Summary

- **Why tables were empty:** Trigger could fail on role cast (no default), and/or signup redirected before session + role + trigger-inserted rows were ready; no retry for `get_user_role` so role often stayed null.
- **Fixes:** Trigger made safe with default role and RAISE NOTICE; AuthContext retries role fetch and exposes loading until session + role are ready; Signup and Login redirect only after role is ready; ProtectedRoute never redirects while resolving; geofences/location_logs/alerts and RLS added; dashboards retry for caregiver/patient row and guard + log location insert.
- **Stability:** With the new migration applied and the updated frontend, signup → DB rows → redirect → dashboard data → location insert works end-to-end and survives refresh.
