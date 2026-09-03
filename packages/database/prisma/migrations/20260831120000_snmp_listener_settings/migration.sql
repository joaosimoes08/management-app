CREATE TABLE "SnmpListenerConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "listenAll" BOOLEAN NOT NULL DEFAULT true,
    "selectedInterfaces" JSONB NOT NULL DEFAULT '[]',
    "updatedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SnmpListenerConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SnmpListenerInterface" (
    "id" UUID NOT NULL,
    "instanceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SnmpListenerInterface_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SnmpListenerInterface_instanceId_name_address_key"
ON "SnmpListenerInterface"("instanceId", "name", "address");

CREATE INDEX "SnmpListenerInterface_lastSeenAt_idx"
ON "SnmpListenerInterface"("lastSeenAt");

INSERT INTO "SnmpListenerConfig" ("id", "listenAll", "selectedInterfaces", "updatedAt")
VALUES ('default', true, '[]', CURRENT_TIMESTAMP);
