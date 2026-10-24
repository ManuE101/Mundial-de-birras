-- Ejecutar después de 005-public-profiles.sql. Revierte todos los datos ficticios.
-- Ante cualquier error, ejecutar ROLLBACK; antes de volver a intentar.
begin;
insert into auth.users(id,email,email_confirmed_at,aud,role,created_at,updated_at)
values('a1111111-1111-4111-8111-111111111111','perfil-prueba@example.invalid',now(),'authenticated','authenticated',now(),now());
insert into public.beers(id,user_id,brand,name,rating,notes,is_public)
values
 ('c3333333-3333-4333-8333-333333333333','a1111111-1111-4111-8111-111111111111','Prueba','Compartida',8,'Texto público',true),
 ('d4444444-4444-4444-8444-444444444444','a1111111-1111-4111-8111-111111111111','Prueba','Privada',2,'Texto secreto',false);
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ declare profile jsonb; begin
  select public.birras_public_profile('birrero_'||replace('a1111111-1111-4111-8111-111111111111','-','')) into profile;
  if (profile->>'review_count')::integer <> 1 then raise exception 'FALLO: cuenta pública incorrecta'; end if;
  if (profile->>'average')::numeric <> 8 then raise exception 'FALLO: se incluyó una reseña privada en el promedio'; end if;
  if profile::text like '%Texto secreto%' or profile ? 'email' then raise exception 'FALLO: se expusieron datos privados'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
update public.beers set is_public=false where id='c3333333-3333-4333-8333-333333333333';
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ declare profile jsonb; begin
  select public.birras_public_profile('birrero_'||replace('a1111111-1111-4111-8111-111111111111','-','')) into profile;
  if (profile->>'review_count')::integer <> 0 or jsonb_array_length(profile->'reviews') <> 0 then raise exception 'FALLO: sigue visible una reseña privatizada'; end if;
end $$;
reset role;
rollback;
select 'Pruebas de perfiles y privacidad completadas; datos ficticios revertidos.' as result;
