create table if not exists public.medicine_verification_attempts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  medicine_id text not null,
  reference_image_url text not null,
  test_image_url text not null,
  similarity_score numeric not null,
  match boolean not null,
  approved boolean not null,
  attempt_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists medicine_verification_attempts_patient_medicine_date_idx
  on public.medicine_verification_attempts (patient_id, medicine_id, attempt_date);
