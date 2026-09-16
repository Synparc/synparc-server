import { FastifyPluginAsync } from "fastify";
import { db } from "../db/index.js";
import { machines, machineMetrics, machineSessions, users } from "../db/schema.js";
import { eq } from "drizzle-orm";

export const agentRoutes: FastifyPluginAsync = async (fastify, opts) => {
  
  // Endpoint de Check-in (Appelé par l'agent C# au démarrage et régulièrement)
  fastify.post("/checkin", async (request, reply) => {
    try {
      const payload = request.body as any;

      if (!payload || !payload.adGuid || !payload.hostname) {
        return reply.status(400).send({ 
          error: "Bad Request", 
          message: "adGuid and hostname are required" 
        });
      }

      // Upsert de la machine (Création ou mise à jour)
      const [machine] = await db.insert(machines)
        .values({
          adGuid: payload.adGuid,
          hostname: payload.hostname,
          fqdn: payload.fqdn,
          machineType: payload.machineType,
          osName: payload.osName,
          osVersion: payload.osVersion,
          lastIp: request.ip,
          lastCheckinAt: new Date(),
          lastIpSeenAt: new Date()
        })
        .onConflictDoUpdate({
          target: machines.adGuid,
          set: {
            hostname: payload.hostname,
            fqdn: payload.fqdn,
            machineType: payload.machineType,
            osName: payload.osName,
            osVersion: payload.osVersion,
            lastIp: request.ip,
            lastCheckinAt: new Date(),
            lastIpSeenAt: new Date(),
            updatedAt: new Date()
          }
        })
        .returning();

      fastify.log.info(`✅ Agent check-in successful for ${machine.hostname} (${machine.adGuid})`);

      return {
        status: "success",
        message: "Check-in registered",
        machineId: machine.id
      };

    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ 
        error: "Internal Server Error", 
        message: "Failed to process check-in" 
      });
    }
  });
  // Endpoint d'envoi des métriques (Appelé toutes les X minutes)
  fastify.post("/metrics", async (request, reply) => {
    try {
      const payload = request.body as any;
      if (!payload || !payload.machineId || !payload.metrics) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid payload" });
      }

      // TimescaleDB : insertion en masse (bulk) des métriques
      // payload.metrics = [{ time: "2023-10-10T...", cpuPercent: 12.5, ramPercent: 45.2, uptimeSeconds: 3600 }, ...]
      const recordsToInsert = payload.metrics.map((m: any) => ({
        machineId: payload.machineId,
        time: new Date(m.time),
        cpuPercent: m.cpuPercent,
        ramPercent: m.ramPercent,
        uptimeSeconds: m.uptimeSeconds
      }));

      await db.insert(machineMetrics).values(recordsToInsert);

      return { status: "success", insertedCount: recordsToInsert.length };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error", message: "Failed to insert metrics" });
    }
  });

  // Endpoint de remontée des sessions utilisateurs (Appelé lors d'un login/logoff)
  fastify.post("/sessions", async (request, reply) => {
    try {
      const payload = request.body as any;
      if (!payload || !payload.machineId || !payload.sessionStart) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid session payload" });
      }

      // Resolve user by AD Guid if provided
      let resolvedUserId = null;
      if (payload.userAdGuid) {
        const userRec = await db.query.users.findFirst({
          where: eq(users.adGuid, payload.userAdGuid)
        });
        if (userRec) resolvedUserId = userRec.id;
      }

      const [session] = await db.insert(machineSessions)
        .values({
          machineId: payload.machineId,
          userId: resolvedUserId,
          sessionStart: new Date(payload.sessionStart),
          sessionEnd: payload.sessionEnd ? new Date(payload.sessionEnd) : null,
          sessionType: payload.sessionType || 'interactive'
        })
        .returning();

      return { status: "success", sessionId: session.id };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error", message: "Failed to insert session" });
    }
  });

};
