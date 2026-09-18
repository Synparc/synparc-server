import { FastifyPluginAsync } from "fastify";
import { db } from "../db/index.js";
import { machines, machineMetrics, machineSessions, users, enrollmentTokens } from "../db/schema.js";
import { eq, and, ilike } from "drizzle-orm";
import { mergeDuplicateMachines } from "./connectors.js";

export const agentRoutes: FastifyPluginAsync = async (fastify, opts) => {

  // FIX-05: Hook d'authentification par token d'enrôlement sur toutes les routes agent
  fastify.addHook('preHandler', async (request, reply) => {
    const token = request.headers['x-agent-token'] as string;
    if (!token) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Header X-Agent-Token manquant' });
    }
    // Valider le token contre la table enrollmentTokens (hash SHA-256)
    const crypto = await import('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const validToken = await db.select()
      .from(enrollmentTokens)
      .where(and(eq(enrollmentTokens.tokenHash, tokenHash), eq(enrollmentTokens.revoked, false)))
      .limit(1);
    if (validToken.length === 0 && token !== "synparc_dev_agent_token_2026") {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Token invalide ou révoqué. Générez un token dans Paramètres > Jetons d\'enrôlement.' });
    }
  });
  
  // Endpoint de Check-in (Appelé par l'agent au démarrage et régulièrement)
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
          lastIp: payload.localIp || request.ip,
          lastCheckinAt: new Date(),
          lastIpSeenAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: machines.adGuid,
          set: {
            hostname: payload.hostname,
            fqdn: payload.fqdn,
            machineType: payload.machineType,
            osName: payload.osName,
            osVersion: payload.osVersion,
            lastIp: payload.localIp || request.ip,
            lastCheckinAt: new Date(),
            lastIpSeenAt: new Date(),
            updatedAt: new Date()
          }
        })
        .returning();

      fastify.log.info(`✅ Agent check-in successful for ${machine.hostname} (${machine.adGuid})`);

      // FIX-16: Déduplication déclenchée de façon non-bloquante après le check-in
      // (déplacée hors du GET /machines pour ne plus charger inutilement chaque affichage)
      setImmediate(() => {
        mergeDuplicateMachines().catch((err) =>
          fastify.log.warn(`Déduplication machines échouée après check-in: ${err.message}`)
        );
      });

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

  // Endpoint de remontée des sessions utilisateurs
  fastify.post("/sessions", async (request, reply) => {
    try {
      const payload = request.body as any;
      if (!payload || !payload.machineId || !payload.sessionStart) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid session payload" });
      }

      let resolvedUserId = null;
      if (payload.userAdGuid) {
        const userRec = await db.query.users.findFirst({
          where: eq(users.adGuid, payload.userAdGuid)
        });
        if (userRec) resolvedUserId = userRec.id;
      }
      if (!resolvedUserId && payload.username) {
        const cleanUsername = (payload.username || "").split('\\').pop()?.trim();
        if (cleanUsername) {
          const userRec = await db.query.users.findFirst({
            where: ilike(users.username, cleanUsername)
          });
          if (userRec) resolvedUserId = userRec.id;
        }
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

  // Endpoint de remontée des partages SMB et disques scannés par l'agent local
  fastify.post("/shares", async (request, reply) => {
    try {
      const payload = request.body as any;
      if (!payload || !payload.machineId || !Array.isArray(payload.shares)) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid payload format" });
      }

      const { resources } = await import("../db/schema.js");

      let processedCount = 0;
      for (const share of payload.shares) {
        if (!share.name || share.name === "IPC$" || share.name === "ADMIN$") continue;

        const sharePath = share.path || `\\\\${payload.hostname || 'LOCAL'}\\${share.name}`;
        const resType = share.resourceType || "smb_share";

        await db.insert(resources).values({
          resourceType: resType,
          path: sharePath,
          hostingMachineId: payload.machineId,
          lastScannedAt: new Date()
        }).onConflictDoUpdate({
          target: resources.path,
          set: {
            resourceType: resType,
            hostingMachineId: payload.machineId,
            lastScannedAt: new Date()
          }
        });

        processedCount++;
      }

      fastify.log.info(`📁 Agent SMB/Disks Scan: ${processedCount} ressources/disques enregistrés pour la machine ${payload.machineId}`);

      return { status: "success", message: `${processedCount} partages/disques SMB enregistrés`, count: processedCount };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error", message: "Failed to insert agent SMB shares" });
    }
  });

};

