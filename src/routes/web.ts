import { FastifyPluginAsync } from "fastify";
import { db } from "../db/index.js";
import { machines, users, effectivePermissions, resources, machineMetrics } from "../db/schema.js";
import { eq, desc, and } from "drizzle-orm";

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

  // 3. Métriques historiques (TimescaleDB)
  fastify.get("/metrics/:machineId", async (request, reply) => {
    try {
      const { machineId } = request.params as any;
      // Option: Ajouter un filtre de temps "last 24h"
      // WHERE time > NOW() - INTERVAL '24 hours'
      // En Drizzle avec raw SQL :
      const metrics = await db.query.machineMetrics.findMany({
        where: eq(machineMetrics.machineId, machineId),
        orderBy: [desc(machineMetrics.time)],
        limit: 100 // Limite basique pour la v1
      });
      return { status: "success", data: metrics };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  // 4. Moteur de recherche des permissions effectives
  fastify.get("/permissions/search", async (request, reply) => {
    try {
      const query = request.query as any;
      // On peut filtrer par userId ou par resourceId
      
      let filter = undefined;
      if (query.userId && query.resourceId) {
        filter = and(eq(effectivePermissions.userId, query.userId), eq(effectivePermissions.resourceId, query.resourceId));
      } else if (query.userId) {
        filter = eq(effectivePermissions.userId, query.userId);
      } else if (query.resourceId) {
        filter = eq(effectivePermissions.resourceId, query.resourceId);
      }

      const results = await db.select({
        accessLevel: effectivePermissions.accessLevel,
        originType: effectivePermissions.originType,
        username: users.username,
        resourcePath: resources.path
      })
      .from(effectivePermissions)
      .leftJoin(users, eq(effectivePermissions.userId, users.id))
      .leftJoin(resources, eq(effectivePermissions.resourceId, resources.id))
      .where(filter)
      .limit(200);

      return { status: "success", data: results };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

};
