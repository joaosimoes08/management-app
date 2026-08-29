-- Reconcile databases where the centralized migration was recorded as applied
-- before its data-moving SQL was introduced. This migration is idempotent so it
-- is a no-op on databases that already have the centralized schema.
DO $$
BEGIN
  IF to_regclass('"IpamPermission"') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'AccessGroup' AND column_name = 'siteId') THEN
    CREATE TABLE IF NOT EXISTS "AccessGroupSite" (
      "groupId" UUID NOT NULL,
      "siteId" UUID NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AccessGroupSite_pkey" PRIMARY KEY ("groupId", "siteId")
    );
    CREATE TABLE IF NOT EXISTS "AccessGroupSitePermission" (
      "groupId" UUID NOT NULL,
      "siteId" UUID NOT NULL,
      "permission" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AccessGroupSitePermission_pkey" PRIMARY KEY ("groupId", "siteId", "permission")
    );

    INSERT INTO "AccessGroupSite" ("groupId", "siteId")
      SELECT "id", "siteId" FROM "AccessGroup" WHERE "siteId" IS NOT NULL ON CONFLICT DO NOTHING;
    INSERT INTO "AccessGroupSite" ("groupId", "siteId")
      SELECT DISTINCT p."groupId", CASE
        WHEN p."scopeType" = 'SITE' THEN p."scopeId"
        WHEN p."scopeType" = 'VRF' THEN v."siteId"
        WHEN p."scopeType" = 'VLAN' THEN vl."siteId"
        WHEN p."scopeType" = 'SUBNET' THEN sn."siteId"
      END
      FROM "IpamPermission" p
      LEFT JOIN "Vrf" v ON p."scopeType" = 'VRF' AND v."id" = p."scopeId"
      LEFT JOIN "Vlan" vl ON p."scopeType" = 'VLAN' AND vl."id" = p."scopeId"
      LEFT JOIN "Subnet" sn ON p."scopeType" = 'SUBNET' AND sn."id" = p."scopeId"
      WHERE CASE
        WHEN p."scopeType" = 'SITE' THEN p."scopeId"
        WHEN p."scopeType" = 'VRF' THEN v."siteId"
        WHEN p."scopeType" = 'VLAN' THEN vl."siteId"
        WHEN p."scopeType" = 'SUBNET' THEN sn."siteId"
      END IS NOT NULL ON CONFLICT DO NOTHING;
    INSERT INTO "AccessGroupSitePermission" ("groupId", "siteId", "permission")
      SELECT DISTINCT p."groupId", a."siteId", p."permission"
      FROM "IpamPermission" p
      JOIN "AccessGroupSite" a ON a."groupId" = p."groupId"
      WHERE a."siteId" = CASE
        WHEN p."scopeType" = 'SITE' THEN p."scopeId"
        WHEN p."scopeType" = 'VRF' THEN (SELECT "siteId" FROM "Vrf" WHERE "id" = p."scopeId")
        WHEN p."scopeType" = 'VLAN' THEN (SELECT "siteId" FROM "Vlan" WHERE "id" = p."scopeId")
        WHEN p."scopeType" = 'SUBNET' THEN (SELECT "siteId" FROM "Subnet" WHERE "id" = p."scopeId")
      END ON CONFLICT DO NOTHING;

    -- Consolidate same-named legacy groups before enforcing organization-wide uniqueness.
    CREATE TEMP TABLE "_AccessGroupRepairMerge" ON COMMIT DROP AS
      SELECT "id" AS "oldId", FIRST_VALUE("id") OVER (PARTITION BY LOWER("name") ORDER BY "createdAt", "id") AS "canonicalId"
      FROM "AccessGroup";
    INSERT INTO "AccessGroupMember" ("groupId", "userId")
      SELECT m."canonicalId", x."userId" FROM "AccessGroupMember" x JOIN "_AccessGroupRepairMerge" m ON m."oldId" = x."groupId" ON CONFLICT DO NOTHING;
    INSERT INTO "AccessGroupSite" ("groupId", "siteId")
      SELECT m."canonicalId", x."siteId" FROM "AccessGroupSite" x JOIN "_AccessGroupRepairMerge" m ON m."oldId" = x."groupId" ON CONFLICT DO NOTHING;
    INSERT INTO "AccessGroupSitePermission" ("groupId", "siteId", "permission")
      SELECT m."canonicalId", x."siteId", x."permission" FROM "AccessGroupSitePermission" x JOIN "_AccessGroupRepairMerge" m ON m."oldId" = x."groupId" ON CONFLICT DO NOTHING;
    UPDATE "InfrastructurePermission" p SET "groupId" = m."canonicalId" FROM "_AccessGroupRepairMerge" m WHERE p."groupId" = m."oldId";
    DELETE FROM "InfrastructurePermission" a USING "InfrastructurePermission" b
      WHERE a.ctid < b.ctid AND a."groupId" = b."groupId" AND a."scopeType" = b."scopeType" AND a."scopeId" = b."scopeId" AND a."permission" = b."permission";
    DELETE FROM "AccessGroupSitePermission" x USING "_AccessGroupRepairMerge" m WHERE x."groupId" = m."oldId" AND m."oldId" <> m."canonicalId";
    DELETE FROM "AccessGroupSite" x USING "_AccessGroupRepairMerge" m WHERE x."groupId" = m."oldId" AND m."oldId" <> m."canonicalId";
    DELETE FROM "AccessGroupMember" x USING "_AccessGroupRepairMerge" m WHERE x."groupId" = m."oldId" AND m."oldId" <> m."canonicalId";
    DELETE FROM "AccessGroup" x USING "_AccessGroupRepairMerge" m WHERE x."id" = m."oldId" AND m."oldId" <> m."canonicalId";

    ALTER TABLE "AccessGroupSite" DROP CONSTRAINT IF EXISTS "AccessGroupSite_groupId_fkey";
    ALTER TABLE "AccessGroupSite" DROP CONSTRAINT IF EXISTS "AccessGroupSite_siteId_fkey";
    ALTER TABLE "AccessGroupSitePermission" DROP CONSTRAINT IF EXISTS "AccessGroupSitePermission_groupId_siteId_fkey";
    ALTER TABLE "AccessGroup" DROP CONSTRAINT IF EXISTS "AccessGroup_siteId_fkey";
    DROP INDEX IF EXISTS "AccessGroup_siteId_name_key";
    ALTER TABLE "AccessGroup" DROP COLUMN IF EXISTS "siteId";
    DROP TABLE "IpamPermission";
    CREATE UNIQUE INDEX IF NOT EXISTS "AccessGroup_name_key" ON "AccessGroup"("name");
    CREATE INDEX IF NOT EXISTS "AccessGroupSite_siteId_idx" ON "AccessGroupSite"("siteId");
    CREATE INDEX IF NOT EXISTS "AccessGroupSitePermission_siteId_permission_idx" ON "AccessGroupSitePermission"("siteId", "permission");
    ALTER TABLE "AccessGroupSite" ADD CONSTRAINT "AccessGroupSite_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    ALTER TABLE "AccessGroupSite" ADD CONSTRAINT "AccessGroupSite_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    ALTER TABLE "AccessGroupSitePermission" ADD CONSTRAINT "AccessGroupSitePermission_groupId_siteId_fkey" FOREIGN KEY ("groupId", "siteId") REFERENCES "AccessGroupSite"("groupId", "siteId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
