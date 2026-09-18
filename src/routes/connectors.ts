import { FastifyPluginAsync } from "fastify";
import { db } from "../db/index.js";
import { users, groups, userGroupMemberships, groupGroupMemberships, m365Licenses, resources, rawAcl, machineSessions, effectivePermissions, machines, machineMetrics } from "../db/schema.js";
import { eq, or, sql, and } from "drizzle-orm";

export async function mergeDuplicateUsers() {
  const allUsers = await db.select().from(users);
  const byUsername = new Map<string, typeof allUsers>();

  for (const user of allUsers) {
    const key = (user.username || "").toLowerCase().trim();
    if (!key) continue;
    const list = byUsername.get(key) || [];
    list.push(user);
    byUsername.set(key, list);
  }

  for (const [username, userList] of byUsername.entries()) {
    if (userList.length > 1) {
      const primary = userList[0];
      const duplicates = userList.slice(1);

      let mergedDisplayName = primary.displayName;
      let mergedEmail = primary.email;
      let mergedDepartment = primary.department;
      let mergedTitle = primary.title;
      let mergedAdEnabled = primary.adEnabled;

      for (const dup of duplicates) {
        if (!mergedDisplayName && dup.displayName) mergedDisplayName = dup.displayName;
        if (!mergedEmail && dup.email) mergedEmail = dup.email;
        if (!mergedDepartment && dup.department) mergedDepartment = dup.department;
        if (!mergedTitle && dup.title) mergedTitle = dup.title;
        if (dup.adEnabled !== undefined) mergedAdEnabled = dup.adEnabled;

      // FIX-12: Remplacer les .catch(() => {}) vides par des logs d'avertissement
        await db.update(userGroupMemberships).set({ userId: primary.id }).where(eq(userGroupMemberships.userId, dup.id)).catch((err) => {
          console.warn(`Merge users: impossible de réassigner les memberships du doublon ${dup.id}: ${err.message}`);
        });
        await db.update(machineSessions).set({ userId: primary.id }).where(eq(machineSessions.userId, dup.id)).catch((err) => {
          console.warn(`Merge users: impossible de réassigner les sessions du doublon ${dup.id}: ${err.message}`);
        });
        await db.update(rawAcl).set({ userId: primary.id }).where(eq(rawAcl.userId, dup.id)).catch((err) => {
          console.warn(`Merge users: impossible de réassigner les ACL du doublon ${dup.id}: ${err.message}`);
        });
        await db.update(effectivePermissions).set({ userId: primary.id }).where(eq(effectivePermissions.userId, dup.id)).catch((err) => {
          console.warn(`Merge users: impossible de réassigner les permissions du doublon ${dup.id}: ${err.message}`);
        });
        await db.update(m365Licenses).set({ userId: primary.id }).where(eq(m365Licenses.userId, dup.id)).catch((err) => {
          console.warn(`Merge users: impossible de réassigner les licences du doublon ${dup.id}: ${err.message}`);
        });

        await db.delete(users).where(eq(users.id, dup.id)).catch((err) => {
          console.warn(`Merge users: impossible de supprimer le doublon ${dup.id}: ${err.message}`);
        });
      }

      await db.update(users).set({
        displayName: mergedDisplayName,
        email: mergedEmail,
        department: mergedDepartment,
        title: mergedTitle,
        adEnabled: mergedAdEnabled,
        updatedAt: new Date()
      }).where(eq(users.id, primary.id));
    }
  }
}

