import { db } from "./index.js";
import { users, groups, userGroupMemberships, m365Licenses, resources, rawAcl, machines, machineSessions } from "./schema.js";
import { eq } from "drizzle-orm";
import { recomputeEffectivePermissions } from "../routes/connectors.js";

export async function seedDemoDatabase() {
  console.log("🌱 Seeding Synparc demo database...");

  // 1. Seed demo machines
  const existingMachines = await db.select().from(machines);
  let demoMachineId = existingMachines[0]?.id;
  if (existingMachines.length === 0) {
    const inserted = await db.insert(machines).values({
      hostname: "POSTE71",
      osName: "Windows 11 Pro 23H2",
      ipAddress: "192.168.1.71",
      agentVersion: "v1.2.0",
      status: "online",
      lastSeenAt: new Date(),
    }).returning();
    demoMachineId = inserted[0].id;
  }

  // 2. Seed demo groups
  const existingGroups = await db.select().from(groups);
  let adminGroupId = existingGroups[0]?.id;
  if (existingGroups.length === 0) {
    const inserted = await db.insert(groups).values([
      { name: "Direction", description: "Membres de la direction IT & Générale", groupType: "Security" },
      { name: "Administrateurs Domaine", description: "Administrateurs système AD", groupType: "Security" }
    ]).returning();
    adminGroupId = inserted[0].id;
  }

  // 3. Seed demo resources
  const existingResources = await db.select().from(resources);
  let demoResourceId = existingResources[0]?.id;
  if (existingResources.length === 0) {
    const inserted = await db.insert(resources).values([
      { resourceType: "smb_share", path: "\\\\sv201914\\D_Info\\Commun Info", hostingMachineId: demoMachineId, lastScannedAt: new Date() },
      { resourceType: "smb_share", path: "\\\\POSTE71\\C$", hostingMachineId: demoMachineId, lastScannedAt: new Date() },
    ]).returning();
    demoResourceId = inserted[0].id;
  }

  // 4. Seed demo ACLs & Recompute effective permissions
  if (adminGroupId && demoResourceId) {
    await db.insert(rawAcl).values({
      resourceId: demoResourceId,
      groupId: adminGroupId,
      accessLevel: "Contrôle Total (FullControl)",
      collectedAt: new Date()
    }).onConflictDoNothing();

    await recomputeEffectivePermissions();
  }

  console.log("✅ Demo database seeding completed successfully.");
}

if (require.main === module) {
  seedDemoDatabase().then(() => process.exit(0)).catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  });
}
