#!/usr/bin/env python3
"""Minimal Linux identity/heartbeat client. Uses outbound HTTPS only."""
import json
import os
import platform
import ssl
import time
import urllib.error
import urllib.request

API_URL = os.environ.get("MANAGEMENT_API_URL", "").rstrip("/")
TOKEN_FILE = os.environ.get("MANAGEMENT_AGENT_TOKEN_FILE", "/etc/management-agent/token")
INTERVAL = 60
VERSION = "1.0.0"


def report():
    if not API_URL.startswith("https://"):
        raise RuntimeError("MANAGEMENT_API_URL must use HTTPS")
    with open(TOKEN_FILE, "r", encoding="utf-8") as token_file:
        token = token_file.read().strip()
    if not token:
        raise RuntimeError("agent token is empty")
    os_name, os_version = platform.system(), platform.release()
    try:
        with open("/etc/os-release", "r", encoding="utf-8") as release_file:
            release = dict(line.strip().split("=", 1) for line in release_file if "=" in line)
        os_name = release.get("PRETTY_NAME", os_name).strip('"')
        os_version = release.get("VERSION_ID", os_version).strip('"')
    except OSError:
        pass
    payload = json.dumps({"hostname": platform.node(), "os": os_name, "osVersion": os_version, "agentVersion": VERSION}).encode()
    request = urllib.request.Request(API_URL + "/api/v1/linux-agents/heartbeat", data=payload, headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=15, context=ssl.create_default_context()) as response:
        if response.status != 200:
            raise RuntimeError("heartbeat rejected with HTTP " + str(response.status))


if __name__ == "__main__":
    while True:
        try:
            report()
        except (OSError, urllib.error.URLError, RuntimeError) as error:
            print("heartbeat failed: " + str(error), flush=True)
        time.sleep(INTERVAL)