export async function mergeDuplicateGroups() {
  const allGroups = await db.select().from(groups);
  const byName = new Map<string, typeof allGroups>();

  for (const group of allGroups) {
    const key = (group.name || "").toLowerCase().trim();
    if (!key) continue;
    const list = byName.get(key) || [];
    list.push(group);
    byName.set(key, list);
  }

  for (const [name, groupList] of byName.entries()) {
    if (groupList.length > 1) {
      const primary = groupList[0];
      const duplicates = groupList.slice(1);

      let mergedDescription = primary.description;
      let mergedType = primary.groupType;

      for (const dup of duplicates) {
        if (!mergedDescription && dup.description) mergedDescription = dup.description;
        if (!mergedType && dup.groupType) mergedType = dup.groupType;

        await db.update(userGroupMemberships).set({ groupId: primary.id }).where(eq(userGroupMemberships.groupId, dup.id)).catch((err) => {
          console.warn(`Merge groups: impossible de réassigner les memberships du groupe ${dup.id}: ${err.message}`);
        });
        await db.update(rawAcl).set({ groupId: primary.id }).where(eq(rawAcl.groupId, dup.id)).catch((err) => {
          console.warn(`Merge groups: impossible de réassigner les ACL du groupe ${dup.id}: ${err.message}`);
        });
        await db.update(effectivePermissions).set({ originGroupId: primary.id }).where(eq(effectivePermissions.originGroupId, dup.id)).catch((err) => {
          console.warn(`Merge groups: impossible de réassigner les permissions du groupe ${dup.id}: ${err.message}`);
        });
        await db.delete(groups).where(eq(groups.id, dup.id)).catch((err) => {
          console.warn(`Merge groups: impossible de supprimer le groupe doublon ${dup.id}: ${err.message}`);
        });
      }

      await db.update(groups).set({
        description: mergedDescription,
        groupType: mergedType,
        updatedAt: new Date()
      }).where(eq(groups.id, primary.id));
    }
  }
}

export async function mergeDuplicateMachines() {
  const allMachines = await db.select().from(machines);
  const byHostname = new Map<string, typeof allMachines>();

  for (const m of allMachines) {
    const key = (m.hostname || "").toLowerCase().trim();
    if (!key) continue;
    const list = byHostname.get(key) || [];
    list.push(m);
    byHostname.set(key, list);
  }

  for (const [hostname, mList] of byHostname.entries()) {
    if (mList.length > 1) {
      // FIX-01: lastSeenAt n'existe pas dans le schéma — utiliser uniquement lastCheckinAt
      mList.sort((a, b) => {
        const timeA = a.lastCheckinAt ? new Date(a.lastCheckinAt).getTime() : 0;
        const timeB = b.lastCheckinAt ? new Date(b.lastCheckinAt).getTime() : 0;
        return timeB - timeA;
      });

      const primary = mList[0];
      const duplicates = mList.slice(1);

      for (const dup of duplicates) {
        await db.update(machineSessions).set({ machineId: primary.id }).where(eq(machineSessions.machineId, dup.id)).catch((err) => {
          console.warn(`Merge machines: impossible de réassigner les sessions du doublon ${dup.id}: ${err.message}`);
        });
        await db.update(machineMetrics).set({ machineId: primary.id }).where(eq(machineMetrics.machineId, dup.id)).catch((err) => {
          console.warn(`Merge machines: impossible de réassigner les métriques du doublon ${dup.id}: ${err.message}`);
        });
        await db.update(resources).set({ hostingMachineId: primary.id }).where(eq(resources.hostingMachineId, dup.id)).catch((err) => {
          console.warn(`Merge machines: impossible de réassigner les ressources du doublon ${dup.id}: ${err.message}`);
        });
        await db.delete(machines).where(eq(machines.id, dup.id)).catch((err) => {
          console.warn(`Merge machines: impossible de supprimer la machine doublon ${dup.id}: ${err.message}`);
        });
      }
    }
  }
}

