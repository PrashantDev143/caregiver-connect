# Fix "Too many signup attempts" – Supabase rate limit

You're hitting **Supabase's auth email rate limit**. Signup (and password recovery) send emails, and Supabase limits how many can be sent per hour (default is low, e.g. 2/hour on free tier). Same limit applies for **both** Caregiver and Patient – it's per project, not per role.

---

## Option 1: Disable email confirmation (best for development)

If you don't need "confirm your email" during development, turn it off. Then signup **won't send an email** and won't hit the rate limit.

### Step-by-step

1. Open **Supabase Dashboard**: https://supabase.com/dashboard  
2. Select your project (the one in your `.env`: `yvknoxijjccmkrgburfn`).  
3. In the left sidebar, go to **Authentication** → **Providers**.  
4. Click the **Email** provider.  
5. Find **"Confirm email"** and **turn it OFF** (toggle to disabled).  
6. Click **Save**.  

After this, new signups will get a session immediately (no confirmation email), so you can test Caregiver and Patient signup without hitting the limit.

**Turn "Confirm email" back ON** when you want to require verification in production.

---

## Option 2: Check / adjust rate limits (Dashboard)

You can see (and sometimes adjust) limits in the dashboard.

### Step-by-step

1. Go to **Supabase Dashboard** → your project.  
2. Left sidebar: **Authentication** → **Rate Limits**  
   - Direct link format: `https://supabase.com/dashboard/project/YOUR_PROJECT_REF/auth/rate-limits`  
   - Replace `YOUR_PROJECT_REF` with your project ref (e.g. `yvknoxijjccmkrgburfn`).  
3. Check **Email**-related limits (e.g. emails sent per hour).  
4. If the page lets you increase them, you can raise the limit.  
5. **Note:** On Supabase’s built-in email, the default (e.g. 2/hour) often can’t be increased unless you use **custom SMTP**.  

So for immediate relief in dev, **Option 1 (disable confirm email)** is usually best.

---

## Option 3: Wait for the limit to reset

Rate limits reset after a period (often about **1 hour**). If you don’t change any settings:

- Wait **~60 minutes** and try signup again with the same or a new email.  
- Use only **one or two** signup attempts per hour while the limit is low.  

---

## Option 4: Use custom SMTP (production)

For production, if you need both email confirmation and more signups per hour:

1. **Authentication** → **Providers** → **Email**.  
2. Configure **Custom SMTP** (e.g. SendGrid, Mailgun, Resend) with your own credentials.  
3. With custom SMTP, you can often configure higher or different rate limits.  

---

## Summary

| Goal                         | Action |
|-----------------------------|--------|
| Keep developing now         | **Disable "Confirm email"** (Option 1). |
| Just need one more signup    | **Wait ~1 hour** (Option 3). |
| See current limits          | **Auth → Rate Limits** (Option 2). |
| Production + many signups   | **Custom SMTP** (Option 4). |

The error is **not** caused by Patient vs Caregiver or by your app code – it’s Supabase’s auth email rate limit. Disabling confirmation in dev (Option 1) is the fastest way to get signup working again for both roles.
