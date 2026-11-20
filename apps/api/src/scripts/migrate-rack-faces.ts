/**
 * One-time data migration for rack front and rear views (2026-11-20).
 *
 * Joao's rule: the images and port maps stored today as "front" were drawn from the REAR of the equipment.
 *  1. DeviceModel: backAssetId := frontAssetId, frontAssetId := NULL   (only where backAssetId IS NULL)
 *  2. Device:      backAssetId := frontAssetId, frontAssetId := NULL   (per-device override; only where backAssetId IS NULL)
 *  3. DeviceModel.portLayout: v1 / seed shapes become v2 `faces.rear` (normalizePortLayout); v2 rows are left alone.
 *
 * Everything runs in one transaction. Re-running changes nothing: steps 1-2 only match rows that still have a front
 * image and no rear image, step 3 only rewrites rows that are not yet normalised v2, and a RACK_FACES_MIGRATED audit
 * marker makes later runs stop before step 1, so a front image uploaded after the migration is never moved.
 *
 * Take a pg_dump backup first (docs/rack-front-rear-migration.md).
 *
 * Usage (DATABASE_URL must point at the target database):
 *   dev:       npx ts-node apps/api/src/scripts/migrate-rack-faces.ts [--dry-run] [--force]
 *   container: node apps/api/dist/scripts/migrate-rack-faces.js [--dry-run] [--force]
 *   --dry-run  report what would change, then roll back
 *   --force    run even if the RACK_FACES_MIGRATED marker exists (the row conditions still keep it a no-op on migrated rows)
 */
import { PrismaClient } from '@simoes/database';
import { isNormalizedPortLayout, normalizePortLayout } from '../infrastructure/port-layout';

export const RACK_FACES_MARKER = 'RACK_FACES_MIGRATED';

export interface RackFacesSummary {
  dryRun: boolean;
  skipped: boolean;
  markerAt: string | null;
  modelsMovedToRear: number;
  devicesMovedToRear: number;
  layoutsConverted: number;
  modelsWithBothImages: number;
  before: RackFacesCounts;
  after: RackFacesCounts;
}

export interface RackFacesCounts {
  modelsWithFront: number;
  modelsWithRear: number;
  devicesWithFront: number;
  devicesWithRear: number;
  layoutsTotal: number;
  layoutsNotV2: number;
}

class DryRunRollback extends Error { constructor(readonly summary: RackFacesSummary) { super('dry-run rollback'); } }

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

async function counts(tx: Tx): Promise<RackFacesCounts> {
  const [modelsWithFront, modelsWithRear, devicesWithFront, devicesWithRear] = await Promise.all([
    tx.deviceModel.count({ where: { frontAssetId: { not: null } } }),
    tx.deviceModel.count({ where: { backAssetId: { not: null } } }),
    tx.device.count({ where: { frontAssetId: { not: null } } }),
    tx.device.count({ where: { backAssetId: { not: null } } }),
  ]);
  const layouts = await tx.$queryRaw<Array<{ portLayout: unknown }>>`SELECT "portLayout" FROM "DeviceModel" WHERE "portLayout" IS NOT NULL AND jsonb_typeof("portLayout") <> 'null'`;
  return { modelsWithFront, modelsWithRear, devicesWithFront, devicesWithRear, layoutsTotal: layouts.length, layoutsNotV2: layouts.filter((row) => !isNormalizedPortLayout(row.portLayout)).length };
}

export async function migrateRackFaces(prisma: PrismaClient, options: { dryRun?: boolean; force?: boolean } = {}): Promise<RackFacesSummary> {
  const dryRun = !!options.dryRun;
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await counts(tx);
      const marker = await tx.auditLog.findFirst({ where: { action: RACK_FACES_MARKER }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
      const base = { dryRun, markerAt: marker?.createdAt.toISOString() ?? null, before };
      if (marker && !options.force) return { ...base, skipped: true, modelsMovedToRear: 0, devicesMovedToRear: 0, layoutsConverted: 0, modelsWithBothImages: 0, after: before };

      const modelsWithBothImages = await tx.deviceModel.count({ where: { frontAssetId: { not: null }, backAssetId: { not: null } } });
      // A forced re-run after the marker only repairs layouts: a front image uploaded after the first run must stay put.
      let modelsMovedToRear = 0; let devicesMovedToRear = 0;
      if (!marker) {
        modelsMovedToRear = await tx.$executeRaw`UPDATE "DeviceModel" SET "backAssetId" = "frontAssetId", "frontAssetId" = NULL WHERE "frontAssetId" IS NOT NULL AND "backAssetId" IS NULL`;
        devicesMovedToRear = await tx.$executeRaw`UPDATE "Device" SET "backAssetId" = "frontAssetId", "frontAssetId" = NULL WHERE "frontAssetId" IS NOT NULL AND "backAssetId" IS NULL`;
      }

      const rows = await tx.$queryRaw<Array<{ id: string; portLayout: unknown }>>`SELECT "id", "portLayout" FROM "DeviceModel" WHERE "portLayout" IS NOT NULL AND jsonb_typeof("portLayout") <> 'null'`;
      let layoutsConverted = 0;
      for (const row of rows) {
        if (isNormalizedPortLayout(row.portLayout)) continue;
        const layout = normalizePortLayout(row.portLayout);
        if (!layout) continue;
        await tx.deviceModel.update({ where: { id: row.id }, data: { portLayout: layout as never } });
        layoutsConverted++;
      }

      const after = await counts(tx);
      const summary: RackFacesSummary = { ...base, skipped: false, modelsMovedToRear, devicesMovedToRear, layoutsConverted, modelsWithBothImages, after };
      if (dryRun) throw new DryRunRollback(summary);
      if (!marker) await tx.auditLog.create({ data: { action: RACK_FACES_MARKER, entityType: 'DeviceModel', entityId: 'rack-faces', metadata: { modelsMovedToRear, devicesMovedToRear, layoutsConverted, modelsWithBothImages } } });
      return summary;
    }, { timeout: 120_000 });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.summary;
    throw error;
  }
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const prisma = new PrismaClient();
  migrateRackFaces(prisma, { dryRun: args.has('--dry-run'), force: args.has('--force') })
    .then((summary) => { console.log(JSON.stringify(summary, null, 2)); if (summary.modelsWithBothImages) console.warn(`WARNING: ${summary.modelsWithBothImages} model(s) already had both images; their images were not moved but their port layout is now faces.rear. Review them by hand.`); })
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