export async function recomputeEffectivePermissions(targetResourceId?: string) {
  const allResources = targetResourceId 
    ? await db.select().from(resources).where(eq(resources.id, targetResourceId))
    : await db.select().from(resources);

  for (const resource of allResources) {
    const acls = await db.select().from(rawAcl).where(eq(rawAcl.resourceId, resource.id));
    await db.delete(effectivePermissions).where(eq(effectivePermissions.resourceId, resource.id));

    if (acls.length === 0) continue;

    const effectiveMap = new Map<string, { userId: string; resourceId: string; accessLevel: string; originType: string; originGroupId: string | null }>();

    for (const entry of acls) {
      if (entry.userId) {
        const key = `${entry.userId}-${resource.id}-${entry.accessLevel}-direct`;
        effectiveMap.set(key, {
          userId: entry.userId,
          resourceId: resource.id,
          accessLevel: entry.accessLevel,
          originType: "direct",
          originGroupId: null
        });
      } else if (entry.groupId) {
        const groupMembers = await db.select({ userId: userGroupMemberships.userId })
          .from(userGroupMemberships)
          .where(eq(userGroupMemberships.groupId, entry.groupId));

        for (const member of groupMembers) {
          const key = `${member.userId}-${resource.id}-${entry.accessLevel}-inherited_group`;
          effectiveMap.set(key, {
            userId: member.userId,
            resourceId: resource.id,
            accessLevel: entry.accessLevel,
            originType: "inherited_group",
            originGroupId: entry.groupId
          });
        }
      }
    }

    if (effectiveMap.size > 0) {
      await db.insert(effectivePermissions).values(Array.from(effectiveMap.values())).onConflictDoNothing();
    }
  }
}

export async function seedInitialAclsAndMemberships() {
  const allUsers = await db.select().from(users);
  const allGroups = await db.select().from(groups);
  const allResources = await db.select().from(resources);

  if (allUsers.length === 0 || allGroups.length === 0 || allResources.length === 0) return;

  // 1. Seed user_group_memberships if empty
  const existingMemberships = await db.select().from(userGroupMemberships).limit(1);
  if (existingMemberships.length === 0) {
    const membershipsToInsert = [];
    for (let i = 0; i < allUsers.length; i++) {
      const u = allUsers[i];
      // Assign 1-2 groups per user based on index
      const primaryGroup = allGroups[i % allGroups.length];
      membershipsToInsert.push({ userId: u.id, groupId: primaryGroup.id });
    }
    if (membershipsToInsert.length > 0) {
      await db.insert(userGroupMemberships).values(membershipsToInsert).onConflictDoNothing();
    }
  }

  // 2. Seed raw_acl if empty
  const existingAcls = await db.select().from(rawAcl).limit(1);
  if (existingAcls.length === 0) {
    const aclsToInsert = [];
    for (const r of allResources) {
      const pathLower = r.path.toLowerCase();

      if (pathLower.includes('personnel$') || pathLower.includes('homes')) {
        // Personal folder: Grant direct access to user matching folder name
        const parts = r.path.split(/[\\/]/);
        const folderName = parts[parts.length - 1];
        const matchedUser = allUsers.find(u => u.username.toLowerCase() === folderName.toLowerCase());
        if (matchedUser) {
          aclsToInsert.push({
            resourceId: r.id,
            userId: matchedUser.id,
            groupId: null,
            accessLevel: "Contrôle Total (FullControl)",
            collectedAt: new Date()
          });
        }
      } else {
        // Shared company folder: Grant ACLs to AD groups
        const sampleGroup1 = allGroups[0];
        const sampleGroup2 = allGroups[1 % allGroups.length];

        aclsToInsert.push({
          resourceId: r.id,
          userId: null,
          groupId: sampleGroup1.id,
          accessLevel: "Contrôle Total (FullControl)",
          collectedAt: new Date()
        });

        if (sampleGroup2 && sampleGroup2.id !== sampleGroup1.id) {
          aclsToInsert.push({
            resourceId: r.id,
            userId: null,
            groupId: sampleGroup2.id,
            accessLevel: "Modification (Modify)",
            collectedAt: new Date()
          });
        }
      }
    }

    if (aclsToInsert.length > 0) {
      await db.insert(rawAcl).values(aclsToInsert);
    }
  }

  // 3. Compute real effective permissions from DB ACLs + Memberships
  await recomputeEffectivePermissions();

  // 4. Seed & update m365_licenses for all users
  // FIX-02: Suppression du biais isDjaelOrAdmin — MFA uniquement via sync M365 réelle
  for (const u of allUsers) {
    const sku = "Microsoft 365 Business Premium";

    const userLic = await db.select().from(m365Licenses).where(eq(m365Licenses.userId, u.id)).limit(1);
    if (userLic.length === 0) {
      await db.insert(m365Licenses).values({
        userId: u.id,
        licenseSku: sku,
        mfaEnabled: false, // Par défaut false — à activer via sync M365 réelle
        lastSyncedAt: new Date()
      }).catch((err) => {
        console.warn(`Seed licences: impossible d'insérer pour ${u.id}: ${err.message}`);
      });
    }
  }
}

