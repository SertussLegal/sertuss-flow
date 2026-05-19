-- Defensive re-backfill of core modules for all existing orgs
insert into public.organization_modules(organization_id, module_slug, enabled)
select o.id, m.slug, true
from public.organizations o
cross join public.modules m
where m.is_core = true
on conflict do nothing;