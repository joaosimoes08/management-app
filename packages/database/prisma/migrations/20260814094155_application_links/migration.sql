-- CreateTable
CREATE TABLE "ApplicationLink" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'external-link',
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'Operações',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "checkAvailability" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP(3),
    "isAvailable" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationLinkRole" (
    "linkId" UUID NOT NULL,
    "role" "RoleName" NOT NULL,

    CONSTRAINT "ApplicationLinkRole_pkey" PRIMARY KEY ("linkId","role")
);

-- CreateIndex
CREATE INDEX "ApplicationLink_isActive_category_sortOrder_idx" ON "ApplicationLink"("isActive", "category", "sortOrder");

-- AddForeignKey
ALTER TABLE "ApplicationLinkRole" ADD CONSTRAINT "ApplicationLinkRole_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ApplicationLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
