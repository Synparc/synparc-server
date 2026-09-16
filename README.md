# synparc-server

> âš™ï¸ Backend central de la plateforme Synparc â€” API REST, moteur de corrÃ©lation et gestion des migrations PostgreSQL/TimescaleDB.

## Stack

- **Runtime** : Node.js 20+ avec TypeScript
- **Framework** : Fastify (ou Express)
- **Base de donnÃ©es** : PostgreSQL 15 + extension TimescaleDB
- **Migrations** : node-pg-migrate ou Flyway
- **Authentification** : JWT (dashboard) + Bearer token (agents)

## ResponsabilitÃ©s

| Module | Description |
|--------|-------------|
| ðŸ”Œ API REST | Endpoints pour agents, dashboard web et connecteurs |
| ðŸ§  Moteur de corrÃ©lation | Job planifiÃ© qui calcule `effective_permissions` |
| ðŸ—„ï¸ Migrations DB | Gestion du schÃ©ma PostgreSQL/TimescaleDB |
| ðŸ“¥ Ingestion mÃ©triques | RÃ©ception et stockage des heartbeats agents dans TimescaleDB |
| ðŸ” Gestion enrÃ´lement | GÃ©nÃ©ration et validation des tokens machines |

## Architecture des endpoints

\\\
POST   /api/v1/agent/heartbeat          # RÃ©ception mÃ©triques + sessions (agents)
POST   /api/v1/agent/enroll            # EnrÃ´lement d'une nouvelle machine

GET    /api/v1/users                   # Liste des utilisateurs AD
GET    /api/v1/users/:guid             # Fiche utilisateur croisÃ©e
GET    /api/v1/machines                # Liste des machines
GET    /api/v1/permissions/:userGuid   # Permissions effectives d'un utilisateur

POST   /api/v1/sync/ad                 # DÃ©clenchement sync AD (depuis connecteurs)
POST   /api/v1/sync/m365              # DÃ©clenchement sync M365
\\\

## Variables d'environnement

\\\env
DATABASE_URL=postgresql://user:password@localhost:5432/synparc
JWT_SECRET=your-jwt-secret
AGENT_TOKEN_SALT=your-salt
PORT=3001
\\\

## DÃ©veloppement local

\\\ash
npm install
npm run migrate       # Applique les migrations DB
npm run dev           # DÃ©marre en mode dÃ©veloppement (ts-node-dev)
npm run build         # Compile en JavaScript
npm start             # DÃ©marre la version compilÃ©e
\\\

## SchÃ©ma de base de donnÃ©es

Voir [ARCHITECTURE.md](https://github.com/Synparc/synparc-internal) dans le dÃ©pÃ´t interne pour le schÃ©ma complet.