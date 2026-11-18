-- CreateTable
CREATE TABLE "JobRunIssue" (
    "id" TEXT NOT NULL,
    "jobRunId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "rawValue" TEXT,
    "leadId" TEXT,
    "suggestedStage" TEXT,
    "suggestionConfidence" TEXT,
    "resolvedStage" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRunIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobRunIssue_jobRunId_idx" ON "JobRunIssue"("jobRunId");

-- CreateIndex
CREATE INDEX "JobRunIssue_orgId_resolvedAt_idx" ON "JobRunIssue"("orgId", "resolvedAt");

-- AddForeignKey
ALTER TABLE "JobRunIssue" ADD CONSTRAINT "JobRunIssue_jobRunId_fkey" FOREIGN KEY ("jobRunId") REFERENCES "JobRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRunIssue" ADD CONSTRAINT "JobRunIssue_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
