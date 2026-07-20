revoke all privileges
on all tables in schema public
from public, anon, authenticated;

alter default privileges in schema public
revoke all privileges on tables from public, anon, authenticated;

-- Function EXECUTE defaults are global for the creating role. A schema-scoped
-- revoke cannot override PostgreSQL's built-in PUBLIC execute default.
alter default privileges
revoke execute on functions from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$$;
