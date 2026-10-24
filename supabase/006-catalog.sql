-- Ejecutar después de 005-public-profiles.sql. No modifica la visibilidad elegida.
begin;
create or replace function birras_private.catalog_key(brand text,name text)
returns text language sql immutable set search_path='' as $$
  select md5(jsonb_build_array(public.beer_normalize(brand),public.beer_normalize(name))::text);
$$;
revoke all on function birras_private.catalog_key(text,text) from public,anon,authenticated;

-- El catálogo es una proyección de reseñas públicas, no una tabla editable.
create or replace view birras_private.catalog as
select birras_private.catalog_key(b.brand,b.name) as key,
  min(b.brand) as brand,min(b.name) as name,
  array_agg(distinct b.style) filter(where nullif(b.style,'') is not null) as styles,
  count(*) as review_count,avg(b.rating) as average,
  count(*) filter(where b.buy_again) as buy_yes,
  count(b.buy_again) as buy_answers,
  (array_agg(b.photo_path order by b.created_at desc,b.id) filter(where b.photo_path is not null))[1] as photo_path,
  public.beer_normalize(string_agg(concat_ws(' ',b.brand,b.name,b.style,
    case public.beer_normalize(b.style) when 'lager' then 'Rubia' when 'pilsner' then 'Pilsen'
      when 'amber lager' then 'Roja' when 'irish red ale' then 'Roja' when 'irish red ale (roja)' then 'Roja' else '' end,
    b.notes,p.username,b.date::text,b.rating::text,
    case b.buy_again when true then 'La volvería a comprar' when false then 'No la volvería a comprar' else '' end), ' ')) as search_text
from public.beers b join public.profiles p on p.user_id=b.user_id
where b.is_public group by birras_private.catalog_key(b.brand,b.name);
revoke all on birras_private.catalog from public,anon,authenticated;

create table if not exists public.beer_wishlist (
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_key text not null check(catalog_key ~ '^[a-f0-9]{32}$'),
  created_at timestamptz not null default now(),
  primary key(user_id,catalog_key)
);
alter table public.beer_wishlist enable row level security;
alter table public.beer_wishlist force row level security;
-- Solo RPC: no se permite escribir una lista ajena ni alterar la fecha.
revoke all on public.beer_wishlist from public,anon,authenticated;

create or replace function public.birras_catalog(search_text text default '',page_offset integer default 0)
returns jsonb language sql stable security definer set search_path='' as $$
  with matches as (
    select to_jsonb(c)-'search_text' as item,c.average,c.key from birras_private.catalog c
    where not exists(select 1 from regexp_split_to_table(public.beer_normalize(left(coalesce($1,''),120)),E'\\s+') term
      where term<>'' and position(term in c.search_text)=0)
  ) select jsonb_build_object('total',(select count(*) from matches),'items',coalesce((
    select jsonb_agg(item order by average desc,key) from (
      select * from matches order by average desc,key limit 20 offset greatest(0,least(coalesce(page_offset,0),10000))
    ) page),'[]'::jsonb));
$$;

create or replace function public.birras_catalog_detail(beer_key text,page_offset integer default 0)
returns jsonb language sql stable security definer set search_path='' as $$
  select (to_jsonb(c)-'search_text') || jsonb_build_object(
    'saved',exists(select 1 from public.beer_wishlist w where w.user_id=auth.uid() and w.catalog_key=c.key),
    'tried',exists(select 1 from public.beers b where b.user_id=auth.uid() and birras_private.catalog_key(b.brand,b.name)=c.key),
    'reviews',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from (
      select b.id,b.rating,b.notes,b.date,b.style,b.buy_again,b.photo_path,b.created_at,p.username
      from public.beers b join public.profiles p on p.user_id=b.user_id
      where b.is_public and birras_private.catalog_key(b.brand,b.name)=c.key
      order by b.created_at desc,b.id limit 20 offset greatest(0,least(coalesce(page_offset,0),10000))
    ) r),'[]'::jsonb)) from birras_private.catalog c where c.key=beer_key;
$$;

create or replace function public.birras_wishlist(profile_name text,page_offset integer default 0)
returns jsonb language sql stable security definer set search_path='' as $$
  with visible as (
    select to_jsonb(c)-'search_text' as item,w.created_at,c.key
    from public.beer_wishlist w join public.profiles p on p.user_id=w.user_id
    join birras_private.catalog c on c.key=w.catalog_key
    where p.username=lower(left(btrim(profile_name),40))
  ) select jsonb_build_object('total',(select count(*) from visible),'items',coalesce((
    select jsonb_agg(item order by created_at desc,key) from (
      select * from visible order by created_at desc,key limit 20 offset greatest(0,least(coalesce(page_offset,0),10000))
    ) page),'[]'::jsonb));
$$;

create or replace function public.birras_set_wishlist(beer_key text,wanted boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or not exists(
    select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null
  ) then raise insufficient_privilege; end if;
  if wanted is null then raise exception 'Elegí si querés guardarla.'; end if;
  perform birras_private.consume_action('wishlist-write',30,300);
  if wanted then
    if not exists(select 1 from birras_private.catalog where key=beer_key) then raise exception 'Esta birra ya no tiene reseñas públicas.'; end if;
    if exists(select 1 from public.beers b where b.user_id=auth.uid() and birras_private.catalog_key(b.brand,b.name)=beer_key)
      then raise exception 'Esta birra ya está entre las que probaste.'; end if;
    if (select count(*) from public.beer_wishlist where user_id=auth.uid())>=1000 and not exists(
      select 1 from public.beer_wishlist where user_id=auth.uid() and catalog_key=beer_key
    ) then raise exception 'Tu lista ya tiene 1000 birras.'; end if;
    insert into public.beer_wishlist(user_id,catalog_key) values(auth.uid(),beer_key) on conflict do nothing;
  else
    delete from public.beer_wishlist where user_id=auth.uid() and catalog_key=beer_key;
  end if;
end $$;

-- Incluso una reseña privada cuenta como probada, sin publicar esa información.
create or replace function birras_private.clear_tried_wishlist()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from public.beer_wishlist where user_id=new.user_id
    and catalog_key=birras_private.catalog_key(new.brand,new.name);
  return new;
end $$;
revoke all on function birras_private.clear_tried_wishlist() from public,anon,authenticated;
drop trigger if exists birras_clear_tried_wishlist on public.beers;
create trigger birras_clear_tried_wishlist after insert or update on public.beers
  for each row execute function birras_private.clear_tried_wishlist();

revoke all on function public.birras_catalog(text,integer),public.birras_catalog_detail(text,integer),public.birras_wishlist(text,integer),public.birras_set_wishlist(text,boolean) from public,anon,authenticated;
grant execute on function public.birras_catalog(text,integer),public.birras_catalog_detail(text,integer),public.birras_wishlist(text,integer) to anon,authenticated;
grant execute on function public.birras_set_wishlist(text,boolean) to authenticated;
commit;
