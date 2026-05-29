#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# setup-sas-cert.sh
# Generates a self-signed TLS certificate for the SAS HTTPS endpoint.
#
# Usage:
#   cd /DOCKER/open5gs-nms
#   bash nginx/setup-sas-cert.sh
#
# The cert is placed in nginx/certs/ and mounted into the nginx container.
# After running this script, restart nginx:
#   docker compose restart nginx
#
# To upload the cert to a Sercomm radio:
#   Download sas.crt from http://<your-server>:8888/api/sas/cert/download
#   Upload it to the radio's trusted CA store.
# ──────────────────────────────────────────────────────────────────────────────

set -e

CERT_DIR="$(dirname "$0")/certs"
CERT_FILE="$CERT_DIR/sas.crt"
KEY_FILE="$CERT_DIR/sas.key"

# Detect server IP for the cert Subject Alternative Name
SERVER_IP=$(ip route get 1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i=="src") print $(i+1)}' | head -1)
if [ -z "$SERVER_IP" ]; then
    SERVER_IP="172.16.0.168"
fi

HOSTNAME=$(hostname -f 2>/dev/null || hostname)

echo "──────────────────────────────────────────────"
echo " SAS TLS Certificate Generator"
echo "──────────────────────────────────────────────"
echo " Output dir : $CERT_DIR"
echo " Server IP  : $SERVER_IP"
echo " Hostname   : $HOSTNAME"
echo " Valid for  : 10 years"
echo "──────────────────────────────────────────────"

mkdir -p "$CERT_DIR"

# Generate private key + self-signed cert with SAN for both IP and hostname
openssl req -x509 \
    -newkey rsa:4096 \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -days 3650 \
    -nodes \
    -subj "/C=US/ST=CBRS/L=Private/O=Open5GS NMS/CN=sas.local" \
    -addext "subjectAltName=IP:$SERVER_IP,DNS:$HOSTNAME,DNS:sas.local,DNS:localhost"

echo ""
echo "✓ Certificate generated:"
echo "  $CERT_FILE"
echo "  $KEY_FILE"
echo ""
echo "Certificate details:"
openssl x509 -in "$CERT_FILE" -noout -subject -issuer -dates -fingerprint -sha256
echo ""
echo "Next steps:"
echo "  1. Restart nginx:  docker compose restart nginx"
echo "  2. HTTPS SAS URL:  https://$SERVER_IP:8443/sas/v1.2"
echo "  3. Download cert for radios:"
echo "     http://$SERVER_IP:8888/api/sas/cert/download"
echo "  4. Upload sas.crt to the Sercomm radio's trusted CA store"
echo ""
