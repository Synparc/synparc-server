import { FastifyPluginAsync } from "fastify";
import { db } from "../db/index.js";
import { users, groups, userGroupMemberships, groupGroupMemberships, m365Licenses, resources, rawAcl, machineSessions, effectivePermissions } from "../db/schema.js";
import { eq, or, sql } from "drizzle-orm";

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

        await db.update(userGroupMemberships).set({ userId: primary.id }).where(eq(userGroupMemberships.userId, dup.id)).catch(() => {});
        await db.update(machineSessions).set({ userId: primary.id }).where(eq(machineSessions.userId, dup.id)).catch(() => {});
        await db.update(rawAcl).set({ userId: primary.id }).where(eq(rawAcl.userId, dup.id)).catch(() => {});
        await db.update(effectivePermissions).set({ userId: primary.id }).where(eq(effectivePermissions.userId, dup.id)).catch(() => {});
        await db.update(m365Licenses).set({ userId: primary.id }).where(eq(m365Licenses.userId, dup.id)).catch(() => {});

        await db.delete(users).where(eq(users.id, dup.id)).catch(() => {});
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

        await db.update(userGroupMemberships).set({ groupId: primary.id }).where(eq(userGroupMemberships.groupId, dup.id)).catch(() => {});
        await db.update(rawAcl).set({ groupId: primary.id }).where(eq(rawAcl.groupId, dup.id)).catch(() => {});
        await db.update(effectivePermissions).set({ originGroupId: primary.id }).where(eq(effectivePermissions.originGroupId, dup.id)).catch(() => {});
        await db.delete(groups).where(eq(groups.id, dup.id)).catch(() => {});
      }

      await db.update(groups).set({
        description: mergedDescription,
        groupType: mergedType,
        updatedAt: new Date()
      }).where(eq(groups.id, primary.id));
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
  for (const u of allUsers) {
    const un = (u.username || "").toLowerCase();
    const dn = (u.displayName || "").toLowerCase();
    const email = (u.email || "").toLowerCase();
    const isMfa = un.includes("djael") || dn.includes("djael") || email.includes("djael") || un.includes("admin");
    const sku = (un.includes("djael") || dn.includes("djael") || un.includes("admin")) ? "Microsoft 365 Enterprise E5" : "Microsoft 365 Business Premium";

    const userLic = await db.select().from(m365Licenses).where(eq(m365Licenses.userId, u.id)).limit(1);
    if (userLic.length === 0) {
      await db.insert(m365Licenses).values({
        userId: u.id,
        licenseSku: sku,
        mfaEnabled: isMfa,
        lastSyncedAt: new Date()
      }).catch(() => {});
    } else if (isMfa && !userLic[0].mfaEnabled) {
      await db.update(m365Licenses).set({ mfaEnabled: true }).where(eq(m365Licenses.userId, u.id)).catch(() => {});
    }
  }
}

export const connectorRoutes: FastifyPluginAsync = async (fastify, opts) => {

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

      // Les memberships (user_group_memberships)
      if (payload.memberships && Array.isArray(payload.memberships)) {
        await db.delete(userGroupMemberships);
        
        const membershipsToInsert = [];
        for (const m of payload.memberships) {
          const userRec = await db.query.users.findFirst({ where: eq(users.adGuid, m.userGuid) });
          const groupRec = await db.query.groups.findFirst({ where: eq(groups.adGuid, m.groupGuid) });
          
          if (userRec && groupRec) {
            membershipsToInsert.push({
              userId: userRec.id,
              groupId: groupRec.id
            });
          }
        }
        
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
          await db.delete(m365Licenses).where(eq(m365Licenses.userId, userRec.id));
          
          await db.insert(m365Licenses).values({
            userId: userRec.id,
            licenseSku: lic.licenseSku,
            mfaEnabled: lic.mfaEnabled,
            lastSyncedAt: new Date()
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
