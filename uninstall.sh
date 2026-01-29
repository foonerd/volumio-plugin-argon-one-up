#!/bin/bash

echo "Uninstalling Argon ONE UP plugin"

# Remove sudoers entry
rm -f /etc/sudoers.d/volumio-user-argon_one_up 2>/dev/null

# Note: We do not disable I2C as other plugins may depend on it
# Note: We do not remove i2c-tools as other plugins may depend on it

echo "Argon ONE UP plugin uninstalled"
echo "pluginuninstallend"
