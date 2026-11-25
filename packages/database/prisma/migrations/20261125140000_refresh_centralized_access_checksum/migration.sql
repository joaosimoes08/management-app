-- 20260829120000_centralized_access_groups was wrapped in BEGIN/COMMIT for
-- Prisma 7 (which commits every statement on its own); its SQL body is
-- unchanged. Installs that applied the original file still store the old
-- checksum. `migrate deploy` ignores that, but `migrate dev` would ask to reset
-- the database, so record the new checksum. No-op on fresh installs and on the
-- shadow database (which has no _prisma_migrations table).
DO $$
BEGIN
  IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
    UPDATE "_prisma_migrations"
    SET "checksum" = 'a0104e33e32e50032fc2f2bb831b665d82d5f3f2d0fcdd430f7cfc733874caf9'
    WHERE "migration_name" = '20260829120000_centralized_access_groups'
      AND "checksum" = '98465da9a9543ff83916cb849c8ef922324f275ab7410db774b7157e176b5cb2';
  END IF;
END $$;
