-- Preserve existing groups and memberships while moving grants to Site links.
ALTER TABLE "IpamGroup" RENAME TO "AccessGroup";
ALTER TABLE "IpamGroupMember" RENAME TO "AccessGroupMember";
ALTER TABLE "AccessGroup" RENAME CONSTRAINT "IpamGroup_pkey" TO "AccessGroup_pkey";
ALTER TABLE "AccessGroupMember" RENAME CONSTRAINT "IpamGroupMember_pkey" TO "AccessGroupMember_pkey";
ALTER TABLE "AccessGroupMember" RENAME CONSTRAINT "IpamGroupMember_groupId_fkey" TO "AccessGroupMember_groupId_fkey";
ALTER TABLE "AccessGroupMember" RENAME CONSTRAINT "IpamGroupMember_userId_fkey" TO "AccessGroupMember_userId_fkey";

CREATE TABLE "AccessGroupSite" (
  "groupId" UUID NOT NULL,
  "siteId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccessGroupSite_pkey" PRIMARY KEY ("groupId", "siteId")
);
CREATE TABLE "AccessGroupSitePermission" (
  "groupId" UUID NOT NULL,
  "siteId" UUID NOT NULL,
  "permission" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccessGroupSitePermission_pkey" PRIMARY KEY ("groupId", "siteId", "permission")
);

INSERT INTO "AccessGroupSite" ("groupId", "siteId")
SELECT "id", "siteId" FROM "AccessGroup" WHERE "siteId" IS NOT NULL
ON CONFLICT DO NOTHING;

WITH resolved AS (
  SELECT p."groupId", p."permission",
    CASE WHEN p."scopeType" = 'SITE' THEN p."scopeId"
      WHEN p."scopeType" = 'VRF' THEN v."siteId"
      WHEN p."scopeType" = 'VLAN' THEN vl."siteId"
      WHEN p."scopeType" = 'SUBNET' THEN sn."siteId" END AS "siteId"
  FROM "IpamPermission" p
  LEFT JOIN "Vrf" v ON p."scopeType" = 'VRF' AND v."id" = p."scopeId"
  LEFT JOIN "Vlan" vl ON p."scopeType" = 'VLAN' AND vl."id" = p."scopeId"
  LEFT JOIN "Subnet" sn ON p."scopeType" = 'SUBNET' AND sn."id" = p."scopeId"
)
INSERT INTO "AccessGroupSite" ("groupId", "siteId")
SELECT DISTINCT "groupId", "siteId" FROM resolved WHERE "siteId" IS NOT NULL
ON CONFLICT DO NOTHING;

WITH resolved AS (
  SELECT p."groupId", p."permission",
    CASE WHEN p."scopeType" = 'SITE' THEN p."scopeId"
      WHEN p."scopeType" = 'VRF' THEN v."siteId"
      WHEN p."scopeType" = 'VLAN' THEN vl."siteId"
      WHEN p."scopeType" = 'SUBNET' THEN sn."siteId" END AS "siteId"
  FROM "IpamPermission" p
  LEFT JOIN "Vrf" v ON p."scopeType" = 'VRF' AND v."id" = p."scopeId"
  LEFT JOIN "Vlan" vl ON p."scopeType" = 'VLAN' AND vl."id" = p."scopeId"
  LEFT JOIN "Subnet" sn ON p."scopeType" = 'SUBNET' AND sn."id" = p."scopeId"
)
INSERT INTO "AccessGroupSitePermission" ("groupId", "siteId", "permission")
SELECT DISTINCT "groupId", "siteId", "permission" FROM resolved WHERE "siteId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Groups with the same name could previously exist in different Sites. Merge
-- them into one Organization group while preserving every member and Site grant.
CREATE TEMP TABLE "_AccessGroupMerge" ON COMMIT DROP AS
SELECT "id" AS "oldId", FIRST_VALUE("id") OVER (
  PARTITION BY LOWER("name") ORDER BY "createdAt", "id"
) AS "canonicalId"
FROM "AccessGroup";

INSERT INTO "AccessGroupMember" ("groupId", "userId")
SELECT DISTINCT m."canonicalId", member."userId"
FROM "AccessGroupMember" member
JOIN "_AccessGroupMerge" m ON m."oldId" = member."groupId"
ON CONFLICT DO NOTHING;
INSERT INTO "AccessGroupSite" ("groupId", "siteId")
SELECT DISTINCT m."canonicalId", assignment."siteId"
FROM "AccessGroupSite" assignment
JOIN "_AccessGroupMerge" m ON m."oldId" = assignment."groupId"
ON CONFLICT DO NOTHING;
INSERT INTO "AccessGroupSitePermission" ("groupId", "siteId", "permission")
SELECT DISTINCT m."canonicalId", permission."siteId", permission."permission"
FROM "AccessGroupSitePermission" permission
JOIN "_AccessGroupMerge" m ON m."oldId" = permission."groupId"
ON CONFLICT DO NOTHING;

DELETE FROM "AccessGroupSitePermission" p USING "_AccessGroupMerge" m WHERE p."groupId" = m."oldId" AND m."oldId" <> m."canonicalId";
DELETE FROM "AccessGroupSite" s USING "_AccessGroupMerge" m WHERE s."groupId" = m."oldId" AND m."oldId" <> m."canonicalId";
DELETE FROM "AccessGroupMember" member USING "_AccessGroupMerge" m WHERE member."groupId" = m."oldId" AND m."oldId" <> m."canonicalId";
DELETE FROM "AccessGroup" g USING "_AccessGroupMerge" m WHERE g."id" = m."oldId" AND m."oldId" <> m."canonicalId";

DROP TABLE "IpamPermission";
DROP INDEX "IpamGroup_siteId_name_key";
ALTER TABLE "AccessGroup" DROP CONSTRAINT "IpamGroup_siteId_fkey";
ALTER TABLE "AccessGroup" DROP COLUMN "siteId";
CREATE UNIQUE INDEX "AccessGroup_name_key" ON "AccessGroup"("name");
CREATE INDEX "AccessGroupSite_siteId_idx" ON "AccessGroupSite"("siteId");
CREATE INDEX "AccessGroupSitePermission_siteId_permission_idx" ON "AccessGroupSitePermission"("siteId", "permission");
ALTER TABLE "AccessGroupSite" ADD CONSTRAINT "AccessGroupSite_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessGroupSite" ADD CONSTRAINT "AccessGroupSite_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessGroupSitePermission" ADD CONSTRAINT "AccessGroupSitePermission_groupId_siteId_fkey" FOREIGN KEY ("groupId", "siteId") REFERENCES "AccessGroupSite"("groupId", "siteId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InfrastructurePermission" (
  "id" UUID NOT NULL,
  "groupId" UUID NOT NULL,
  "scopeType" TEXT NOT NULL,
  "scopeId" UUID NOT NULL,
  "permission" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InfrastructurePermission_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InfrastructurePermission_scopeType_scopeId_idx" ON "InfrastructurePermission"("scopeType", "scopeId");
CREATE UNIQUE INDEX "InfrastructurePermission_groupId_scopeType_scopeId_permission_key" ON "InfrastructurePermission"("groupId", "scopeType", "scopeId", "permission");
ALTER TABLE "InfrastructurePermission" ADD CONSTRAINT "InfrastructurePermission_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
