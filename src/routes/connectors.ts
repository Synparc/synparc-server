import { FastifyPluginAsync } from "fastify";
import { db } from "../db/index.js";
import { users, groups, userGroupMemberships, groupGroupMemberships, m365Licenses, resources, rawAcl } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";

export const connectorRoutes: FastifyPluginAsync = async (fastify, opts) => {
  
  // 1. Synchro Active Directory
  fastify.post("/ad/sync", async (request, reply) => {
    try {
      const payload = request.body as any;
      if (!payload || !payload.users || !payload.groups) {
        return reply.status(400).send({ error: "Bad Request", message: "Missing users or groups in payload" });
      }

      // Upsert Users (en vrai, on devrait faire ça par lot (batch) si > 1000 users)
      for (const u of payload.users) {
        await db.insert(users).values({
          adGuid: u.adGuid,
          username: u.username,
          displayName: u.displayName,
          email: u.email,
          department: u.department,
          title: u.title,
          adEnabled: u.adEnabled,
          updatedAt: new Date()
        }).onConflictDoUpdate({
          target: users.adGuid,
          set: {
            username: u.username,
            displayName: u.displayName,
            email: u.email,
            department: u.department,
            title: u.title,
            adEnabled: u.adEnabled,
            updatedAt: new Date()
          }
        });
      }

      // Upsert Groups
      for (const g of payload.groups) {
        await db.insert(groups).values({
          adGuid: g.adGuid,
          name: g.name,
          groupType: g.groupType,
          description: g.description,
          updatedAt: new Date()
        }).onConflictDoUpdate({
          target: groups.adGuid,
          set: {
            name: g.name,
            groupType: g.groupType,
            description: g.description,
            updatedAt: new Date()
          }
        });
      }

      // Les memberships (user_group_memberships) devraient idéalement être synchronisés ici en mode TRUNCATE/INSERT ou différentiel.
      // Simplification pour v1 : on assume que le payload contient les memberships complets.

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
        // Resolve user by AD Guid
        const userRec = await db.query.users.findFirst({ where: eq(users.adGuid, lic.userAdGuid) });
        if (userRec) {
          await db.insert(m365Licenses).values({
            userId: userRec.id,
            licenseSku: lic.licenseSku,
            mfaEnabled: lic.mfaEnabled,
            lastSyncedAt: new Date()
          }); // Note: M365 licenses should probably have a unique constraint on (userId, licenseSku) to allow Upsert
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

      // Upsert Resource
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

      // Remplacement des Raw ACLs (TRUNCATE partiel / Delete then Insert)
      await db.delete(rawAcl).where(eq(rawAcl.resourceId, resource.id));

      if (payload.acls.length > 0) {
        for (const acl of payload.acls) {
          // Resolve User or Group AD Guid to DB ID
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

      return { status: "success", message: "Permissions Sync completed", resourceId: resource.id };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error", message: "Permissions Sync failed" });
    }
  });

};
