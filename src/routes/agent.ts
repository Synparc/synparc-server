import { FastifyPluginAsync } from "fastify";
import { db } from "../db/index.js";
import { machines } from "../db/schema.js";
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

};
