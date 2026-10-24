const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {PGlite} = require('@electric-sql/pglite');

// PostgreSQL real embebido; auth/storage se reproducen solo con las columnas usadas.
// No sustituye el servicio de Storage ni sus procesos de subida reales.
async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    grant usage on schema public,auth,storage to anon,authenticated;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,aud text,role text,created_at timestamptz,updated_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
    create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
  `);
  await db.exec(fs.readFileSync('supabase/setup.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/004-security.sql','utf8'));
  return db;
}

test('catalog groups beers, searches across public fields and protects wishlists and private reviews', async()=>{
  const db=await database();
  const a='a1111111-1111-4111-8111-111111111111',b='b2222222-2222-4222-8222-222222222222';
  const rpc=async(sql,args=[])=>(await db.query(sql,args)).rows[0].value;
  const as=async(role,id)=>db.exec(`reset role; select set_config('request.jwt.claims','${JSON.stringify({role,...(id?{sub:id}:{})})}',false); set role ${role};`);
  try {
    await db.exec(fs.readFileSync('supabase/005-public-profiles.sql','utf8'));
    await db.exec(fs.readFileSync('supabase/006-catalog.sql','utf8'));
    await db.exec(`insert into auth.users(id,email_confirmed_at) values('${a}',now()),('${b}',now());
      update public.profiles set username=case user_id when '${a}' then 'manu' else 'amigo' end;
      insert into public.beers(user_id,brand,name,style,rating,notes,is_public,buy_again) values
      ('${a}','Patagónia','Roja','Amber Lager',8,'Caramelo de lata',true,true),
      ('${b}',' patagonia ','roja','Roja',6,'Botella',true,false),
      ('${a}','Secreta','Privada','IPA',1,'Palabrasecreta',false,null);`);
    await as('anon');
    let result=await rpc(`select public.birras_catalog('PATAGONIA caramelo MANU') as value`);
    assert.equal(result.total,1);const key=result.items[0].key;
    assert.equal(result.items[0].review_count,2);assert.equal(result.items[0].average,7);
    assert.equal((await rpc(`select public.birras_catalog('palabrasecreta') as value`)).total,0);
    assert.equal((await rpc(`select public.birras_catalog('%') as value`)).total,0);
    let detail=await rpc(`select public.birras_catalog_detail($1) as value`,[key]);
    assert.equal(detail.buy_answers,2);assert.equal(detail.buy_yes,1);
    assert.ok(detail.reviews.every(r=>!('drunk' in r)&&!('user_id' in r)));
    await assert.rejects(db.query(`select public.birras_set_wishlist($1,true)`,[key]),/permission denied/);
    await assert.rejects(db.query('select * from public.beer_wishlist'),/permission denied/);
    await as('authenticated',a);
    await assert.rejects(db.query(`select public.birras_set_wishlist($1,true)`,[key]),/ya está/);
    await db.exec("reset role; select set_config('request.jwt.claims','{}',false);");
    await db.exec(`insert into public.beers(user_id,brand,name,rating,is_public) values('${b}','Otra','Nueva',9,true)`);
    await as('anon');
    const other=(await rpc(`select public.birras_catalog('otra') as value`)).items[0].key;
    await as('authenticated',a);
    await db.query(`select public.birras_set_wishlist($1,true)`,[other]);
    await db.query(`select public.birras_set_wishlist($1,true)`,[other]);
    await as('anon');
    assert.equal((await rpc(`select public.birras_wishlist('manu') as value`)).total,1);
    await as('authenticated',b);
    await db.query(`select public.birras_set_wishlist($1,false)`,[other]);
    assert.equal((await rpc(`select public.birras_wishlist('manu') as value`)).total,1);
    await db.exec(`update public.beers set is_public=false where brand='Otra'`);
    await as('anon');
    assert.equal((await rpc(`select public.birras_wishlist('manu') as value`)).total,0);
    assert.equal(await rpc(`select public.birras_catalog_detail($1) as value`,[other]),null);
    await as('authenticated',b);
    await db.exec(`update public.beers set is_public=true where brand='Otra'`);
    await as('authenticated',a);
    await db.exec(`insert into public.beers(brand,name,rating,is_public) values('OTRA','NUEVA',2,false)`);
    assert.equal((await rpc(`select public.birras_wishlist('manu') as value`)).total,0);
    detail=await rpc(`select public.birras_catalog_detail($1) as value`,[other]);
    assert.equal(detail.tried,true);assert.equal(detail.average,9);
    await as('anon');
    detail=await rpc(`select public.birras_catalog_detail($1) as value`,[other]);
    assert.equal(detail.tried,false);assert.equal(detail.review_count,1);
    // Reaplicar la migración conserva datos y permisos.
    await db.exec('reset role');
    await db.exec(fs.readFileSync('supabase/006-catalog.sql','utf8'));
  } finally {await db.close();}
});
test('database isolation script executes successfully and leaves no fixtures', async () => {
  const db=await database();
  try {
    const results=await db.exec(fs.readFileSync('supabase/security-check.sql','utf8'));
    assert.match(results.at(-1).rows[0].result,/completadas/);
    assert.equal((await db.query('select count(*)::integer as n from auth.users')).rows[0].n,0);
  } finally { await db.close(); }
});
test('server throttles excessive writes even when bypassing the frontend', async () => {
  const db=await database();
  try {
    await db.exec(`begin;
      insert into auth.users(id,email_confirmed_at) values('a1111111-1111-4111-8111-111111111111',now());
      select set_config('request.jwt.claims','{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
      set local role authenticated;`);
    await assert.rejects(db.exec(`insert into public.beers(brand,name,rating) select 'Marca','Birra '||n,5 from generate_series(1,121) n;`),/Demasiadas operaciones/);
    await db.exec('rollback;');
  } finally { await db.close(); }
});
test('unconfirmed users cannot write and confirmed users can upload only their own photos', async () => {
  const db=await database();
  try {
    await db.exec(`begin;
      insert into auth.users(id) values('a1111111-1111-4111-8111-111111111111');
      select set_config('request.jwt.claims','{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
      set local role authenticated;`);
    await assert.rejects(db.exec(`insert into public.beers(brand,name,rating) values('Marca','Birra',5);`),/Confirmá/);
    await db.exec('rollback;');
    await db.exec(`begin;
      insert into auth.users(id,email_confirmed_at) values('a1111111-1111-4111-8111-111111111111',now());
      select set_config('request.jwt.claims','{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
      set local role authenticated;
      insert into storage.objects(bucket_id,name,metadata) values('beer-photos','a1111111-1111-4111-8111-111111111111/d4444444-4444-4444-8444-444444444444.jpg','{"size":1024}');`);
    const update=await db.query(`update storage.objects set name='a1111111-1111-4111-8111-111111111111/e5555555-5555-4555-8555-555555555555.jpg' returning id;`);
    assert.equal(update.rows.length,0);
    await db.exec('rollback;');
  } finally { await db.close(); }
});

test('public profiles expose only shared reviews; switching to private revokes review and photo access', async () => {
  const db=await database();
  const actor='a1111111-1111-4111-8111-111111111111';
  const photo=`${actor}/d4444444-4444-4444-8444-444444444444.jpg`;
  try {
    // Una reseña anterior a la migración debe hacerse pública por la decisión explícita del producto.
    await db.exec(`insert into auth.users(id,email,email_confirmed_at) values('${actor}','private@example.invalid',now());
      insert into public.beers(id,user_id,brand,name,rating,notes,drunk,photo_path) values('c3333333-3333-4333-8333-333333333333','${actor}','Marca','Antes de migrar',8,'Opinión pública',true,'${photo}');
      insert into storage.objects(bucket_id,name,metadata) values('beer-photos','${photo}','{"size":100}');`);
    await db.exec(fs.readFileSync('supabase/005-public-profiles.sql','utf8'));
    const temporary='birrero_'+actor.replaceAll('-','');
    await db.exec(`begin; select set_config('request.jwt.claims','{"role":"anon"}',true); set local role anon;`);
    let profile=(await db.query(`select public.birras_public_profile($1) as value;`,[temporary])).rows[0].value;
    assert.equal(profile.review_count,1);
    assert.equal(profile.reviews[0].notes,'Opinión pública');
    assert.equal(profile.reviews[0].drunk,undefined);
    assert.equal(profile.email,undefined);
    assert.equal(profile.reviews[0].user_id,undefined);
    assert.equal((await db.query(`select count(*)::integer n from storage.objects where name=$1`,[photo])).rows[0].n,1);
    await db.exec('reset role; commit;');
    await db.exec(`begin; select set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true); set local role authenticated;
      update public.beers set is_public=false where user_id='${actor}';
      update public.profiles set username='manubirrero' where user_id='${actor}'; reset role; commit;`);
    await db.exec(`begin; select set_config('request.jwt.claims','{"role":"anon"}',true); set local role anon;`);
    profile=(await db.query(`select public.birras_public_profile('manubirrero') as value`)).rows[0].value;
    assert.equal(profile.review_count,0);
    assert.equal(profile.average,null);
    assert.equal(profile.reviews.length,0);
    assert.equal((await db.query(`select count(*)::integer n from storage.objects where name=$1`,[photo])).rows[0].n,0);
    await db.exec('reset role; commit;');
    // Reaplicar no puede volver a publicar una reseña que el dueño privatizó.
    await db.exec(fs.readFileSync('supabase/005-public-profiles.sql','utf8'));
    assert.equal((await db.query(`select is_public from public.beers`)).rows[0].is_public,false);
    // El script que se entrega para SQL Editor también debe poder ejecutarse completo.
    await db.exec(`delete from auth.users where id='${actor}';`);
    const check=await db.exec(fs.readFileSync('supabase/public-profiles-check.sql','utf8'));
    assert.match(check.at(-1).rows[0].result,/completadas/);
  } finally { await db.close(); }
});

test('new accounts get unique profiles; username changes and avatar writes remain owner-only', async () => {
  const db=await database();
  const a='a1111111-1111-4111-8111-111111111111',b='b2222222-2222-4222-8222-222222222222';
  try {
    await db.exec(fs.readFileSync('supabase/005-public-profiles.sql','utf8'));
    await db.exec(`insert into auth.users(id,email_confirmed_at) values('${a}',now()),('${b}',now());`);
    assert.equal((await db.query('select count(*)::integer n from public.profiles')).rows[0].n,2);
    await db.exec(`begin; select set_config('request.jwt.claims','{"sub":"${a}","role":"authenticated"}',true); set local role authenticated;
      update public.profiles set username='usuario_a' where user_id='${a}';`);
    assert.equal((await db.query(`update public.profiles set username='ataque' where user_id='${b}' returning username`)).rows.length,0);
    await db.exec('reset role; commit;');
    await db.exec(`begin; select set_config('request.jwt.claims','{"sub":"${b}","role":"authenticated"}',true); set local role authenticated;`);
    await assert.rejects(db.exec(`update public.profiles set username='usuario_a' where user_id='${b}'`),/unique/i);
    await db.exec('rollback;');
    await db.exec(`begin; select set_config('request.jwt.claims','{"sub":"${a}","role":"authenticated"}',true); set local role authenticated;`);
    await assert.rejects(db.exec(`update public.profiles set avatar_path='${b}/d4444444-4444-4444-8444-444444444444.jpg' where user_id='${a}'`),/check constraint/i);
    await db.exec('rollback;');
    // La tabla original sigue privada aunque los perfiles tengan una API pública.
    await db.exec(`begin; select set_config('request.jwt.claims','{"role":"anon"}',true); set local role anon;`);
    await assert.rejects(db.query('select * from public.profiles'),/permission denied/i);
    await db.exec('rollback;');
  } finally { await db.close(); }
});
