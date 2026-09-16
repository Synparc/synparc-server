import { db } from "./index.js";
import { syncRuns, licenseKeys, enrollmentTokens } from "./schema.js";
import * as crypto from "crypto";
import { sql } from "drizzle-orm";

async function main() {
  console.log("Seeding settings data...");

  // 1. Licenses
  const existingLicenses = await db.select().from(licenseKeys);
  if (existingLicenses.length === 0) {
    await db.insert(licenseKeys).values({
      keyValue: "SYN-ENT-X9Y8-Z7W6-V5U4",
      maxNodes: 500,
      issuedTo: "Acme Corp",
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      status: "active"
    });
    console.log("Inserted mock license.");
  }

  // 2. Sync Runs
  const existingRuns = await db.select().from(syncRuns);
  if (existingRuns.length === 0) {
    await db.insert(syncRuns).values([
      {
        connectorType: "ad",
        startedAt: new Date(Date.now() - 3600000), // 1h ago
        finishedAt: new Date(Date.now() - 3590000),
        status: "success",
        recordsProcessed: 142
      },
      {
        connectorType: "m365",
        startedAt: new Date(Date.now() - 7200000), // 2h ago
        finishedAt: new Date(Date.now() - 7150000),
        status: "partial",
        recordsProcessed: 130,
        errorMessage: "Graph API throttled"
      },
      {
        connectorType: "smb_scanner",
        startedAt: new Date(Date.now() - 86400000), // 1d ago
        finishedAt: new Date(Date.now() - 86000000),
        status: "success",
        recordsProcessed: 10450
      }
    ]);
    console.log("Inserted mock sync runs.");
  }

  // 3. Tokens
  const existingTokens = await db.select().from(enrollmentTokens);
  if (existingTokens.length === 0) {
    const rawToken = "initial-demo-token-12345";
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await db.insert(enrollmentTokens).values({
      tokenHash: tokenHash,
      revoked: false
    });
    console.log("Inserted mock enrollment token.");
  }

  console.log("Seeding complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to seed:", err);
  process.exit(1);
});
