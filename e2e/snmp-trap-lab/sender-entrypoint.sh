#!/bin/sh
# Extra source addresses on the sender: .21-.24 (second switch, v2c switch, unregistered sources) and .100-.189 (flood).
set -e
for host in 21 22 23 24 $(seq 100 189); do ip addr add "10.250.62.$host/24" dev eth0 2>/dev/null || true; done
exec sleep infinity
