# synparc-server

> ⚙️ Backend central de la plateforme Synparc — API REST, moteur de corrélation et gestion des migrations PostgreSQL/TimescaleDB.

## Stack

- **Runtime** : Node.js 20+ avec TypeScript
- **Framework** : Fastify (ou Express)
- **Base de données** : PostgreSQL 15 + extension TimescaleDB
- **Migrations** : node-pg-migrate
- **Authentification** : JWT (dashboard) + Bearer token (agents)

## Responsabilités

| Module | Description |
|--------|-------------|
| 🔌 API REST | Endpoints pour agents, dashboard web et connecteurs |
| 🧠 Moteur de corrélation | Job planifié qui calcule `effective_permissions` |
| 🗄️ Migrations DB | Gestion du schéma PostgreSQL/TimescaleDB |
| 📥 Ingestion métriques | Réception et stockage des heartbeats agents dans TimescaleDB |
| 🔐 Gestion enrôlement | Génération et validation des tokens machines |

## Endpoints principaux

```
POST   /api/v1/agent/heartbeat          # Réception métriques + sessions (agents)
POST   /api/v1/agent/enroll            # Enrôlement d'une nouvelle machine

GET    /api/v1/users                   # Liste des utilisateurs AD
GET    /api/v1/users/:guid             # Fiche utilisateur croisée
GET    /api/v1/machines                # Liste des machines
GET    /api/v1/permissions/:userGuid   # Permissions effectives d'un utilisateur

POST   /api/v1/sync/ad                 # Déclenchement sync AD (depuis connecteurs)
POST   /api/v1/sync/m365              # Déclenchement sync M365
```

## Variables d'environnement

```env
DATABASE_URL=postgresql://user:password@localhost:5432/synparc
JWT_SECRET=your-jwt-secret
AGENT_TOKEN_SALT=your-salt
PORT=3001
```

## Développement local

```bash
npm install
npm run migrate       # Applique les migrations DB
npm run dev           # Démarre en mode développement (ts-node-dev)
npm run build         # Compile TypeScript -> JavaScript
npm start             # Démarre la version compilée
```

## Schéma de base de données

Voir [ARCHITECTURE.md](https://github.com/Synparc/synparc-internal) (dépôt privé) pour le schéma SQL complet.
