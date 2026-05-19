
-- Catálogo global de módulos
create table public.modules (
  slug text primary key,
  name text not null,
  description text,
  is_core boolean not null default false,
  created_at timestamptz not null default now()
);

-- Flags por organización
create table public.organization_modules (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_slug text not null references public.modules(slug) on delete cascade,
  enabled boolean not null default true,
  enabled_at timestamptz not null default now(),
  enabled_by uuid,
  primary key (organization_id, module_slug)
);

alter table public.modules enable row level security;
alter table public.organization_modules enable row level security;

-- Cualquier autenticado lee el catálogo de módulos
create policy "modules readable by authenticated"
  on public.modules for select to authenticated using (true);

-- Miembros de la org leen sus propios flags
create policy "org members read their modules"
  on public.organization_modules for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.organization_id = organization_modules.organization_id
    )
  );

-- Escritura solo vía SECURITY DEFINER (admin_toggle_module)
-- No creamos policies INSERT/UPDATE/DELETE para authenticated → bloqueado.

-- Seed del catálogo
insert into public.modules(slug, name, description, is_core) values
  ('escrituras', 'Escrituras', 'Generación de escrituras públicas', true),
  ('cancelaciones', 'Cancelaciones', 'Cancelaciones de hipoteca y patrimonio', false)
on conflict (slug) do nothing;

-- Backfill: activar módulos core para todas las orgs existentes
insert into public.organization_modules(organization_id, module_slug, enabled)
select o.id, m.slug, true
from public.organizations o
cross join public.modules m
where m.is_core = true
on conflict do nothing;

-- Trigger: nuevas organizaciones reciben los core
create or replace function public.assign_core_modules_on_org_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organization_modules(organization_id, module_slug, enabled)
  select NEW.id, m.slug, true
  from public.modules m
  where m.is_core = true
  on conflict do nothing;
  return NEW;
end;
$$;

create trigger trg_assign_core_modules
after insert on public.organizations
for each row execute function public.assign_core_modules_on_org_insert();

-- Toggle SuperAdmin
create or replace function public.admin_toggle_module(
  p_org_id uuid, p_slug text, p_enabled boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.get_user_role(auth.uid()) <> 'owner' then
    raise exception 'Unauthorized';
  end if;

  insert into public.organization_modules(organization_id, module_slug, enabled, enabled_by, enabled_at)
  values (p_org_id, p_slug, p_enabled, auth.uid(), now())
  on conflict (organization_id, module_slug)
    do update set enabled = excluded.enabled,
                  enabled_by = auth.uid(),
                  enabled_at = now();

  insert into public.activity_logs(organization_id, user_id, action, entity_type, entity_id, metadata)
  values (p_org_id, auth.uid(), 'MODULE_TOGGLE', 'organization', p_org_id,
          jsonb_build_object('slug', p_slug, 'enabled', p_enabled));
end;
$$;
