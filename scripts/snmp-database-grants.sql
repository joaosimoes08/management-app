-- Executar como administrador da base depois das migrações.
-- Criar o utilizador LOGIN e a respetiva password fora deste ficheiro e depois:
-- GRANT simoes_snmp_runtime TO <utilizador_snmp>;
-- GRANT simoes_snmp_host_agent TO <utilizador_agente_host>;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simoes_snmp_runtime') THEN
    CREATE ROLE simoes_snmp_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simoes_snmp_host_agent') THEN
    CREATE ROLE simoes_snmp_host_agent NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO simoes_snmp_runtime', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO simoes_snmp_runtime;

GRANT SELECT ON TABLE
  "Device",
  "DeviceInterface"
TO simoes_snmp_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "SnmpDeviceConfig",
  "SnmpCredential",
  "SnmpTrapEnrollment",
  "SnmpJob",
  "SnmpSnapshot",
  "SnmpInterfaceObservation",
  "SnmpTrapEvent",
  "SnmpDrift",
  "SnmpWriteRequest",
  "SnmpListenerInterface"
TO simoes_snmp_runtime;

GRANT SELECT ON TABLE "SnmpListenerConfig" TO simoes_snmp_runtime;

GRANT INSERT ON TABLE "AuditLog" TO simoes_snmp_runtime;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO simoes_snmp_host_agent', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO simoes_snmp_host_agent;
GRANT SELECT ON TABLE "SnmpListenerConfig" TO simoes_snmp_host_agent;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "SnmpListenerInterface" TO simoes_snmp_host_agent;
