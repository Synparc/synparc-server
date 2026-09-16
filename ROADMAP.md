# 🚀 ROADMAP SYNPARC (Prochaines versions)

Ce document centralise l'ensemble des fonctionnalités et chantiers techniques prévus pour les prochaines évolutions de la suite **SYNPARC**.

---

## 1. 🔐 Sécurité & Authentification SSO
- [ ] **Authentification Administrateur Obligatoire** : Seuls les utilisateurs avec des privilèges Administrateur pourront accéder au dashboard web.
- [ ] **Intégration SSO (Single Sign-On)** : Support d'Entra ID (Azure AD), OIDC, ADFS et SAML 2.0.
- [ ] **Rôles & Audit Logs** : RBAC granulaire (Admin, Lecteur, Operateur) et journalisation de toutes les actions d'administration.

## 2. 🔑 Système de Licence Valide & Fonctionnel
- [ ] **Validation Cryptographique** : Vérification des signatures numériques des clés de licence (RSA / ECDSA).
- [ ] **Quotas Dynamiques de Nœuds (`max_nodes`)** : Contrôle strict du nombre de machines/agents autorisés par licence.
- [ ] **Gestion du cycle de vie** : Renouvellement, révocation et jetons d'enrôlement temporaires.

## 3. 📊 Amélioration des Données & Graphiques Temps Réel
- [ ] **Visualisations Graphiques (Recharts / Chart.js)** : Histogrammes et séries temporelles (charge CPU, RAM, I/O disque, bande passante).
- [ ] **Données avancées** : Processus les plus gourmands, état du pare-feu et mises à jour Windows Update manquantes.

## 4. 🏢 Tests en Environnement de Production (au travail)
- [ ] Tests de stabilité et d'intégration sur des infrastructures multi-sites et multi-domaines Active Directory.
- [ ] Benchmarks de performances avec +1 000 agents et connecteurs simultanés.

## 5. 📦 Exécutable `synparc-installer`
- [ ] **GUI / CLI Installateur Pro** : Déploiement en 1-clic avec saisie assistée du jeton d'enrôlement et de l'URL du serveur central.
- [ ] **Déploiement de Masse** : Paquetage MSI et scripts de déploiement automatique via GPO Active Directory / Intune.

## 6. 🌐 Architecture Tier 0 & Relais Réseau (Cross-Network Proxy)
- [ ] **Passerelle Proxy Agent (Tier 0)** : Relais gRPC/HTTPS sécurisé pour la remontée de métriques des machines hors LAN (VLANs isolés, sites distants, télétravail).

## 7. 🛡️ Résilience API Agent (Multi-Fallback 3+ Méthodes)
Pour chaque métrique collectée par `synparc-agent`, mise en place de **3+ méthodes de secours** pour pallier à tout blocage système :
1. **Méthode 1 (Primaire)** : Win32 API native / Syscalls CGO / Rust (`GetSystemInfo`, `GlobalMemoryStatusEx`).
2. **Méthode 2 (Secondaire)** : WMI / CIM (`Get-CimInstance Win32_OperatingSystem`).
3. **Méthode 3 (Tertiaire)** : Registre Windows (`HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion`).
4. **Méthode 4 (Quaternaire)** : PowerShell CLI ou Performance Counters Windows.

## 8. 💡 Innovations & Inventions Futures
- [ ] **Notifications Multi-canaux** : Webhooks vers Microsoft Teams, Slack, Discord et e-mail.
- [ ] **Remédiation à Distance** : Kill de processus malveillants et déconnexion forcée de sessions suspectes depuis l'interface web.
- [ ] **Audit de Conformité Sécurité** : Scans automatiques de conformité selon les recommandations ANSSI / CIS Benchmarks.
