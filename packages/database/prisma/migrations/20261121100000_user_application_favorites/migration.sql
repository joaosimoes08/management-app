-- Portal favourites per user (Phase E, Step 17). Additive: a new table only, safe on a live database.
-- CreateTable
CREATE TABLE "UserApplicationFavorite" (
    "userId" UUID NOT NULL,
    "linkId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserApplicationFavorite_pkey" PRIMARY KEY ("userId","linkId")
);

-- CreateIndex
CREATE INDEX "UserApplicationFavorite_linkId_idx" ON "UserApplicationFavorite"("linkId");

-- AddForeignKey
ALTER TABLE "UserApplicationFavorite" ADD CONSTRAINT "UserApplicationFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserApplicationFavorite" ADD CONSTRAINT "UserApplicationFavorite_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ApplicationLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