export const connectorRoutes: FastifyPluginAsync = async (fastify, opts) => {

  // FIX-05: Authentification par secret partagé sur toutes les routes connecteurs
  fastify.addHook('preHandler', async (request, reply) => {
    const secret = request.headers['x-connector-secret'] as string;
    if (!secret || secret !== process.env.CONNECTOR_SECRET) {
      // En mode développement (pas de secret configuré), on laisse passer pour compatibilité
      if (process.env.CONNECTOR_SECRET && process.env.CONNECTOR_SECRET.length > 0) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'X-Connector-Secret invalide ou manquant' });
      }
    }
  });

  // 1. Synchro Active Directory
  fastify.post("/ad/sync", async (request, reply) => {
    try {
      const payload = request.body as any;
      if (!payload || !payload.users || !payload.groups) {
        return reply.status(400).send({ error: "Bad Request", message: "Missing users or groups in payload" });
      }

      // Smart Upsert Users by adGuid OR username
      for (const u of payload.users) {
        const existing = await db.select().from(users).where(
          or(eq(users.adGuid, u.adGuid), eq(users.username, u.username))
        ).limit(1);

        if (existing.length > 0) {
          const ex = existing[0];
          await db.update(users).set({
            adGuid: u.adGuid || ex.adGuid,
            username: u.username,
            displayName: u.displayName || ex.displayName,
            email: u.email || ex.email,
            department: u.department || ex.department,
            title: u.title || ex.title,
            adEnabled: u.adEnabled !== undefined ? u.adEnabled : ex.adEnabled,
            updatedAt: new Date()
          }).where(eq(users.id, ex.id));
        } else {
          await db.insert(users).values({
            adGuid: u.adGuid,
            username: u.username,
            displayName: u.displayName,
            email: u.email,
            department: u.department,
            title: u.title,
            adEnabled: u.adEnabled ?? true,
            updatedAt: new Date()
          });
        }
      }

      // Smart Upsert Groups by adGuid OR name
      for (const g of payload.groups) {
        const existing = await db.select().from(groups).where(
          or(eq(groups.adGuid, g.adGuid), eq(groups.name, g.name))
        ).limit(1);

        if (existing.length > 0) {
          const ex = existing[0];
          await db.update(groups).set({
            adGuid: g.adGuid || ex.adGuid,
            name: g.name,
            groupType: g.groupType || ex.groupType,
            description: g.description || ex.description,
            updatedAt: new Date()
          }).where(eq(groups.id, ex.id));
        } else {
          await db.insert(groups).values({
            adGuid: g.adGuid,
            name: g.name,
            groupType: g.groupType,
            description: g.description,
            updatedAt: new Date()
          });
        }
      }

      // Nettoyage des doublons éventuels
      await mergeDuplicateUsers();
      await mergeDuplicateGroups();

      // FIX-11: Sync diff-based des memberships (remplace la suppression totale brutale)
      // Plus de DELETE sans WHERE qui effaçait TOUS les memberships de la DB
      if (payload.memberships && Array.isArray(payload.memberships)) {
        // Reconstruire le set de paires (userId, groupId) du nouveau payload
        const newMembershipKeys = new Set<string>();
        const membershipsToInsert: { userId: string; groupId: string }[] = [];

        for (const m of payload.memberships) {
          const userRec = await db.query.users.findFirst({ where: eq(users.adGuid, m.userGuid) });
          const groupRec = await db.query.groups.findFirst({ where: eq(groups.adGuid, m.groupGuid) });
          if (userRec && groupRec) {
            const key = `${userRec.id}|${groupRec.id}`;
            newMembershipKeys.add(key);
            membershipsToInsert.push({ userId: userRec.id, groupId: groupRec.id });
          }
        }

        // Supprimer UNIQUEMENT les memberships qui ne sont plus dans le payload
        const existingMemberships = await db.select().from(userGroupMemberships);
        for (const existing of existingMemberships) {
          const key = `${existing.userId}|${existing.groupId}`;
          if (!newMembershipKeys.has(key)) {
            await db.delete(userGroupMemberships)
              .where(and(eq(userGroupMemberships.userId, existing.userId), eq(userGroupMemberships.groupId, existing.groupId)))
              .catch((err) => console.warn(`Sync AD: impossible de supprimer membership obsolète: ${err.message}`));
          }
        }

        // Insérer les nouveaux memberships (onConflictDoNothing = idempotent)
        if (membershipsToInsert.length > 0) {
          await db.insert(userGroupMemberships).values(membershipsToInsert).onConflictDoNothing();
        }
      }

      await recomputeEffectivePermissions();

      return { status: "success", message: "AD Sync completed" };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error", message: "AD Sync failed" });
    }
  });

  // 2. Synchro M365 (Licences & MFA)
  fastify.post("/m365/sync", async (request, reply) => {
    try {
      const payload = request.body as any;
      if (!payload || !payload.licenses) {
        return reply.status(400).send({ error: "Bad Request", message: "Missing licenses data" });
      }

      for (const lic of payload.licenses) {
        const userRec = await db.query.users.findFirst({ where: eq(users.adGuid, lic.userAdGuid) });
        if (userRec) {
          // FIX-15: Upsert au lieu de DELETE + INSERT pour éviter les doublons lors d'une re-sync
          await db.insert(m365Licenses).values({
            userId: userRec.id,
            licenseSku: lic.licenseSku,
            mfaEnabled: lic.mfaEnabled,
            lastSyncedAt: new Date()
          }).onConflictDoUpdate({
            target: m365Licenses.userId,
            set: {
              licenseSku: lic.licenseSku,
              mfaEnabled: lic.mfaEnabled,
              lastSyncedAt: new Date()
            }
          });
        }
      }

      return { status: "success", message: "M365 Sync completed" };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error", message: "M365 Sync failed" });
    }
  });

  // 3. Synchro Permissions (SMB & SharePoint)
  fastify.post("/permissions/sync", async (request, reply) => {
    try {
      const payload = request.body as any;
      if (!payload || !payload.resourcePath || !payload.resourceType || !payload.acls) {
        return reply.status(400).send({ error: "Bad Request", message: "Missing resource data" });
      }

      const [resource] = await db.insert(resources).values({
        path: payload.resourcePath,
        resourceType: payload.resourceType,
        lastScannedAt: new Date()
      }).onConflictDoUpdate({
        target: resources.path,
        set: {
          lastScannedAt: new Date()
        }
      }).returning();

      await db.delete(rawAcl).where(eq(rawAcl.resourceId, resource.id));

      if (payload.acls.length > 0) {
        for (const acl of payload.acls) {
          let resolvedUserId = null;
          let resolvedGroupId = null;

          if (acl.userAdGuid) {
            const u = await db.query.users.findFirst({ where: eq(users.adGuid, acl.userAdGuid) });
            if (u) resolvedUserId = u.id;
          } else if (acl.groupAdGuid) {
            const g = await db.query.groups.findFirst({ where: eq(groups.adGuid, acl.groupAdGuid) });
            if (g) resolvedGroupId = g.id;
          }

          if (resolvedUserId || resolvedGroupId) {
            await db.insert(rawAcl).values({
              resourceId: resource.id,
              userId: resolvedUserId,
              groupId: resolvedGroupId,
              accessLevel: acl.accessLevel,
              collectedAt: new Date()
            });
          }
        }
      }

      await recomputeEffectivePermissions(resource.id);

      return { status: "success", message: "Permissions Sync completed", resourceId: resource.id };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error", message: "Permissions Sync failed" });
    }
  });

};
