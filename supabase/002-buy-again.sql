-- Ejecutar en SQL Editor antes de publicar esta versión.
-- Las birras existentes quedan con Sin indicar (NULL).
alter table public.beers add column if not exists buy_again boolean;
