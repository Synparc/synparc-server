import Fastify from "fastify";
import "dotenv/config";
import { db } from "./db/index.js";
import { sql } from "drizzle-orm";

import { agentRoutes } from "./routes/agent.js";
import { connectorRoutes } from "./routes/connectors.js";
import { webRoutes } from "./routes/web.js";

import cors from "@fastify/cors";

const fastify = Fastify({
  logger: true,
});

fastify.register(cors, {
  origin: "*", // Pour le dev local
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
});

// Enregistrement des routes
fastify.register(agentRoutes, { prefix: "/api/agent" });
fastify.register(connectorRoutes, { prefix: "/api/connectors" });
fastify.register(webRoutes, { prefix: "/api/web" });

// Route de base pour vérifier que le serveur tourne
fastify.get("/health", async (request, reply) => {
  try {
    // Vérification de la connexion à la base de données
    const result = await db.execute(sql`SELECT 1 as is_alive`);
    return { 
      status: "ok", 
      message: "Synparc Server is running",
      db_alive: result.length > 0 
    };
  } catch (error) {
    fastify.log.error(error);
    reply.status(500).send({ status: "error", message: "Database connection failed" });
  }
});

// Démarrage du serveur
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || "3001");
    await fastify.listen({ port, host: "0.0.0.0" });
    console.log(`🚀 Synparc Server listening on http://localhost:${port}`);
    console.log(fastify.printRoutes());
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
