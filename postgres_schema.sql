-- BLDE EDC Clinical Research Platform
-- PostgreSQL Database Schema Layout (GxP Production-Grade)
-- Authoritative schema definitions for all clinical tables, security rules, and audit structures.

-- Enable UUID extension if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ORGANIZATIONS
CREATE TABLE organizations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) UNIQUE NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. SITES (DATA ACCESS GROUPS)
CREATE TABLE sites (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL, -- Foreign key reference added after projects table is created
    name VARCHAR(255) NOT NULL,
    code VARCHAR(255) NOT NULL,
    city VARCHAR(255) NULL,
    pi_name VARCHAR(255) NULL,
    pi_email VARCHAR(255) NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. USERS
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(255) DEFAULT 'researcher',
    site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
    totp_secret VARCHAR(255) NULL,
    totp_enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT TRUE,
    password_changed_at TIMESTAMP WITH TIME ZONE NULL,
    password_history JSONB DEFAULT '[]'::jsonb,
    failed_login_attempts INTEGER DEFAULT 0,
    lockout_until TIMESTAMP WITH TIME ZONE NULL,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
    activation_otp VARCHAR(6) NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- 4. PROJECTS
CREATE TABLE projects (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    status VARCHAR(255) DEFAULT 'development', -- development, production, analysis
    longitudinal BOOLEAN DEFAULT FALSE,
    randomisation_enabled BOOLEAN DEFAULT FALSE,
    multi_site BOOLEAN DEFAULT FALSE,
    deleted BOOLEAN DEFAULT FALSE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    dde_enabled BOOLEAN DEFAULT FALSE
);

-- Add foreign key back on sites now that projects is created
ALTER TABLE sites ADD CONSTRAINT fk_sites_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- 5. INSTRUMENTS (CRF FORMS)
CREATE TABLE instruments (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    fields JSONB DEFAULT '[]'::jsonb,
    repeating BOOLEAN DEFAULT FALSE,
    status VARCHAR(255) DEFAULT 'draft', -- draft, published
    published_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. EVENTS (LONGITUDINAL VISIT WINDOWS)
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    day_offset INTEGER DEFAULT 0,
    window_before INTEGER DEFAULT 0,
    window_after INTEGER DEFAULT 0,
    description TEXT NULL,
    sort_order INTEGER DEFAULT 0
);

-- 7. EVENT INSTRUMENTS (CRF MAPPING JOIN TABLE)
CREATE TABLE event_instruments (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    required BOOLEAN DEFAULT TRUE,
    PRIMARY KEY (event_id, instrument_id)
);

-- 8. RECORDS (CLINICAL PARTICIPANT RECORDS DATA)
CREATE TABLE records (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    record_id VARCHAR(255) NOT NULL,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
    repeat_instance INTEGER DEFAULT 1,
    data JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(255) DEFAULT 'incomplete', -- incomplete, complete, unverified
    version_id INTEGER DEFAULT 1,
    locked BOOLEAN DEFAULT FALSE,
    locked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    locked_at TIMESTAMP WITH TIME ZONE NULL,
    lock_signature TEXT NULL,
    entered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. PROJECT USERS (PERMISSIONS ACCESS CONTROL LIST)
CREATE TABLE project_users (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    can_view BOOLEAN DEFAULT TRUE,
    can_edit BOOLEAN DEFAULT FALSE,
    can_delete BOOLEAN DEFAULT FALSE,
    can_export BOOLEAN DEFAULT FALSE,
    can_manage BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (project_id, user_id)
);

-- 10. AUDIT LOG (IMMUTABLE GXP AUDIT TRAIL)
CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    record_id VARCHAR(255) NULL,
    instrument_id INTEGER REFERENCES instruments(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_name VARCHAR(255) NULL,
    action VARCHAR(255) NOT NULL,
    field_name VARCHAR(255) NULL,
    old_value TEXT NULL,
    new_value TEXT NULL,
    ip_address VARCHAR(255) NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    current_hash VARCHAR(64) NULL,
    previous_hash VARCHAR(64) NULL
);

-- Immutable security rules inside PostgreSQL database
CREATE RULE protect_audit_logs AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE lock_audit_logs AS ON DELETE TO audit_log DO INSTEAD NOTHING;

-- 11. SURVEY LINKS (PUBLIC COLLECTION SURVEY ENDPOINTS)
CREATE TABLE survey_links (
    id SERIAL PRIMARY KEY,
    token VARCHAR(255) UNIQUE NOT NULL,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    label VARCHAR(255) NULL,
    active BOOLEAN DEFAULT TRUE,
    responses INTEGER DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    client_license_id VARCHAR(255) NULL,
    client_local_survey_id INTEGER NULL
);

-- 12. PATIENT VISIT EVENTS (LONGITUDINAL TRACKING CALENDAR)
CREATE TABLE patient_events (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    record_id VARCHAR(255) NOT NULL,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    scheduled_date DATE NULL,
    actual_date DATE NULL,
    status VARCHAR(255) DEFAULT 'scheduled', -- scheduled, completed, missed, skipped
    notes TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 13. FILE ATTACHMENTS (GxP COMPLIANT STORAGE META)
CREATE TABLE attachments (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    record_id VARCHAR(255) NOT NULL,
    instrument_id INTEGER REFERENCES instruments(id) ON DELETE CASCADE,
    field_id VARCHAR(255) NULL,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mimetype VARCHAR(255) NULL,
    size INTEGER NOT NULL,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 14. DOUBLE DATA ENTRY (DDE CONFLICT RESOLUTION WORKFLOWS)
CREATE TABLE dde_records (
    id SERIAL PRIMARY KEY,
    primary_record_id INTEGER NULL REFERENCES records(id) ON DELETE SET NULL,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    record_id VARCHAR(255) NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(255) DEFAULT 'pending', -- pending, conflict, resolved
    entered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    discrepancies JSONB DEFAULT '[]'::jsonb,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 15. ALERT RULES (AUTOMATED ALERTS ENGINE)
CREATE TABLE alert_rules (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    instrument_id INTEGER REFERENCES instruments(id) ON DELETE CASCADE,
    trigger_field VARCHAR(255) NULL,
    trigger_operator VARCHAR(255) DEFAULT '=',
    trigger_value VARCHAR(255) NULL,
    alert_type VARCHAR(255) DEFAULT 'email', -- email, sms, webhook
    recipients JSONB DEFAULT '[]'::jsonb,
    subject VARCHAR(255) NULL,
    message TEXT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 16. SYSTEM LICENSING MANIFEST
CREATE TABLE licenses (
    id SERIAL PRIMARY KEY,
    license_key VARCHAR(255) UNIQUE NOT NULL,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
    license_type VARCHAR(255) DEFAULT 'trial',
    status VARCHAR(255) DEFAULT 'active',
    activation_date TIMESTAMP WITH TIME ZONE NULL,
    expiry_date TIMESTAMP WITH TIME ZONE NULL,
    last_checkin TIMESTAMP WITH TIME ZONE NULL,
    machine_id VARCHAR(255) NULL,
    machine_name VARCHAR(255) NULL,
    machine_hash VARCHAR(255) NULL,
    license_version INTEGER DEFAULT 1,
    parent_license_id INTEGER NULL,
    license_id_str VARCHAR(255) NULL,
    signature TEXT NULL,
    verification_enabled BOOLEAN DEFAULT TRUE,
    last_server_check TIMESTAMP WITH TIME ZONE NULL,
    next_server_check TIMESTAMP WITH TIME ZONE NULL,
    offline_grace_days INTEGER DEFAULT 30,
    verification_fail_count INTEGER DEFAULT 0,
    last_server_response TEXT NULL,
    verification_server_url VARCHAR(255) NULL,
    backup_verification_server_url VARCHAR(255) NULL,
    remote_status VARCHAR(255) DEFAULT 'active',
    remote_status_reason TEXT NULL,
    emergency_override BOOLEAN DEFAULT FALSE,
    override_until TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 17. LICENSE LIMITATIONS TELEMETRY
CREATE TABLE license_usage (
    id SERIAL PRIMARY KEY,
    license_id INTEGER REFERENCES licenses(id) ON DELETE CASCADE,
    projects_limit INTEGER DEFAULT 5,
    users_limit INTEGER DEFAULT 10,
    forms_limit INTEGER DEFAULT 20,
    records_limit INTEGER DEFAULT 1000,
    storage_gb_limit INTEGER DEFAULT 5,
    upload_size_mb_limit INTEGER DEFAULT 20,
    sessions_limit INTEGER DEFAULT 5,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 18. LICENSE FEATURES ALLOWANCE
CREATE TABLE license_features (
    id SERIAL PRIMARY KEY,
    license_id INTEGER REFERENCES licenses(id) ON DELETE CASCADE,
    feature_name VARCHAR(255) NOT NULL,
    enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 19. LICENSE SYSTEM EVENT LOGS
CREATE TABLE license_logs (
    id SERIAL PRIMARY KEY,
    license_id INTEGER REFERENCES licenses(id) ON DELETE SET NULL,
    action VARCHAR(255) NOT NULL,
    details TEXT NULL,
    operator_name VARCHAR(255) NULL,
    ip_address VARCHAR(255) NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    error_code VARCHAR(255) NULL,
    failure_reason TEXT NULL,
    raw_payload TEXT NULL
);

-- 20. MACHINE BINDING ASSIGNMENT
CREATE TABLE machine_binding (
    id SERIAL PRIMARY KEY,
    license_id INTEGER REFERENCES licenses(id) ON DELETE CASCADE,
    machine_hash VARCHAR(255) UNIQUE NOT NULL,
    machine_name VARCHAR(255) NULL,
    binding_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(255) DEFAULT 'bound',
    fingerprint_version VARCHAR(255) DEFAULT 'v1'
);

-- 21. ONLINE LICENSE VERIFICATION CACHE
CREATE TABLE online_verification (
    id SERIAL PRIMARY KEY,
    license_id INTEGER REFERENCES licenses(id) ON DELETE CASCADE,
    verification_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    verification_status VARCHAR(255) NOT NULL,
    server_response_code INTEGER NULL,
    server_signature TEXT NULL,
    next_scheduled_check TIMESTAMP WITH TIME ZONE NULL,
    offline_grace_remaining INTEGER DEFAULT 30
);

-- 22. DATA QUALITY RULES AND ACTIONS
CREATE TABLE dq_rules (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    logic TEXT NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 23. DATA QUERIES (DISCREPANCY WORKFLOWS)
CREATE TABLE data_queries (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    record_id VARCHAR(255) NOT NULL,
    instrument_id INTEGER REFERENCES instruments(id) ON DELETE CASCADE,
    field_name VARCHAR(255) NOT NULL,
    query_text TEXT NOT NULL,
    status VARCHAR(255) DEFAULT 'open', -- open, resolved, closed
    raised_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP WITH TIME ZONE NULL,
    resolution_text TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexing for high-performance clinical query execution
CREATE INDEX idx_records_lookup ON records (project_id, record_id, instrument_id);
CREATE INDEX idx_audit_lookup ON audit_log (project_id, record_id);
CREATE INDEX idx_queries_lookup ON data_queries (project_id, record_id, field_name);
