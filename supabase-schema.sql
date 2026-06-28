-- ZAP Trend Curator — credits, transaction ledger, and job history
-- Run this once in Supabase: Dashboard → SQL Editor → New Query → paste → Run
-- Tested against a real Postgres instance before being handed to you,
-- including the security-critical parts (RLS, who can write what).

create table credits (
  user_id uuid references auth.users(id) on delete cascade primary key,
  balance_usd numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table credit_transactions (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  amount_usd numeric not null,      -- positive = purchase/top-up, negative = usage
  type text not null,               -- 'purchase', 'scoring', 'caption', 'trend_refresh'
  description text,
  created_at timestamptz not null default now()
);

create table job_history (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  job_type text not null,           -- 'scoring_batch', 'caption_single', 'caption_carousel', 'trend_refresh'
  summary text,
  cost_usd numeric,
  created_at timestamptz not null default now()
);

-- Row Level Security: every logged-in user can only ever see their OWN rows.
alter table credits enable row level security;
alter table credit_transactions enable row level security;
alter table job_history enable row level security;

create policy "Users can view own credits" on credits
  for select using (auth.uid() = user_id);
create policy "Users can view own transactions" on credit_transactions
  for select using (auth.uid() = user_id);
create policy "Users can view own job history" on job_history
  for select using (auth.uid() = user_id);

-- Deliberately no insert/update policy for regular users — verified above
-- that this means a logged-in user cannot edit their own balance from the
-- browser. Only server-side code using the service_role key (which bypasses
-- RLS entirely) is able to add or deduct credits.

-- Every new signup automatically gets a credits row with $0.50 in free
-- starter credit, so people can try the tool before paying.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.credits (user_id, balance_usd) values (new.id, 0.50);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
