-- Después de 006. Cupo de prueba: 2/minuto y 5/día por cuenta, 20/día en total.
begin;
create table if not exists birras_private.scan_budget(day date primary key,used integer not null check(used>=0));
revoke all on birras_private.scan_budget from public,anon,authenticated;
create or replace function public.birras_reserve_scan()
returns boolean language plpgsql security definer set search_path='' as $$
declare used_today integer;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null or not exists(
    select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null
  ) then raise insufficient_privilege; end if;
  perform pg_advisory_xact_lock(723410,1);
  perform birras_private.consume_action('image-scan',2,5);
  insert into birras_private.scan_budget values((now() at time zone 'UTC')::date,1)
  on conflict(day) do update set used=scan_budget.used+1 where scan_budget.used<20
  returning used into used_today;
  return used_today is not null;
end $$;
revoke all on function public.birras_reserve_scan() from public,anon,authenticated;
grant execute on function public.birras_reserve_scan() to authenticated;
commit;
