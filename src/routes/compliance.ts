import { FastifyPluginAsync } from "fastify";
import { db } from "../db/index.js";
import { users, m365Licenses, resources, rawAcl, machines, systemSettings } from "../db/schema.js";
import { eq } from "drizzle-orm";

export interface ComplianceCheckpoint {
  id: string;
  pillarId: string;
  pillarName: string;
  nis2Article: string;
  isoControl: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  status: "pass" | "warn" | "fail";
  scoreImpact: number;
  evidence: string;
  recommendation: string;
  targetUrl?: string;
}

export interface CompliancePillar {
  id: string;
  name: string;
  nis2Article: string;
  isoControl: string;
  score: number;
  status: "conforme" | "partiellement_conforme" | "non_conforme";
  passCount: number;
  warnCount: number;
  failCount: number;
}

let nis2CacheData: any = null;
let nis2CacheExpiresAt = 0;

export const complianceRoutes: FastifyPluginAsync = async (fastify, opts) => {
  fastify.get("/nis2", async (request, reply) => {
    try {
      if (nis2CacheData && Date.now() < nis2CacheExpiresAt) {
        return { status: "success", data: nis2CacheData };
      }

      const allUsers = await db.select().from(users);
      const allM365 = await db.select().from(m365Licenses);
      const allResources = await db.select().from(resources);
      const allRawAcls = await db.select().from(rawAcl);
      const allMachines = await db.select().from(machines);
      const m365Setting = await db.select().from(systemSettings).where(eq(systemSettings.key, "m365_config")).limit(1);

      const checkpoints: ComplianceCheckpoint[] = [];

      // 1. Checkpoint 1.1: Multi-Factor Authentication (MFA)
      // FIX-02: Suppression du biais isDjaelOrAdmin — uniquement basé sur mfaEnabled réel en DB
      let mfaCount = 0;
      for (const u of allUsers) {
        const lic = allM365.find((m) => m.userId === u.id);
        const hasMfa = lic ? Boolean(lic.mfaEnabled) : false;
        if (hasMfa) mfaCount++;
      }

      const totalUsers = allUsers.length > 0 ? allUsers.length : 1;
      const mfaPercent = Math.round((mfaCount / totalUsers) * 100);

      checkpoints.push({
        id: "nis2-mfa-general",
        pillarId: "pillar-access",
        pillarName: "Authentification & Gestion des Accès",
        nis2Article: "Art. 21.2.j",
        isoControl: "ISO 27001 A.5.15 / A.5.17",
        title: "Double Authentification (MFA) obligatoire sur les accès cloud & annuaire",
        severity: mfaPercent < 70 ? "critical" : mfaPercent < 90 ? "high" : "low",
        status: mfaPercent >= 90 ? "pass" : mfaPercent >= 70 ? "warn" : "fail",
        scoreImpact: mfaPercent < 70 ? 25 : mfaPercent < 90 ? 12 : 0,
        evidence: `${mfaCount} sur ${allUsers.length} utilisateur(s) disposent d'un statut MFA actif (${mfaPercent}% de couverture).`,
        recommendation: "Activer les stratégies d'accès conditionnel et imposer la double authentification (MFA / Authenticator) sur l'ensemble des comptes utilisateur et privilèges M365.",
        targetUrl: "/users"
      });

      // Checkpoint 1.2: Privileged Account MFA
      // FIX-02: Suppression du biais isDjaelOrAdmin — uniquement basé sur mfaEnabled réel en DB
      const adminUsers = allUsers.filter(u => {
        const un = (u.username || "").toLowerCase();
        const dn = (u.displayName || "").toLowerCase();
        return un.includes("admin") || dn.includes("admin") || (u.department && u.department.toLowerCase().includes("it"));
      });
      const unMfaAdmins = adminUsers.filter(u => {
        const lic = allM365.find((m) => m.userId === u.id);
        return !(lic && Boolean(lic.mfaEnabled));
      });

      checkpoints.push({
        id: "nis2-mfa-privileged",
        pillarId: "pillar-access",
        pillarName: "Authentification & Gestion des Accès",
        nis2Article: "Art. 21.2.j",
        isoControl: "ISO 27001 A.8.2",
        title: "Protection renforcée (MFA) sur les comptes à privilèges élevés & Administration",
        severity: unMfaAdmins.length > 0 ? "critical" : "low",
        status: unMfaAdmins.length === 0 ? "pass" : "fail",
        scoreImpact: unMfaAdmins.length > 0 ? 20 : 0,
        evidence: unMfaAdmins.length === 0 
          ? "100% des comptes administrateurs et IT identifiés disposent du MFA actif."
          : `${unMfaAdmins.length} compte(s) d'administration IT ne possède(nt) pas la double authentification active.`,
        recommendation: "Restreindre l'utilisation des comptes d'administration globale et exiger une authentification FIDO2/MFA matérielle.",
        targetUrl: "/users"
      });

      // 2. Checkpoint 2.1: Least Privilege & SMB Share Security
      const highRiskShares = allResources.filter(r => {
        const resourceAcls = allRawAcls.filter(a => a.resourceId === r.id);
        const fullControlEntries = resourceAcls.filter(a => 
          (a.accessLevel || "").toLowerCase().includes("fullcontrol") || (a.accessLevel || "").toLowerCase().includes("contrôle total")
        );
        return fullControlEntries.length >= 2 || r.path.toLowerCase().includes("public") || r.path.toLowerCase().includes("commun");
      });

      checkpoints.push({
        id: "nis2-smb-least-privilege",
        pillarId: "pillar-privileges",
        pillarName: "Moindre Privilège & Sécurité des Partages",
        nis2Article: "Art. 21.2.i",
        isoControl: "ISO 27001 A.5.18 / A.8.3",
        title: "Politique de moindre privilège et audit des accès partagés (SMB / SharePoint)",
        severity: highRiskShares.length > 0 ? "high" : "low",
        status: highRiskShares.length === 0 ? "pass" : highRiskShares.length < 3 ? "warn" : "fail",
        scoreImpact: highRiskShares.length * 8,
        evidence: highRiskShares.length === 0
          ? "Tous les partages réseau sont correctement cloisonnés et restreints par groupe AD."
          : `${highRiskShares.length} partage(s) réseau disposent de permissions étendues (Contrôle Total cumulé ou ouvert).`,
        recommendation: "Supprimer les autorisations attribuées au groupe 'Tout le Monde' ou 'Domain Users' et appliquer le principe du moindre privilège via des groupes de sécurité restreints.",
        targetUrl: "/permissions"
      });

      // 3. Checkpoint 3.1: Disabled / Inactive AD Accounts
      const disabledUsers = allUsers.filter(u => u.adEnabled === false);

      checkpoints.push({
        id: "nis2-ad-disabled-accounts",
        pillarId: "pillar-hygiene",
        pillarName: "Hygiène Annuaire & Comptes Inactifs",
        nis2Article: "Art. 21.2.g",
        isoControl: "ISO 27001 A.5.16",
        title: "Purge et révocation immédiate des comptes utilisateurs désactivés",
        severity: disabledUsers.length > 5 ? "high" : disabledUsers.length > 0 ? "medium" : "low",
        status: disabledUsers.length === 0 ? "pass" : "warn",
        scoreImpact: disabledUsers.length > 0 ? 10 : 0,
        evidence: disabledUsers.length === 0
          ? "Aucun compte désactivé résiduel détecté dans l'annuaire Active Directory."
          : `${disabledUsers.length} compte(s) désactivé(s) sont toujours présents dans l'arborescence Active Directory.`,
        recommendation: "Placer les comptes des collaborateurs partis dans une UO de quarantaine 'Comptes Désactivés' puis planifier leur suppression définitive sous 30 jours.",
        targetUrl: "/users"
      });

      // 4. Checkpoint 4.1: Endpoint Inventory & Agent Check-in
      const now = Date.now();
      // FIX-01: lastSeenAt n'existe pas dans le schéma — utiliser lastCheckinAt
      const activeMachines = allMachines.filter(m => {
        const checkin = m.lastCheckinAt ? new Date(m.lastCheckinAt).getTime() : 0;
        if (checkin === 0) return false; // Machine jamais contactée = non active
        const diffDays = (now - checkin) / (1000 * 3600 * 24);
        return diffDays <= 7;
      });

      const totalMachines = allMachines.length > 0 ? allMachines.length : 1;
      const agentCoveragePercent = Math.round((activeMachines.length / totalMachines) * 100);

      checkpoints.push({
        id: "nis2-endpoint-inventory",
        pillarId: "pillar-assets",
        pillarName: "Inventaire des Actifs & Endpoints",
        nis2Article: "Art. 21.2.e",
        isoControl: "ISO 27001 A.8.1 / A.8.9",
        title: "Inventaire continu et supervision de l'intégrité des postes et serveurs (Agents)",
        severity: agentCoveragePercent < 80 ? "high" : "low",
        status: agentCoveragePercent >= 90 ? "pass" : agentCoveragePercent >= 75 ? "warn" : "fail",
        scoreImpact: agentCoveragePercent < 90 ? 15 : 0,
        evidence: `${activeMachines.length} sur ${allMachines.length} machine(s) sont actives et ont effectué un check-in récent (<7 jours).`,
        recommendation: "Déployer le service agent Synparc via stratégie de groupe GPO sur l'ensemble des postes de travail et serveurs du domaine.",
        targetUrl: "/machines"
      });

      // 5. Checkpoint 5.1: M365 Cloud Graph API Integration
      let m365Configured = false;
      if (m365Setting.length > 0 && m365Setting[0].value) {
        try {
          const parsed = JSON.parse(m365Setting[0].value);
          if (parsed.tenantId && parsed.clientId) m365Configured = true;
        } catch {}
      }

      checkpoints.push({
        id: "nis2-cloud-m365-tenant",
        pillarId: "pillar-cloud",
        pillarName: "Sécurité Cloud & Tenant M365",
        nis2Article: "Art. 21.2.d",
        isoControl: "ISO 27001 A.5.23",
        title: "Supervision continue et audit des API Cloud Microsoft 365 Entra ID",
        severity: !m365Configured ? "medium" : "low",
        status: m365Configured ? "pass" : "warn",
        scoreImpact: !m365Configured ? 10 : 0,
        evidence: m365Configured 
          ? "Le tenant Microsoft 365 est correctement raccordé via l'API Microsoft Graph."
          : "Aucune clé API Microsoft Entra ID n'est actuellement enregistrée dans les paramètres Synparc.",
        recommendation: "Renseigner le Tenant ID, Client ID et Client Secret dans les paramètres Synparc pour automatiser l'analyse de conformité Cloud.",
        targetUrl: "/settings"
      });
      // 6. Checkpoint 6.1: Art. 21.2.a — Politique de Sécurité des SI (PSSI)
      const hasInventory = allUsers.length > 0 && allMachines.length > 0;
      checkpoints.push({
        id: "nis2-pssi-policy",
        pillarId: "pillar-governance",
        pillarName: "Gouvernance & Politiques de Sécurité",
        nis2Article: "Art. 21.2.a",
        isoControl: "ISO 27001 A.5.1 / A.5.2",
        title: "Existence et application d'une Politique de Sécurité des SI (PSSI)",
        severity: hasInventory ? "medium" : "high",
        status: hasInventory ? "warn" : "fail",
        scoreImpact: hasInventory ? 8 : 15,
        evidence: hasInventory
          ? "Inventaire des actifs disponible. La PSSI écrite doit être formellement validée."
          : "Inventaire insuffisant pour certifier l'application d'une PSSI.",
        recommendation: "Formaliser et publier la PSSI de l'organisation signée par la direction.",
        targetUrl: "/settings"
      });

      // 7. Checkpoint 7.1: Art. 21.2.b — Gestion des Incidents
      const recentActivity = allMachines.some(m => {
        const checkin = m.lastCheckinAt ? new Date(m.lastCheckinAt).getTime() : 0;
        return (now - checkin) < 24 * 3600 * 1000;
      });
      checkpoints.push({
        id: "nis2-incident-handling",
        pillarId: "pillar-incident",
        pillarName: "Gestion des Incidents & Réponse",
        nis2Article: "Art. 21.2.b",
        isoControl: "ISO 27001 A.5.24 / A.5.26",
        title: "Procédures de détection, notification et gestion des incidents de sécurité",
        severity: "high",
        status: recentActivity ? "pass" : "warn",
        scoreImpact: recentActivity ? 0 : 10,
        evidence: recentActivity
          ? "Supervision continue active des agents et collecte d'événements en cours."
          : "Aucune remontée d'événement récente (<24h) sur les agents.",
        recommendation: "Établir une procédure de notification d'incident sous 24h conforme aux exigences ANSSI/NIS2.",
        targetUrl: "/machines"
      });

      // 8. Checkpoint 8.1: Art. 21.2.c — Continuité d'activité & Sauvegardes
      checkpoints.push({
        id: "nis2-business-continuity",
        pillarId: "pillar-governance",
        pillarName: "Gouvernance & Politiques de Sécurité",
        nis2Article: "Art. 21.2.c",
        isoControl: "ISO 27001 A.5.29 / A.5.30",
        title: "Plan de Continuité d'Activité (PCA/PRA) et politique de sauvegardes isolées",
        severity: "high",
        status: "warn",
        scoreImpact: 10,
        evidence: "Les sauvegardes et le PRA doivent être testés et validés séparément par l'équipe infrastructure.",
        recommendation: "Tester la restauration des sauvegardes au moins 2 fois par an et documenter le PRA.",
        targetUrl: "/settings"
      });

      // 9. Checkpoint 9.1: Art. 21.2.f — Évaluation d'efficacité des mesures de sécurité
      const scannedShares = allResources.filter(r => r.lastScannedAt !== null);
      const scanRatio = allResources.length > 0 ? scannedShares.length / allResources.length : 1;
      checkpoints.push({
        id: "nis2-security-audit",
        pillarId: "pillar-hygiene",
        pillarName: "Hygiène Annuaire & Comptes Inactifs",
        nis2Article: "Art. 21.2.f",
        isoControl: "ISO 27001 A.5.35 / A.5.36",
        title: "Évaluation et contrôle réguliers de l'efficacité des mesures de cybersécurité",
        severity: scanRatio < 0.8 ? "high" : "low",
        status: scanRatio >= 0.8 ? "pass" : "warn",
        scoreImpact: scanRatio >= 0.8 ? 0 : 8,
        evidence: `${Math.round(scanRatio * 100)}% des ressources configurées sont régulièrement audités et scannés.`,
        recommendation: "Automatiser les scans périodiques de toutes les ressources SMB et bases d'identités.",
        targetUrl: "/permissions"
      });

      // 10. Checkpoint 10.1: Art. 21.2.h — Cryptographie & Chiffrement
      const envEncryptionKey = process.env.ENCRYPTION_KEY;
      const isEncrypted = Boolean(envEncryptionKey && envEncryptionKey.length === 64);
      checkpoints.push({
        id: "nis2-crypto-policy",
        pillarId: "pillar-cloud",
        pillarName: "Sécurité Cloud & Tenant M365",
        nis2Article: "Art. 21.2.h",
        isoControl: "ISO 27001 A.8.24",
        title: "Politiques et mécanismes de cryptographie et de chiffrement des données sensibles",
        severity: isEncrypted ? "low" : "critical",
        status: isEncrypted ? "pass" : "fail",
        scoreImpact: isEncrypted ? 0 : 15,
        evidence: isEncrypted
          ? "Chiffrement AES-256-GCM actif pour les secrets d'intégration et clés sensibles dans la base Synparc."
          : "La clé de chiffrement ENCRYPTION_KEY n'est pas configurée correctement sur le serveur Synparc.",
        recommendation: "Activer la clé de chiffrement ENCRYPTION_KEY (AES-256) dans le fichier .env du serveur Synparc.",
        targetUrl: "/settings"
      });

      // Group Checkpoints into 6 Pillars (weighted average score)
      const pillarDefs = [
        { id: "pillar-access", name: "Authentification & Gestion des Accès", nis2Article: "Art. 21.2.j", isoControl: "ISO 27001 A.5.15 / A.5.17" },
        { id: "pillar-privileges", name: "Moindre Privilège & Sécurité des Partages", nis2Article: "Art. 21.2.i", isoControl: "ISO 27001 A.5.18 / A.8.3" },
        { id: "pillar-hygiene", name: "Hygiène Annuaire & Comptes Inactifs", nis2Article: "Art. 21.2.g/f", isoControl: "ISO 27001 A.5.16 / A.5.35" },
        { id: "pillar-assets", name: "Inventaire des Actifs & Endpoints", nis2Article: "Art. 21.2.e", isoControl: "ISO 27001 A.8.1 / A.8.9" },
        { id: "pillar-cloud", name: "Sécurité Cloud & Tenant M365", nis2Article: "Art. 21.2.d/h", isoControl: "ISO 27001 A.5.23 / A.8.24" },
        { id: "pillar-governance", name: "Gouvernance & Politiques de Sécurité", nis2Article: "Art. 21.2.a/b/c", isoControl: "ISO 27001 A.5.1 / A.5.24" },
      ];

      const pillars: CompliancePillar[] = pillarDefs.map(p => {
        const pillarCheckpoints = checkpoints.filter(c => c.pillarId === p.id);
        const passCount = pillarCheckpoints.filter(c => c.status === "pass").length;
        const warnCount = pillarCheckpoints.filter(c => c.status === "warn").length;
        const failCount = pillarCheckpoints.filter(c => c.status === "fail").length;

        const totalPillarPenalties = pillarCheckpoints.reduce((acc, c) => acc + c.scoreImpact, 0);
        const pillarScore = Math.max(0, Math.min(100, 100 - totalPillarPenalties * 2));
        const pillarStatus = pillarScore >= 85 ? "conforme" : pillarScore >= 60 ? "partiellement_conforme" : "non_conforme";

        return {
          id: p.id,
          name: p.name,
          nis2Article: p.nis2Article,
          isoControl: p.isoControl,
          score: pillarScore,
          status: pillarStatus,
          passCount,
          warnCount,
          failCount
        };
      });

      // Calculate Total NIS2 Compliance Score (0 - 100%) based on pillar average
      const totalPillarsScore = pillars.reduce((acc, p) => acc + p.score, 0);
      const overallScore = Math.round(totalPillarsScore / (pillars.length || 1));

      const nis2Status: "conforme" | "partiellement_conforme" | "non_conforme" = 
        overallScore >= 85 ? "conforme" : overallScore >= 65 ? "partiellement_conforme" : "non_conforme";

      // Remediation Roadmap (Sorted by severity & scoreImpact)
      const remediationRoadmap = checkpoints
        .filter(c => c.status !== "pass")
        .sort((a, b) => b.scoreImpact - a.scoreImpact)
        .map(c => ({
          checkpointId: c.id,
          title: c.title,
          severity: c.severity,
          scoreGain: c.scoreImpact,
          recommendation: c.recommendation,
          targetUrl: c.targetUrl
        }));

      const resultData = {
        overallScore,
        nis2Status,
        entityCategory: "EE", // Entité Essentielle
        evaluatedAt: new Date(),
        stats: {
          totalCheckpoints: checkpoints.length,
          passCheckpoints: checkpoints.filter(c => c.status === "pass").length,
          warnCheckpoints: checkpoints.filter(c => c.status === "warn").length,
          failCheckpoints: checkpoints.filter(c => c.status === "fail").length,
        },
        pillars,
        checkpoints,
        remediationRoadmap
      };

      nis2CacheData = resultData;
      nis2CacheExpiresAt = Date.now() + 5000;

      return {
        status: "success",
        data: resultData
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal Server Error", message: "Compliance evaluation failed" });
    }
  });
};
