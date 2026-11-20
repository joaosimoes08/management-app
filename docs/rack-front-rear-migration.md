# Rack front and rear views: release and data migration

Release date: 2026-11-20. Branch `feature/rack-front-rear-views`.

## What changes

- Equipment now has two faces, **front** and **rear**. The images and port maps stored until now as "front" were
  taken from the **rear** of the equipment, so they are moved to the rear face.
- `DeviceModel.portLayout` becomes version 2: `{ version: 2, family?, faces: { front?, rear? } }`, where each face is
  `{ imageWidth, imageHeight, viewport?, ports[] }`. The API reads old (v1 and catalog seed) layouts as `faces.rear` and
  always answers in v2, so the API keeps working before the data migration runs.
- Port mapping is mandatory: a model with network ports must have every port mapped across its faces before a device
  can be created from it or moved to it (manual create, device edit, CSV import, bulk model change, SNMP onboarding).
  A face with 0 ports needs no map. Error: `400 PORT_LAYOUT_INCOMPLETE`.
- Port count rule: `expected = supportsNetworkPorts ? (networkPortCount ?? portCount ?? 0) : 0`; an explicit 0
  means no ports. Only fully mapped ports count.
- New models need a front image (`400 FRONT_IMAGE_REQUIRED`). Existing models without one are not blocked; the quality
  page lists them as "Sem vista frontal" and "Mapeamento de portas em falta".
- New column `Device.backAssetId` (per-device rear image override), added by the Prisma migration
  `20261120120000_device_rear_asset_override` (additive, nullable, runs on container start).

## Order of operations

**Run the data script in the same deploy step as `prisma migrate deploy`, before anyone uses the new version.**
Until it runs, every old image still sits in `frontAssetId`, so the new UI shows the old rear photos as the
**front** view, an empty rear view, and a rear port map without its image. Port maps are read as rear either way,
so the mismatch is visible at once and an admin who "fixes" it in the editor would be undone by the script later.

1. **Back up** the database (below). Do not skip this.
2. Stop the old app so nobody edits during the switch: `docker compose stop web api snmp`.
3. Point the stack at the new release and pull its images, then run the schema migration and the data script
   together, as one one-off container, before the new API or web start. Put `APP_IMAGE_TAG=<new tag>` in the `.env`
   file next to `docker-compose.yml` so step 4 uses the same tag (the compose file has no `build:` sections, so the
   images come from the registry):
   ```sh
   docker compose pull api web
   docker compose run --rm --no-deps api sh -c '
     npx prisma migrate deploy --schema packages/database/prisma/schema.prisma &&
     node apps/api/dist/scripts/migrate-rack-faces.js --dry-run &&
     node apps/api/dist/scripts/migrate-rack-faces.js'
   ```
   The `&&` chain stops at the first failure, so the script never runs on a schema that did not migrate. Read the
   dry-run counts in the output; the real run prints the same numbers.
4. Start the new version: `docker compose up -d`. The API's own start command runs `prisma migrate deploy` again,
   which is a no-op now.
5. If the script printed `WARNING: N model(s) already had both images`, review those models by hand: their images
   were left in place, and their port map is now on the rear face.

From a dev checkout: `DATABASE_URL=... npx prisma migrate deploy --schema packages/database/prisma/schema.prisma &&
DATABASE_URL=... npx ts-node apps/api/src/scripts/migrate-rack-faces.ts`.

The data migration runs in one transaction and moves, only where the rear is still empty:

- `DeviceModel.frontAssetId` to `backAssetId`;
- `Device.frontAssetId` (the per-device override) to `backAssetId`;
- every non-v2 `portLayout` into v2 `faces.rear`.

It then writes a `RACK_FACES_MIGRATED` audit row. Running it again does nothing (`"skipped": true`). `--force` re-runs
the layout conversion only and never moves images again, so front images uploaded after the migration stay put.

## Backup

```sh
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backup-before-rack-faces-$(date +%Y%m%d%H%M).dump
```

Image files live in asset storage, not in Postgres. The migration does not touch them; it only swaps which column
points at them.

## Rollback

- **Full restore:** stop `api` and `snmp`, then
  ```sh
  docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < backup-before-rack-faces-YYYYMMDDHHMM.dump
  ```
  Anything written after the backup is lost.
- **Images only, keeping newer data:** move rear images back where the front is still empty and drop the marker:
  ```sql
  BEGIN;
  UPDATE "DeviceModel" SET "frontAssetId" = "backAssetId", "backAssetId" = NULL WHERE "backAssetId" IS NOT NULL AND "frontAssetId" IS NULL;
  UPDATE "Device"      SET "frontAssetId" = "backAssetId", "backAssetId" = NULL WHERE "backAssetId" IS NOT NULL AND "frontAssetId" IS NULL;
  DELETE FROM "AuditLog" WHERE action = 'RACK_FACES_MIGRATED';
  COMMIT;
  ```
  This also moves rear images that existed before the migration; check the migration's audit row
  (`metadata.modelsWithBothImages`) and the backup if that matters.
- **Code rollback:** the previous API version ignores `Device.backAssetId` and cannot read v2 layouts. If you roll the
  code back, restore the backup as well. Leaving the new column in place is harmless.

## Proof (disposable PostgreSQL 18, 2026-11-20)

The proof used `main`'s migrations plus legacy rows: a v1 layout, a seed layout, no layout, a model with both images,
an existing v2 row and a device override. Then the new migration was applied and the script was run four times:

| Run | skipped | models moved | devices moved | layouts converted | models front/rear after | devices front/rear after | layouts not v2 after |
|---|---|---|---|---|---|---|---|
| before | | | | | 3 / 2 | 1 / 0 | 3 of 4 |
| `--dry-run` (rolled back) | no | 2 | 1 | 3 | 1 / 4 | 0 / 1 | 0 |
| real | no | 2 | 1 | 3 | 1 / 4 | 0 / 1 | 0 |
| re-run | yes | 0 | 0 | 0 | 1 / 4 | 0 / 1 | 0 |
| `--force` | no | 0 | 0 | 0 | 1 / 4 | 0 / 1 | 0 |
