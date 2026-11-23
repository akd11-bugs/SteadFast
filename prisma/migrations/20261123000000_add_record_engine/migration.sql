-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "recordEngineEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ObjectType" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "restrictToOwner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObjectType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectField" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "objectTypeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObjectField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "objectTypeId" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "ownerId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObjectRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ObjectType_orgId_position_idx" ON "ObjectType"("orgId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectType_orgId_key_key" ON "ObjectType"("orgId", "key");

-- CreateIndex
CREATE INDEX "ObjectField_orgId_objectTypeId_position_idx" ON "ObjectField"("orgId", "objectTypeId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectField_objectTypeId_key_key" ON "ObjectField"("objectTypeId", "key");

-- CreateIndex
CREATE INDEX "ObjectRecord_orgId_objectTypeId_updatedAt_idx" ON "ObjectRecord"("orgId", "objectTypeId", "updatedAt");

-- CreateIndex
CREATE INDEX "ObjectRecord_values_idx" ON "ObjectRecord" USING GIN ("values" jsonb_path_ops);

-- AddForeignKey
ALTER TABLE "ObjectField" ADD CONSTRAINT "ObjectField_objectTypeId_fkey" FOREIGN KEY ("objectTypeId") REFERENCES "ObjectType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectRecord" ADD CONSTRAINT "ObjectRecord_objectTypeId_fkey" FOREIGN KEY ("objectTypeId") REFERENCES "ObjectType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

