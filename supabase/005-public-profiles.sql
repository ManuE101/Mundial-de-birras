-- Ejecutar después de 004-security.sql.
-- Decisión del producto: TODAS las reseñas ya existentes pasan a públicas.
-- Una vez aplicada, las consultas públicas de este archivo están disponibles sin sesión.
begin;
alter table public.beers add column if not exists is_public boolean not null default true;
create index if not exists beers_shared_profile_idx on public.beers(user_id,created_at desc,id) where is_public;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,40}$'),
  avatar_path text check (avatar_path is null or (
    split_part(avatar_path,'/',1)=user_id::text and avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
  )),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
revoke all on public.profiles from public,anon,authenticated;
grant select on public.profiles to authenticated;
grant update(username,avatar_path) on public.profiles to authenticated;
drop policy if exists profiles_owner on public.profiles;
create policy profiles_owner on public.profiles for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists profiles_owner_guard on public.profiles;
create policy profiles_owner_guard on public.profiles as restrictive for all to public
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

insert into public.profiles(user_id,username,created_at)
select id,'birrero_'||replace(id::text,'-',''),coalesce(created_at,now()) from auth.users
on conflict(user_id) do nothing;
create or replace function birras_private.create_profile()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(user_id,username,created_at)
    values(new.id,'birrero_'||replace(new.id::text,'-',''),coalesce(new.created_at,now())) on conflict(user_id) do nothing;
  return new;
end $$;
revoke all on function birras_private.create_profile() from public,anon,authenticated;
drop trigger if exists birras_create_profile on auth.users;
create trigger birras_create_profile after insert on auth.users for each row execute function birras_private.create_profile();

create or replace function birras_private.guard_profile_write()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'authenticated' then return new; end if;
  if new.user_id<>auth.uid() or new.user_id<>old.user_id or new.created_at<>old.created_at then raise insufficient_privilege; end if;
  if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise insufficient_privilege; end if;
  perform birras_private.consume_action('profile-write',10,50);
  return new;
end $$;
revoke all on function birras_private.guard_profile_write() from public,anon,authenticated;
drop trigger if exists birras_profile_write on public.profiles;
create trigger birras_profile_write before update on public.profiles for each row execute function birras_private.guard_profile_write();

-- API pública con proyección explícita: nunca retorna email, auth.users ni campos privados.
-- SECURITY DEFINER es intencional: la tabla de reseñas conserva acceso exclusivo del dueño.
create or replace function public.birras_public_profile(profile_name text,page_offset integer default 0)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'username',p.username,'avatar_path',p.avatar_path,'created_at',p.created_at,
    'review_count',(select count(*) from public.beers b where b.user_id=p.user_id and b.is_public),
    'average',(select avg(rating) from public.beers b where b.user_id=p.user_id and b.is_public),
    'reviews',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from (
      select b.id,b.brand,b.name,b.style,b.rating,b.notes,b.date,b.buy_again,b.photo_path,b.created_at
      from public.beers b where b.user_id=p.user_id and b.is_public
      order by b.created_at desc,b.id limit 20 offset greatest(0,least(coalesce(page_offset,0),10000))
    ) r),'[]'::jsonb)
  ) from public.profiles p where p.username=lower(left(btrim(profile_name),40));
$$;
revoke all on function public.birras_public_profile(text,integer) from public;
grant execute on function public.birras_public_profile(text,integer) to anon,authenticated;

create or replace function public.birras_public_profiles(search_name text default '',after_name text default '')
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(p) order by p.username),'[]'::jsonb) from (
    select username,avatar_path,created_at from public.profiles
    where username>left(coalesce(after_name,''),40)
      and left(username,length(left(btrim(coalesce(search_name,'')),40)))=lower(left(btrim(coalesce(search_name,'')),40))
    order by username limit 20
  ) p;
$$;
revoke all on function public.birras_public_profiles(text,text) from public;
grant execute on function public.birras_public_profiles(text,text) to anon,authenticated;

-- Solo autoriza fotos referenciadas por una reseña pública o un avatar público.
create or replace function public.birras_photo_is_public(object_path text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.beers where is_public and photo_path=object_path)
      or exists(select 1 from public.profiles where avatar_path=object_path);
$$;
revoke all on function public.birras_photo_is_public(text) from public;
grant execute on function public.birras_photo_is_public(text) to anon,authenticated;
create index if not exists beers_shared_photo_idx on public.beers(photo_path) where is_public and photo_path is not null;
create index if not exists profiles_avatar_idx on public.profiles(avatar_path) where avatar_path is not null;

-- Cambiar la política restrictiva anterior sin ampliar permisos de escritura.
drop policy if exists beer_photos_private_guard on storage.objects;
drop policy if exists beer_photos_read_guard on storage.objects;
create policy beer_photos_read_guard on storage.objects as restrictive for select to public
  using(bucket_id<>'beer-photos' or (storage.foldername(name))[1]=(select auth.uid()::text) or public.birras_photo_is_public(name));
drop policy if exists beer_photos_shared_read on storage.objects;
create policy beer_photos_shared_read on storage.objects for select to anon,authenticated
  using(bucket_id='beer-photos' and public.birras_photo_is_public(name));
drop policy if exists beer_photos_insert_guard on storage.objects;
create policy beer_photos_insert_guard on storage.objects as restrictive for insert to public
  with check(bucket_id<>'beer-photos' or (storage.foldername(name))[1]=(select auth.uid()::text));
drop policy if exists beer_photos_delete_guard on storage.objects;
create policy beer_photos_delete_guard on storage.objects as restrictive for delete to public
  using(bucket_id<>'beer-photos' or (storage.foldername(name))[1]=(select auth.uid()::text));
-- El guard de UPDATE, las cuotas y el bucket privado de 004 se mantienen.
commit;
