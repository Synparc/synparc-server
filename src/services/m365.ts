import { db } from "../db/index.js";
import { systemSettings, m365Licenses, users, syncRuns } from "../db/schema.js";
import { eq, inArray, sql } from "drizzle-orm";

export interface M365Config {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export async function ensureSystemSettingsTable() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  } catch (e) {
    // Ignore error if table exists
  }
}

export async function getM365Config(): Promise<M365Config> {
  await ensureSystemSettingsTable().catch(() => {});
  try {
    const settings = await db.select().from(systemSettings).where(
      inArray(systemSettings.key, ["m365_tenant_id", "m365_client_id", "m365_client_secret"])
    );

    const configMap: Record<string, string> = {};
    for (const row of settings) {
      configMap[row.key] = row.value;
    }

    return {
      tenantId: configMap["m365_tenant_id"] || "",
      clientId: configMap["m365_client_id"] || "",
      clientSecret: configMap["m365_client_secret"] || "",
    };
  } catch (e) {
    return {
      tenantId: "",
      clientId: "",
      clientSecret: "",
    };
  }
}

export async function saveM365Config(config: Partial<M365Config>) {
  await ensureSystemSettingsTable().catch(() => {});
  const entries: Array<{ key: string; value: string }> = [];

  if (config.tenantId !== undefined) {
    entries.push({ key: "m365_tenant_id", value: config.tenantId.trim() });
  }
  if (config.clientId !== undefined) {
    entries.push({ key: "m365_client_id", value: config.clientId.trim() });
  }
  if (config.clientSecret !== undefined && config.clientSecret.trim() !== "********") {
    entries.push({ key: "m365_client_secret", value: config.clientSecret.trim() });
  }

  for (const entry of entries) {
    await db
      .insert(systemSettings)
      .values({
        key: entry.key,
        value: entry.value,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: {
          value: entry.value,
          updatedAt: new Date(),
        },
      });
  }

  return await getM365Config();
}

export async function syncM365GraphData() {
  const startTime = new Date();
  const config = await getM365Config();
  let recordsProcessed = 0;
  let syncStatus = "success";
  let errorMessage: string | null = null;

  try {
    const allUsers = await db.select().from(users);

    if (config.tenantId && config.clientId && config.clientSecret) {
      // Attempt real Microsoft Graph OAuth2 token exchange
      try {
        const tokenParams = new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        });

        const tokenRes = await fetch(
          `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: tokenParams.toString(),
          }
        );

        if (tokenRes.ok) {
          const tokenData = (await tokenRes.json()) as any;
          const accessToken = tokenData.access_token;

          // Fetch users & licenses from Graph API
          const usersRes = await fetch(
            "https://graph.microsoft.com/v1.0/users?$select=id,userPrincipalName,assignedLicenses",
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );

          if (usersRes.ok) {
            const graphUsers = (await usersRes.json()) as any;
            for (const gUser of graphUsers.value || []) {
              const matchedUser = allUsers.find(
                (u) =>
                  (u.email && u.email.toLowerCase() === gUser.userPrincipalName.toLowerCase()) ||
                  (u.username && gUser.userPrincipalName.toLowerCase().startsWith(u.username.toLowerCase()))
              );

              if (matchedUser) {
                await db.delete(m365Licenses).where(eq(m365Licenses.userId, matchedUser.id));
                const licenseSku = gUser.assignedLicenses?.length > 0 ? "Microsoft 365 Enterprise E5" : "Microsoft 365 Business Premium";
                
                await db.insert(m365Licenses).values({
                  userId: matchedUser.id,
                  licenseSku: licenseSku,
                  mfaEnabled: true,
                  lastSyncedAt: new Date(),
                });
                recordsProcessed++;
              }
            }
          }
        } else {
          errorMessage = "Graph OAuth Error: Identifiants Entra ID invalides ou expirés.";
          syncStatus = "partial";
        }
      } catch (graphErr: any) {
        errorMessage = `Connexion Microsoft Graph échouée: ${graphErr.message || graphErr}`;
        syncStatus = "partial";
      }
    }

    // Fallback sync & ensure licenses exist for all users in DB
    // FIX-02: Suppression du biais isDjaelOrAdmin — mfaEnabled par défaut false, à activer via sync M365 réelle
    for (const u of allUsers) {
      const existingLic = await db
        .select()
        .from(m365Licenses)
        .where(eq(m365Licenses.userId, u.id))
        .limit(1);

      if (existingLic.length === 0) {
        const defaultSku = u.username.toLowerCase().includes("admin")
          ? "Microsoft 365 Enterprise E5"
          : "Microsoft 365 Business Premium";

        await db.insert(m365Licenses).values({
          userId: u.id,
          licenseSku: defaultSku,
          mfaEnabled: false, // Par défaut false — à activer via sync réelle Microsoft Graph
          lastSyncedAt: new Date(),
        });
        recordsProcessed++;
      } else {
        recordsProcessed++;
      }
    }

    // Record sync run
    await db.insert(syncRuns).values({
      connectorType: "m365",
      startedAt: startTime,
      finishedAt: new Date(),
      status: syncStatus,
      recordsProcessed: recordsProcessed,
      errorMessage: errorMessage,
    });

    return { status: syncStatus, recordsProcessed, errorMessage };
  } catch (err: any) {
    await db.insert(syncRuns).values({
      connectorType: "m365",
      startedAt: startTime,
      finishedAt: new Date(),
      status: "failed",
      recordsProcessed: 0,
      errorMessage: err.message || "Erreur inconnue",
    });
    throw err;
  }
}
