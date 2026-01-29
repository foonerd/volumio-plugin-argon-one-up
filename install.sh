#!/bin/bash

echo "Installing Argon ONE UP plugin"

# Get architecture
ARCH=$(cat /etc/os-release | grep ^VOLUMIO_ARCH | tr -d 'VOLUMIO_ARCH="')
echo "Architecture: ${ARCH}"

# Install required packages
echo "Installing dependencies..."
apt-get update
apt-get install -y i2c-tools

# Enable I2C if not already enabled
if ! grep -q "^dtparam=i2c_arm=on" /boot/config.txt 2>/dev/null; then
    if ! grep -q "^dtparam=i2c_arm=on" /boot/userconfig.txt 2>/dev/null; then
        echo "Enabling I2C in userconfig.txt..."
        echo "dtparam=i2c_arm=on" >> /boot/userconfig.txt
    fi
fi

# Load I2C kernel module
if ! lsmod | grep -q i2c_dev; then
    modprobe i2c-dev
fi

# Ensure i2c-dev loads on boot
if ! grep -q "^i2c-dev" /etc/modules; then
    echo "i2c-dev" >> /etc/modules
fi

# Create sudoers entry for volumio user
# Note: File must be named volumio-user-* to come AFTER volumio-user alphabetically
SUDOERS_FILE="/etc/sudoers.d/volumio-user-argon_one_up"
echo "Creating sudoers entry for argon_one_up..."
cat > "${SUDOERS_FILE}" << 'EOF'
# Argon ONE UP plugin - allow volumio user to control hardware
volumio ALL=(ALL) NOPASSWD: /usr/sbin/i2cset
volumio ALL=(ALL) NOPASSWD: /usr/sbin/i2cget
volumio ALL=(ALL) NOPASSWD: /usr/sbin/i2cdetect
volumio ALL=(ALL) NOPASSWD: /sbin/shutdown
volumio ALL=(ALL) NOPASSWD: /sbin/reboot
volumio ALL=(ALL) NOPASSWD: /usr/bin/rpi-eeprom-config
EOF

chmod 0440 "${SUDOERS_FILE}"

# Validate sudoers syntax
visudo -c -f "${SUDOERS_FILE}"
if [ $? -ne 0 ]; then
    echo "ERROR: Invalid sudoers syntax"
    rm -f "${SUDOERS_FILE}"
    exit 1
fi
echo "Sudoers configuration complete."

# Check if I2C devices are accessible
echo "Checking I2C bus..."
if [ -e /dev/i2c-1 ]; then
    echo "I2C bus 1 available"
else
    echo "WARNING: I2C bus not available. Reboot may be required."
fi

echo "Argon ONE UP plugin installed successfully"
echo "plugininstallend"
