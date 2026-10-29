#!/bin/sh
set -eu
# Fail closed: Chromium never starts if either network filter cannot be installed.
# Only this dedicated container's network namespace is changed.
iptables -N FORME_BROWSER
iptables -A OUTPUT -m owner --uid-owner 1000 -j FORME_BROWSER
iptables -A FORME_BROWSER -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# Docker's embedded resolver is the only permitted local DNS destination.
iptables -A FORME_BROWSER -d 127.0.0.11 -p udp --dport 53 -j ACCEPT
iptables -A FORME_BROWSER -d 127.0.0.11 -p tcp --dport 53 -j ACCEPT
for network in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.88.99.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do
  iptables -A FORME_BROWSER -d "$network" -j REJECT
done
iptables -A FORME_BROWSER -p tcp -m multiport --dports 80,443 -j ACCEPT
iptables -A FORME_BROWSER -j REJECT
# Browser reads use IPv4. Block all new IPv6 connections, including mapped/private.
ip6tables -N FORME_BROWSER
ip6tables -A OUTPUT -m owner --uid-owner 1000 -j FORME_BROWSER
ip6tables -A FORME_BROWSER -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip6tables -A FORME_BROWSER -j DROP
export TRYON_READER_ISOLATED=1
exec setpriv --reuid=1000 --regid=1000 --init-groups --bounding-set=-all --no-new-privs node /app/server/browser-worker.js
