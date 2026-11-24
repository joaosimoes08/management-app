# Simulated Cisco Catalyst C9300 2-member stack for Phase 2 SNMP polling tests (lab-only).
# Pinned to the same versions as e2e/snmp-trap-lab/snmpsim (snmpsim 1.1.7, pysnmp 6.2.6).
# Reason: snmpsim 1.2.x with pysnmp 7.1.33 rejects SNMPv3 privacy from net-snmp clients ("Decryption error").
FROM python:3.12-alpine
RUN pip install --no-cache-dir snmpsim==1.1.7 pysnmp==6.2.6 pysmi==1.6.3 \
 && adduser -D -H snmpsim
COPY data /usr/local/snmpsim/variants
COPY entrypoint.sh /usr/local/bin/sim-entrypoint
RUN chmod 0755 /usr/local/bin/sim-entrypoint && chmod -R a+rX /usr/local/snmpsim/variants
USER snmpsim
EXPOSE 1161/udp
ENTRYPOINT ["/usr/local/bin/sim-entrypoint"]
