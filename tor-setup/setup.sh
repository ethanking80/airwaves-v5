#!/bin/bash
# AIRWAVES .onion Hidden Service Setup
# Run with: sudo bash setup.sh

set -e

echo "=== AIRWAVES Tor Hidden Service Setup ==="
echo ""

# 1. Install nginx config
echo "[1/4] Setting up Nginx..."
cp /home/jefe/WORK/airwaves/tor-setup/nginx-airwaves-onion.conf /etc/nginx/sites-available/airwaves-onion
ln -sf /etc/nginx/sites-available/airwaves-onion /etc/nginx/sites-enabled/airwaves-onion
# Remove default site to avoid conflicts
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx
echo "   Nginx configured and running on 127.0.0.1:8080"

# 2. Configure Tor hidden service
echo "[2/4] Configuring Tor hidden service..."
# Check if already configured
if grep -q "airwaves-onion" /etc/tor/torrc 2>/dev/null; then
    echo "   Tor hidden service already configured"
else
    cat /home/jefe/WORK/airwaves/tor-setup/torrc-hidden-service.conf >> /etc/tor/torrc
    echo "   Added hidden service config to /etc/tor/torrc"
fi

# 3. Restart Tor
echo "[3/4] Restarting Tor..."
systemctl restart tor@default
sleep 3

# 4. Get .onion address
echo "[4/4] Retrieving .onion address..."
sleep 2
if [ -f /var/lib/tor/airwaves-onion/hostname ]; then
    ONION=$(cat /var/lib/tor/airwaves-onion/hostname)
    echo ""
    echo "=========================================="
    echo "  AIRWAVES is live on Tor!"
    echo ""
    echo "  Your .onion address:"
    echo "  $ONION"
    echo ""
    echo "  Open in Tor Browser to access your site"
    echo "=========================================="
    echo ""
    echo "Tip: Save your private key backup:"
    echo "  /var/lib/tor/airwaves-onion/hs_ed25519_secret_key"
    echo ""
else
    echo "   Waiting for Tor to generate .onion address..."
    sleep 5
    if [ -f /var/lib/tor/airwaves-onion/hostname ]; then
        ONION=$(cat /var/lib/tor/airwaves-onion/hostname)
        echo ""
        echo "  Your .onion address: $ONION"
    else
        echo "   Still generating. Check with:"
        echo "   sudo cat /var/lib/tor/airwaves-onion/hostname"
    fi
fi

echo ""
echo "Useful commands:"
echo "  Check status:    systemctl status tor@default nginx"
echo "  View .onion:     sudo cat /var/lib/tor/airwaves-onion/hostname"
echo "  Tor logs:        sudo journalctl -u tor@default -f"
echo "  Nginx logs:      tail -f /var/log/nginx/airwaves-onion-*.log"
echo "  Stop services:   sudo systemctl stop tor@default nginx"
echo "  Start services:  sudo systemctl start tor@default nginx"
