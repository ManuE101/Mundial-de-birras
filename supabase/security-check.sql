-- Verificación de aislamiento. Ejecutar DESPUÉS de 004-security.sql.
-- Crea dos usuarios de prueba dentro de una transacción y revierte TODO al finalizar.
-- Si alguna prueba falla, ejecutar ROLLBACK; antes de volver a intentar.
begin;
insert into auth.users(id,email,email_confirmed_at,aud,role,created_at,updated_at)
values
 ('a1111111-1111-4111-8111-111111111111','birras-security-a@example.invalid',now(),'authenticated','authenticated',now(),now()),
 ('b2222222-2222-4222-8222-222222222222','birras-security-b@example.invalid',now(),'authenticated','authenticated',now(),now());

select set_config('request.jwt.claims','{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
insert into public.beers(id,brand,name,rating,notes)
values('c3333333-3333-4333-8333-333333333333','Prueba de seguridad','Solo A',0,'No debe verla B');
do $$ begin
  if (select count(*) from public.beers where id='c3333333-3333-4333-8333-333333333333') <> 1 then raise exception 'FALLO: A no puede leer su registro'; end if;
  begin
    insert into public.beers(user_id,brand,name,rating) values('b2222222-2222-4222-8222-222222222222','Prueba','Propietario falso',5);
    raise exception 'FALLO: se permitió suplantar al propietario';
  exception when insufficient_privilege then null; end;
  begin
    update public.beers set user_id='b2222222-2222-4222-8222-222222222222' where id='c3333333-3333-4333-8333-333333333333';
    raise exception 'FALLO: se permitió transferir el propietario';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.beers(brand,name,rating) values('Prueba','Nota inválida',11);
    raise exception 'FALLO: se permitió puntaje 11';
  exception when check_violation then null; end;
  begin
    insert into public.beers(brand,name,rating,photo_path) values('Prueba','Foto ajena',5,'b2222222-2222-4222-8222-222222222222/d4444444-4444-4444-8444-444444444444.jpg');
    raise exception 'FALLO: se permitió una ruta de foto ajena';
  exception when check_violation then null; end;
  begin
    insert into storage.objects(bucket_id,name) values('beer-photos','b2222222-2222-4222-8222-222222222222/d4444444-4444-4444-8444-444444444444.jpg');
    raise exception 'FALLO: se permitió subir una foto a otra cuenta';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claims','{"sub":"b2222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
set local role authenticated;
do $$ declare touched integer; begin
  if exists(select 1 from public.beers where id='c3333333-3333-4333-8333-333333333333') then raise exception 'FALLO: B puede leer a A'; end if;
  update public.beers set notes='Ataque' where id='c3333333-3333-4333-8333-333333333333';
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'FALLO: B puede editar a A'; end if;
  delete from public.beers where id='c3333333-3333-4333-8333-333333333333';
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'FALLO: B puede borrar a A'; end if;
end $$;
reset role;

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin
  begin
    perform 1 from public.beers;
    raise exception 'FALLO: acceso anónimo a la tabla privada';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Debe retornar false en las cuatro columnas.
select has_schema_privilege('authenticated','birras_private','USAGE') as private_schema_access,
 has_table_privilege('anon','public.beers','SELECT') as anonymous_read,
 has_function_privilege('authenticated','birras_private.consume_action(text,integer,integer)','EXECUTE') as quota_function_access,
 (select public from storage.buckets where id='beer-photos') as photos_public;
rollback;
select 'Pruebas de aislamiento completadas; fixtures revertidos.' as result;
