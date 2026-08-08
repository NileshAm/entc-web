-- Registration is a distinct phase before a bidding session becomes live.
-- PostgreSQL requires a newly-added enum value to be committed before it is
-- referenced by functions, so the behavior changes live in the next migration.

alter type public.company_status
add value if not exists 'registration_open' after 'upcoming';
