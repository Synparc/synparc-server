import { FastifyPluginAsync } from "fastify";
import { db } from "../db/index.js";
import { machines, users, effectivePermissions, resources, machineMetrics, syncRuns, licenseKeys, enrollmentTokens, userGroupMemberships, groups, machineSessions, m365Licenses } from "../db/schema.js";
import { eq, desc, and, or, ilike } from "drizzle-orm";

export const webRoutes: FastifyPluginAsync = async (fastify, opts) => {
  
  // 1. Liste des machines
  fastify.get("/machines", async (request, reply) => {
    try {
      const allMachines = await db.select().from(machines).orderBy(desc(machines.lastCheckinAt));
      return { status: "success", data: allMachines };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  // 1b. Détails d'une machine
  fastify.get("/machines/:id", async (request, reply) => {
    try {
      const { id } = request.params as any;
      
      const [machine] = await db.select().from(machines).where(eq(machines.id, id)).limit(1);
      if (!machine) {
        return reply.status(404).send({ error: "Machine non trouvée" });
      }

      const hostedResources = await db.select().from(resources).where(eq(resources.hostingMachineId, id));
      
      const sessions = await db.select({
        id: machineSessions.id,
        sessionStart: machineSessions.sessionStart,
        sessionEnd: machineSessions.sessionEnd,
        sessionType: machineSessions.sessionType,
        username: users.username,
        displayName: users.displayName,
        userId: users.id
      })
      .from(machineSessions)
      .leftJoin(users, eq(machineSessions.userId, users.id))
      .where(eq(machineSessions.machineId, id))
      .orderBy(desc(machineSessions.sessionStart))
      .limit(20);

      const metrics = await db.select()
        .from(machineMetrics)
        .where(eq(machineMetrics.machineId, id))
        .orderBy(desc(machineMetrics.time))
        .limit(30);

      return {
        status: "success",
        data: {
          machine,
          resources: hostedResources,
          sessions,
          metrics
        }
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  // 2. Liste des utilisateurs
  fastify.get("/users", async (request, reply) => {
    try {
      const allUsers = await db.select().from(users).orderBy(users.username);
      return { status: "success", data: allUsers };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  // 2b. Détails d'un utilisateur
  fastify.get("/users/:id", async (request, reply) => {
    try {
      const { id } = request.params as any;

      const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!user) {
        return reply.status(404).send({ error: "Utilisateur non trouvé" });
      }

      const userGroups = await db.select({
        id: groups.id,
        name: groups.name,
        groupType: groups.groupType,
        description: groups.description
      })
      .from(userGroupMemberships)
      .innerJoin(groups, eq(userGroupMemberships.groupId, groups.id))
      .where(eq(userGroupMemberships.userId, id));

      const userSessions = await db.select({
        id: machineSessions.id,
        sessionStart: machineSessions.sessionStart,
        sessionEnd: machineSessions.sessionEnd,
        sessionType: machineSessions.sessionType,
        hostname: machines.hostname,
        machineId: machines.id
      })
      .from(machineSessions)
      .leftJoin(machines, eq(machineSessions.machineId, machines.id))
      .where(eq(machineSessions.userId, id))
      .orderBy(desc(machineSessions.sessionStart))
      .limit(20);

      const userPermissions = await db.select({
        accessLevel: effectivePermissions.accessLevel,
        originType: effectivePermissions.originType,
        resourcePath: resources.path,
        machineName: machines.hostname,
        machineId: machines.id
      })
      .from(effectivePermissions)
      .leftJoin(resources, eq(effectivePermissions.resourceId, resources.id))
      .leftJoin(machines, eq(resources.hostingMachineId, machines.id))
      .where(eq(effectivePermissions.userId, id));

      const userLicenses = await db.select().from(m365Licenses).where(eq(m365Licenses.userId, id));

      return {
        status: "success",
        data: {
          user,
          groups: userGroups,
          sessions: userSessions,
          permissions: userPermissions,
          licenses: userLicenses
        }
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  // 3. Métriques historiques (TimescaleDB)
  fastify.get("/metrics/:machineId", async (request, reply) => {
    try {
      const { machineId } = request.params as any;
      const metrics = await db.query.machineMetrics.findMany({
        where: eq(machineMetrics.machineId, machineId),
        orderBy: [desc(machineMetrics.time)],
        limit: 100
      });
      return { status: "success", data: metrics };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  // 4. Moteur de Recherche Global (Unifié)
  fastify.get("/search", async (request, reply) => {
    try {
      const query = request.query as any;
      const q = query.q ? String(query.q).trim() : "";

      if (!q) {
        return {
          status: "success",
          data: {
            foundUsers: [],
            foundMachines: [],
            foundPermissions: []
          }
        };
      }

      const term = `%${q}%`;

      const foundUsers = await db.select().from(users)
        .where(
          or(
            ilike(users.username, term),
            ilike(users.displayName, term),
            ilike(users.email, term),
            ilike(users.department, term)
          )
        )
        .limit(50);

      const foundMachines = await db.select().from(machines)
        .where(
          or(
            ilike(machines.hostname, term),
            ilike(machines.fqdn, term),
            ilike(machines.osName, term),
            ilike(machines.lastIp, term)
          )
        )
        .limit(50);

      const foundPermissions = await db.select({
        accessLevel: effectivePermissions.accessLevel,
        originType: effectivePermissions.originType,
        username: users.username,
        displayName: users.displayName,
        userId: users.id,
        resourcePath: resources.path,
        machineName: machines.hostname,
        machineId: machines.id
      })
      .from(effectivePermissions)
      .leftJoin(users, eq(effectivePermissions.userId, users.id))
      .leftJoin(resources, eq(effectivePermissions.resourceId, resources.id))
      .leftJoin(machines, eq(resources.hostingMachineId, machines.id))
      .where(
        or(
          ilike(users.username, term),
          ilike(users.displayName, term),
          ilike(resources.path, term),
          ilike(machines.hostname, term)
        )
      )
      .limit(100);

      return {
        status: "success",
        data: {
          foundUsers,
          foundMachines,
          foundPermissions
        }
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  // 4b. Ancien Moteur de recherche des permissions effectives (compatibilité)
  fastify.get("/permissions/search", async (request, reply) => {
    try {
      const query = request.query as any;
      let filter = undefined;
      
      if (query.q) {
        const term = `%${query.q}%`;
        filter = or(
          ilike(users.username, term),
          ilike(users.displayName, term),
          ilike(resources.path, term),
          ilike(machines.hostname, term)
        );
      }

      const results = await db.select({
        accessLevel: effectivePermissions.accessLevel,
        originType: effectivePermissions.originType,
        username: users.username,
        displayName: users.displayName,
        userId: users.id,
        resourcePath: resources.path,
        machineName: machines.hostname,
        machineId: machines.id,
        sourceGroupId: effectivePermissions.originGroupId
      })
      .from(effectivePermissions)
      .leftJoin(users, eq(effectivePermissions.userId, users.id))
      .leftJoin(resources, eq(effectivePermissions.resourceId, resources.id))
      .leftJoin(machines, eq(resources.hostingMachineId, machines.id))
      .where(filter)
      .limit(200);

      return { status: "success", data: results };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  // 5. Settings: Synchronisations
  fastify.get("/settings/sync-runs", async (request, reply) => {
    try {
      const runs = await db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(50);
      return { status: "success", data: runs };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  // 6. Settings: Licences
  fastify.get("/settings/licenses", async (request, reply) => {
    try {
      const licenses = await db.select().from(licenseKeys);
      return { status: "success", data: licenses };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  // 7. Settings: Jetons d'enrôlement
  fastify.get("/settings/tokens", async (request, reply) => {
    try {
      const tokens = await db.select().from(enrollmentTokens).orderBy(desc(enrollmentTokens.createdAt));
      return { status: "success", data: tokens };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  // 8. Settings: Générer un jeton
  fastify.post("/settings/tokens/generate", async (request, reply) => {
    try {
      const crypto = await import("crypto");
      const randomString = crypto.randomBytes(16).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(randomString).digest("hex");
      
      const [newToken] = await db.insert(enrollmentTokens).values({
        tokenHash: tokenHash,
        revoked: false
      }).returning();
      
      return { status: "success", data: { ...newToken, rawToken: randomString } };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

};

