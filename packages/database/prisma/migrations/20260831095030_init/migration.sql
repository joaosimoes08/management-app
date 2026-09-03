-- AlterTable
ALTER TABLE "SnmpCredential" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SnmpDeviceConfig" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SnmpDrift" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SnmpInterfaceObservation" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SnmpJob" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SnmpSnapshot" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SnmpTrapEvent" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SnmpWriteRequest" ALTER COLUMN "id" DROP DEFAULT;
