export const up = async function (knex) {
  // Inject immutable audit triggers inside PostgreSQL database
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
    RETURNS TRIGGER AS $$
    DECLARE
      disable_triggers text;
    BEGIN
      -- Get custom session variable, defaulting to 'false' if not set
      BEGIN
        disable_triggers := current_setting('blde.disable_audit_triggers', true);
      EXCEPTION WHEN OTHERS THEN
        disable_triggers := 'false';
      END;

      IF disable_triggers = 'true' THEN
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        ELSE
          RETURN NEW;
        END IF;
      END IF;

      RAISE EXCEPTION 'Audit log is immutable and cannot be updated or deleted.';
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER protect_audit_logs_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_modification();
  `);

  await knex.raw(`
    CREATE TRIGGER protect_audit_logs_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_modification();
  `);
};

export const down = async function (knex) {
  await knex.raw('DROP TRIGGER IF EXISTS protect_audit_logs_update ON audit_log;');
  await knex.raw('DROP TRIGGER IF EXISTS protect_audit_logs_delete ON audit_log;');
  await knex.raw('DROP FUNCTION IF EXISTS prevent_audit_log_modification();');
};
