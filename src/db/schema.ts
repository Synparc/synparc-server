import { 
  pgTable, 
  uuid, 
  text, 
  boolean, 
  timestamp, 
  primaryKey,
  check,
  uniqueIndex,
  integer,
  numeric,
  bigint
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// --- 1. IDENTITÉS AD ---

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  adGuid: uuid("ad_guid").unique().notNull(),
  username: text("username").notNull(),
  displayName: text("display_name"),
  email: text("email"),
  department: text("department"),
  title: text("title"),
  adEnabled: boolean("ad_enabled").notNull().default(true),
  lastLogonAd: timestamp("last_logon_ad", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  adGuid: uuid("ad_guid").unique().notNull(),
  name: text("name").notNull(),
  groupType: text("group_type"), // 'security' | 'distribution'
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userGroupMemberships = pgTable("user_group_memberships", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.groupId] }),
}));

export const groupGroupMemberships = pgTable("group_group_memberships", {
  childGroupId: uuid("child_group_id").notNull().references(() => groups.id, { onDelete: 'cascade' }),
  parentGroupId: uuid("parent_group_id").notNull().references(() => groups.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.childGroupId, t.parentGroupId] }),
}));


// --- 2. MACHINES & MÉTRIQUES ---

export const machines = pgTable("machines", {
  id: uuid("id").primaryKey().defaultRandom(),
  adGuid: uuid("ad_guid").unique(),
  hostname: text("hostname").notNull(),
  fqdn: text("fqdn"),
  machineType: text("machine_type"), // 'workstation' | 'server'
  osName: text("os_name"),
  osVersion: text("os_version"),
  lastIp: text("last_ip"),
  lastIpSeenAt: timestamp("last_ip_seen_at", { withTimezone: true }),
  lastCheckinAt: timestamp("last_checkin_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const machineSessions = pgTable("machine_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  machineId: uuid("machine_id").notNull().references(() => machines.id, { onDelete: 'cascade' }),
  userId: uuid("user_id").references(() => users.id),
  sessionStart: timestamp("session_start", { withTimezone: true }).notNull(),
  sessionEnd: timestamp("session_end", { withTimezone: true }),
  sessionType: text("session_type"),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
});

// Hypertable TimescaleDB
export const machineMetrics = pgTable("machine_metrics", {
  time: timestamp("time", { withTimezone: true }).notNull(),
  machineId: uuid("machine_id").notNull().references(() => machines.id, { onDelete: 'cascade' }),
  cpuPercent: numeric("cpu_percent"),
  ramPercent: numeric("ram_percent"),
  uptimeSeconds: bigint("uptime_seconds", { mode: 'number' }),
});


// --- 3. RESSOURCES & PERMISSIONS ---

export const resources = pgTable("resources", {
  id: uuid("id").primaryKey().defaultRandom(),
  resourceType: text("resource_type").notNull(), // 'smb_share' | 'sharepoint_site'
  path: text("path").notNull().unique(),
  hostingMachineId: uuid("hosting_machine_id").references(() => machines.id),
  lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rawAcl = pgTable("raw_acl", {
  id: uuid("id").primaryKey().defaultRandom(),
  resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: 'cascade' }),
  userId: uuid("user_id").references(() => users.id),
  groupId: uuid("group_id").references(() => groups.id),
  accessLevel: text("access_level").notNull(),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Constraint: exactly one of userId or groupId must be null
  userOrGroupCheck: check("user_or_group_check", sql`(${t.userId} IS NULL) != (${t.groupId} IS NULL)`),
}));

export const effectivePermissions = pgTable("effective_permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: 'cascade' }),
  accessLevel: text("access_level").notNull(),
  originType: text("origin_type").notNull(), // 'direct' | 'inherited_group'
  originGroupId: uuid("origin_group_id").references(() => groups.id),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniquePermission: uniqueIndex("idx_eff_perm_unique").on(t.userId, t.resourceId, t.accessLevel, t.originType),
}));
