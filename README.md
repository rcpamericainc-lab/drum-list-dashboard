This is a mobile-first trucking and delivery order management app built with Next.js App Router and Supabase.

## Getting Started

## Local setup

Copy `.env.example` to `.env.local` and fill in the Supabase project URL and anon key.

Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

## Supabase schema

The initial database schema and RLS policies live in `supabase/migrations/20260706161000_initial_schema.sql`.

After applying the migration, create Supabase Auth users, then insert matching rows in:

- `user_profiles` with `role = 'driver'` or `role = 'office'`
- `drivers` for driver users
- `driver_trucks` for each assigned truck number

The default cutoff rule inserted by the migration is Thursday at 5:00 PM America/New_York.
