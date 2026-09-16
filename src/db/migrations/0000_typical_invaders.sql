CREATE TABLE "effective_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"access_level" text NOT NULL,
	"origin_type" text NOT NULL,
	"origin_group_id" uuid,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_group_memberships" (
	"child_group_id" uuid NOT NULL,
	"parent_group_id" uuid NOT NULL,
	CONSTRAINT "group_group_memberships_child_group_id_parent_group_id_pk" PRIMARY KEY("child_group_id","parent_group_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_guid" uuid NOT NULL,
	"name" text NOT NULL,
	"group_type" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_ad_guid_unique" UNIQUE("ad_guid")
);
--> statement-breakpoint
CREATE TABLE "machine_metrics" (
	"time" timestamp with time zone NOT NULL,
	"machine_id" uuid NOT NULL,
	"cpu_percent" numeric,
	"ram_percent" numeric,
	"uptime_seconds" bigint
);
--> statement-breakpoint
CREATE TABLE "machine_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_id" uuid NOT NULL,
	"user_id" uuid,
	"session_start" timestamp with time zone NOT NULL,
	"session_end" timestamp with time zone,
	"session_type" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_guid" uuid,
	"hostname" text NOT NULL,
	"fqdn" text,
	"machine_type" text,
	"os_name" text,
	"os_version" text,
	"last_ip" text,
	"last_ip_seen_at" timestamp with time zone,
	"last_checkin_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machines_ad_guid_unique" UNIQUE("ad_guid")
);
--> statement-breakpoint
CREATE TABLE "raw_acl" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"user_id" uuid,
	"group_id" uuid,
	"access_level" text NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_or_group_check" CHECK (("raw_acl"."user_id" IS NULL) != ("raw_acl"."group_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" text NOT NULL,
	"path" text NOT NULL,
	"hosting_machine_id" uuid,
	"last_scanned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resources_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "user_group_memberships" (
	"user_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	CONSTRAINT "user_group_memberships_user_id_group_id_pk" PRIMARY KEY("user_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_guid" uuid NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"email" text,
	"department" text,
	"title" text,
	"ad_enabled" boolean DEFAULT true NOT NULL,
	"last_logon_ad" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_ad_guid_unique" UNIQUE("ad_guid")
);
--> statement-breakpoint
ALTER TABLE "effective_permissions" ADD CONSTRAINT "effective_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "effective_permissions" ADD CONSTRAINT "effective_permissions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "effective_permissions" ADD CONSTRAINT "effective_permissions_origin_group_id_groups_id_fk" FOREIGN KEY ("origin_group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_group_memberships" ADD CONSTRAINT "group_group_memberships_child_group_id_groups_id_fk" FOREIGN KEY ("child_group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_group_memberships" ADD CONSTRAINT "group_group_memberships_parent_group_id_groups_id_fk" FOREIGN KEY ("parent_group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_metrics" ADD CONSTRAINT "machine_metrics_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_sessions" ADD CONSTRAINT "machine_sessions_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_sessions" ADD CONSTRAINT "machine_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_acl" ADD CONSTRAINT "raw_acl_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_acl" ADD CONSTRAINT "raw_acl_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_acl" ADD CONSTRAINT "raw_acl_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_hosting_machine_id_machines_id_fk" FOREIGN KEY ("hosting_machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_memberships" ADD CONSTRAINT "user_group_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_memberships" ADD CONSTRAINT "user_group_memberships_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_eff_perm_unique" ON "effective_permissions" USING btree ("user_id","resource_id","access_level","origin_type");