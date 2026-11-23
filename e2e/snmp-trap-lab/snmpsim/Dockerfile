FROM python:3.12-alpine
# snmpsim 1.2.x / pysnmp 7.1.33 fails SNMPv3 privacy against net-snmp clients ("Decryption error"); 1.1.7 + pysnmp 6.2.6 works.
RUN pip install --no-cache-dir snmpsim==1.1.7 pysnmp==6.2.6 pysmi==1.6.3 \
 && adduser -D -H snmpsim
COPY data /usr/local/snmpsim/data
USER snmpsim
EXPOSE 1161/udp
# SNMPv3 authPriv (SHA / AES-128), the same profile the lab asks of a real C9300. Context name = data file (core-sw-01).
CMD ["snmpsim-command-responder", "--data-dir=/usr/local/snmpsim/data", "--agent-udpv4-endpoint=0.0.0.0:1161", \
     "--v3-user=labpoll", "--v3-auth-key=lab-poll-auth-pass", "--v3-auth-proto=SHA", "--v3-priv-key=lab-poll-priv-pass", "--v3-priv-proto=AES"]
