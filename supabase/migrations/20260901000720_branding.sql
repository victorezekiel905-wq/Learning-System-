-- =============================================================================
-- SwiftCipher — 0720 per-school branding (tenant admins customise their pages)
-- =============================================================================
alter table public.tenant_settings
  add column if not exists brand_name      text check (brand_name is null or length(btrim(brand_name)) between 1 and 80),
  add column if not exists brand_logo_path text check (brand_logo_path is null or length(brand_logo_path) <= 400),
  add column if not exists brand_primary   text check (brand_primary is null or brand_primary ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists brand_accent    text check (brand_accent is null or brand_accent ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists welcome_message text check (welcome_message is null or length(welcome_message) <= 500);

-- The logo must live in this tenant's own media folder.
alter table public.tenant_settings add constraint tenant_settings_logo_in_tenant
  check (brand_logo_path is null or brand_logo_path like tenant_id::text || '/%');

grant update (brand_name, brand_logo_path, brand_primary, brand_accent, welcome_message)
  on public.tenant_settings to authenticated;
