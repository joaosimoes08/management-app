-- Drop the database-side gen_random_uuid() defaults on "id" that earlier
-- migrations created but schema.prisma never declared. Prisma generates these
-- ids client-side (@default(uuid())), and no raw SQL inserts into these tables
-- without an id, so removing the default only brings the database in line with
-- the schema. Existing rows are untouched.
ALTER TABLE "OperationalAlert" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "DashboardLayout" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "TopologyMap" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "DeviceConnection" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "InventoryFinding" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "TopologyProposal" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "NetAppIntegration" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "LinuxAgent" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "IpReservation" ALTER COLUMN "id" DROP DEFAULT;
