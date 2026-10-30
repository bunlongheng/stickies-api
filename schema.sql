-- Stickies API schema. Structure only, no data.
-- Load into any Postgres 13+ (local, Supabase, Neon, RDS): psql "$DATABASE_URL" -f schema.sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;



CREATE TABLE public.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text NOT NULL,
    key_hash text NOT NULL,
    key_prefix text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    user_id uuid NOT NULL
);

CREATE TABLE public.automation_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    automation_id uuid,
    automation_name text,
    triggered_at timestamp with time zone DEFAULT now() NOT NULL,
    trigger_payload jsonb,
    result text NOT NULL,
    detail text,
    via text
);

CREATE TABLE public.automations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    trigger_type text NOT NULL,
    trigger_integration_id uuid,
    condition jsonb NOT NULL,
    action_type text NOT NULL,
    action_integration_id uuid,
    action_config jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    trigger_integration_type text,
    action_integration_type text
);

CREATE TABLE public.integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    trigger text NOT NULL,
    condition jsonb,
    config jsonb,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    access_token text,
    refresh_token text,
    token_expires_at timestamp with time zone
);

CREATE TABLE public.stickies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text DEFAULT 'Untitled'::text,
    content text DEFAULT ''::text,
    folder_name text DEFAULT 'General'::text,
    folder_color text DEFAULT '#FF3B30'::text,
    is_folder boolean DEFAULT false,
    "order" integer DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    parent_folder_name text,
    list_mode boolean DEFAULT false NOT NULL,
    folder_id uuid,
    parent_folder_id uuid,
    type text,
    tags text[],
    user_id text DEFAULT '47a18fff-a0c4-4f18-b0f0-40821c18793d'::text,
    is_public boolean DEFAULT false,
    trashed_at timestamp with time zone,
    icon text,
    format character varying(16) DEFAULT 'text'::character varying NOT NULL,
    doc jsonb,
    created_by_key text,
    locked boolean DEFAULT false NOT NULL,
    lock_password_hash text,
    created_by_machine text,
    frozen boolean DEFAULT false NOT NULL,
    CONSTRAINT stickies_no_reserved_view_folder CHECK (((folder_name IS NULL) OR (lower(folder_name) <> ALL (ARRAY['today'::text, 'yesterday'::text]))))
);

CREATE TABLE public.user_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    pinned_folders text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.users (
    id integer NOT NULL,
    name character varying(255),
    email character varying(255),
    "emailVerified" timestamp with time zone,
    image text,
    user_type text DEFAULT 'viewer'::text NOT NULL,
    password_hash text,
    deactivated_at timestamp with time zone
);

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.automation_logs
    ADD CONSTRAINT automation_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.automations
    ADD CONSTRAINT automations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.stickies
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_user_id_key UNIQUE (user_id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

CREATE INDEX automation_logs_automation_triggered_at_idx ON public.automation_logs USING btree (automation_id, triggered_at DESC);

CREATE UNIQUE INDEX automation_logs_gmail_dedupe_idx ON public.automation_logs USING btree (automation_id, ((trigger_payload ->> 'messageId'::text))) WHERE (via = 'gmail-watcher'::text);

CREATE INDEX automations_active_action_integration_updated_idx ON public.automations USING btree (active, action_integration_type, updated_at DESC);

CREATE INDEX automations_active_trigger_integration_idx ON public.automations USING btree (active, trigger_integration_type);

CREATE INDEX automations_trigger_type_active_idx ON public.automations USING btree (trigger_type, active);

CREATE UNIQUE INDEX idx_automation_logs_no_dupe ON public.automation_logs USING btree (automation_id, ((trigger_payload ->> 'messageId'::text))) WHERE ((trigger_payload ->> 'messageId'::text) IS NOT NULL);

CREATE INDEX idx_stickies_user_folder ON public.stickies USING btree (user_id, folder_name);

CREATE INDEX idx_stickies_user_folder_id ON public.stickies USING btree (user_id, folder_id);

CREATE INDEX idx_stickies_user_is_folder ON public.stickies USING btree (user_id, is_folder);

CREATE INDEX idx_stickies_user_updated ON public.stickies USING btree (user_id, updated_at DESC);

CREATE UNIQUE INDEX idx_unique_folder_name_per_level ON public.stickies USING btree (user_id, folder_name, COALESCE(parent_folder_name, '__ROOT__'::text)) WHERE (is_folder = true);

CREATE INDEX integrations_type_idx ON public.integrations USING btree (type);

CREATE INDEX notes_folder_id_idx ON public.stickies USING btree (folder_id) WHERE ((folder_id IS NOT NULL) AND (is_folder = false));

CREATE INDEX notes_folder_name_idx ON public.stickies USING btree (folder_name) WHERE (is_folder = false);

CREATE INDEX notes_is_folder_name_idx ON public.stickies USING btree (is_folder, folder_name);

CREATE INDEX notes_order_idx ON public.stickies USING btree ("order");

CREATE INDEX notes_title_trgm ON public.stickies USING gin (title gin_trgm_ops);

CREATE INDEX notes_updated_at_idx ON public.stickies USING btree (updated_at DESC) WHERE (is_folder = false);

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);

ALTER TABLE ONLY public.automation_logs
    ADD CONSTRAINT automation_logs_automation_id_fkey FOREIGN KEY (automation_id) REFERENCES public.automations(id);

ALTER TABLE ONLY public.automations
    ADD CONSTRAINT automations_action_integration_id_fkey FOREIGN KEY (action_integration_id) REFERENCES public.integrations(id);

ALTER TABLE ONLY public.automations
    ADD CONSTRAINT automations_trigger_integration_id_fkey FOREIGN KEY (trigger_integration_id) REFERENCES public.integrations(id);

ALTER TABLE ONLY public.stickies
    ADD CONSTRAINT notes_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.stickies(id);

ALTER TABLE ONLY public.stickies
    ADD CONSTRAINT notes_parent_folder_id_fkey FOREIGN KEY (parent_folder_id) REFERENCES public.stickies(id);

