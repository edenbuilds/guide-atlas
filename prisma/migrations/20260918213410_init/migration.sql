-- CreateTable
CREATE TABLE "TourGuide" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fullName" TEXT NOT NULL,
    "companyName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "whatsappConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "website" TEXT,
    "contactPageUrl" TEXT,
    "country" TEXT NOT NULL,
    "countryCode" TEXT,
    "city" TEXT,
    "region" TEXT,
    "vehicleType" TEXT,
    "vehicleDetails" TEXT,
    "vehicleCapacity" INTEGER,
    "services" TEXT NOT NULL DEFAULT '[]',
    "languages" TEXT NOT NULL DEFAULT '[]',
    "clientExperience" TEXT NOT NULL DEFAULT '[]',
    "isIndependent" BOOLEAN NOT NULL DEFAULT true,
    "worksWithCouples" BOOLEAN,
    "smallGroupCapable" BOOLEAN,
    "isTourManager" BOOLEAN,
    "licensed" BOOLEAN,
    "yearsExperience" INTEGER,
    "bio" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceDomain" TEXT NOT NULL,
    "sourceType" TEXT,
    "confidence" REAL NOT NULL DEFAULT 0.5,
    "evidence" TEXT,
    "rawJson" TEXT,
    "fingerprint" TEXT NOT NULL,
    "scrapedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ScrapeRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "region" TEXT,
    "targetUrls" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "pagesScraped" INTEGER NOT NULL DEFAULT 0,
    "guidesFound" INTEGER NOT NULL DEFAULT 0,
    "guidesUpserted" INTEGER NOT NULL DEFAULT 0,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "TourGuide_fingerprint_key" ON "TourGuide"("fingerprint");

-- CreateIndex
CREATE INDEX "TourGuide_country_idx" ON "TourGuide"("country");

-- CreateIndex
CREATE INDEX "TourGuide_countryCode_idx" ON "TourGuide"("countryCode");

-- CreateIndex
CREATE INDEX "TourGuide_vehicleType_idx" ON "TourGuide"("vehicleType");

-- CreateIndex
CREATE INDEX "TourGuide_sourceDomain_idx" ON "TourGuide"("sourceDomain");

-- CreateIndex
CREATE INDEX "TourGuide_whatsappConfirmed_idx" ON "TourGuide"("whatsappConfirmed");

-- CreateIndex
CREATE INDEX "TourGuide_scrapedAt_idx" ON "TourGuide"("scrapedAt");

-- CreateIndex
CREATE INDEX "ScrapeRun_status_idx" ON "ScrapeRun"("status");

-- CreateIndex
CREATE INDEX "ScrapeRun_startedAt_idx" ON "ScrapeRun"("startedAt");
