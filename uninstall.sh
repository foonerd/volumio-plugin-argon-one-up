#!/bin/bash

echo "Uninstalling Argon ONE UP plugin"

# Remove sudoers entry
rm -f /etc/sudoers.d/volumio-user-argon_one_up 2>/dev/null

# Remove Argon ONE UP boot options from userconfig.txt
USERCONFIG="/boot/userconfig.txt"
if [ -f "$USERCONFIG" ] && [ -w "$USERCONFIG" ]; then
    grep -v "^dtparam=uart0=on$" "$USERCONFIG" 2>/dev/null | \
    grep -v "^dtoverlay=dwc2,dr_mode=host$" | \
    grep -v "^dtparam=pciex1_gen=3$" | \
    grep -v "^usb_max_current_enable=1$" | \
    grep -v "^dtparam=ant2$" > "${USERCONFIG}.tmp" && mv "${USERCONFIG}.tmp" "$USERCONFIG"
fi

# Note: We do not disable I2C as other plugins may depend on it
# Note: We do not remove i2c-tools as other plugins may depend on it

echo "Argon ONE UP plugin uninstalled"
echo "pluginuninstallend"
