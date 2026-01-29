# Argon ONE UP Plugin for Volumio

UPS battery monitoring, fan control, and power management for Argon ONE UP case on Volumio 4.

## Features

- **Battery Monitoring** - Real-time battery level and charging status display
- **Automatic Fan Control** - Temperature-based fan speed with configurable thresholds
- **Manual Fan Control** - Fixed fan speed option for quiet operation
- **Lid Detection** - Optional shutdown when lid is closed
- **Power Button** - Configurable actions for double-press and long-press
- **Battery Alerts** - Warning notifications and automatic shutdown on critical battery
- **EEPROM Configuration** - PSU_MAX_CURRENT status check for Raspberry Pi 5
- **Multi-language Support** - 11 languages included

## Supported Hardware

- Argon ONE UP Case (with UPS battery)
- Argon ONE Case (fan control only, no battery features)
- Raspberry Pi 4 Model B
- Raspberry Pi 5

## Requirements

- Volumio 4.x (Bookworm-based)
- I2C enabled on Raspberry Pi
- i2c-tools package (installed automatically)

## Installation

### Method 1: Volumio Plugin Store

1. Open Volumio web interface
2. Navigate to Plugins
3. Search for "Argon ONE UP"
4. Click Install

### Method 2: Manual Installation

```
git clone --depth=1 https://github.com/foonerd/volumio-plugin-argon-one-up
cd volumio-plugin-argon-one-up
volumio plugin install
```

Enable the plugin in Volumio settings.

## Configuration

### Device Status

Displays current hardware status:
- Device detection status
- Battery level (percentage)
- Charging status (Charging / On Battery)
- CPU temperature
- Fan speed
- Lid status (Open / Closed)

### Fan Control

**Automatic Mode** (recommended)
- Fan speed adjusts based on CPU temperature
- Three configurable thresholds:
  - Low: Temperature and speed when fan first activates
  - Medium: Intermediate temperature and speed
  - High: Maximum temperature and speed
- Default curve: 55C/25%, 60C/50%, 65C/100%

**Manual Mode**
- Fixed fan speed (0-100%)
- Useful for silent operation or specific cooling needs

### Lid Behavior

Configure action when case lid is closed:
- **Do Nothing** - Lid state is monitored but no action taken
- **Shutdown** - System shuts down after configurable delay (1-120 minutes)

### Power Button

**Double Press Action**
- Nothing / Reboot / Shutdown
- Default: Reboot

**Long Press Action** (3+ seconds)
- Nothing / Reboot / Shutdown
- Default: Shutdown

### Battery Alerts

**Warning Level**
- Battery percentage to show warning notification
- Default: 20%
- Range: 5-50%

**Critical Level**
- Battery percentage to trigger critical action
- Default: 5%
- Range: 1-20%

**Critical Action**
- Warning Only - Show notification only
- Safe Shutdown - Initiate system shutdown

### EEPROM Configuration (Raspberry Pi 5 only)

The Argon ONE UP requires PSU_MAX_CURRENT=5000 in EEPROM for proper UPS operation.
The plugin checks current EEPROM settings and provides guidance for configuration.

### Advanced Settings

Enable advanced options to access:
- **Debug Logging** - Verbose logging for troubleshooting
- **I2C Bus** - Bus number (default: 1)
- **Battery I2C Address** - Default: 0x64
- **Fan I2C Address** - Default: 0x1a
- **Reset to Defaults** - Restore all settings to factory values

## Hardware Details

### I2C Addresses

| Device | Address | Description |
|--------|---------|-------------|
| Battery Gauge | 0x64 | MAX17040 compatible fuel gauge |
| Fan Controller | 0x1a | Argon fan/power controller |

### GPIO Pins

| Pin | Function | Description |
|-----|----------|-------------|
| GPIO 4 | Power Button | Directly managed by Argon controller |
| GPIO 27 | Lid Sensor | Pull-up enabled, LOW when closed |

### Battery Registers

| Register | Address | Description |
|----------|---------|-------------|
| SOC High | 0x04 | State of charge (percentage) |
| SOC Low | 0x05 | State of charge (fraction) |
| Current High | 0x0E | Charging current (MSB indicates direction) |
| Control | 0x08 | Battery gauge control |

## Troubleshooting

### Device Not Detected

1. Check I2C is enabled:
   ```
   ls /dev/i2c-*
   ```
2. Scan I2C bus:
   ```
   sudo i2cdetect -y 1
   ```
3. Verify Argon case is properly connected to GPIO header

### Fan Not Working

1. Check fan controller detected:
   ```
   sudo i2cdetect -y 1 0x1a 0x1a
   ```
2. Test manual fan control:
   ```
   sudo i2cset -y 1 0x1a 50
   ```
3. Set fan to manual mode with 100% speed to test hardware

### Battery Not Detected

1. Check battery gauge detected:
   ```
   sudo i2cdetect -y 1 0x64 0x64
   ```
2. Verify battery is installed in UP case
3. Check battery connections inside case

### Permission Errors

The install script creates sudoers configuration for i2c commands.
If errors persist:
```
sudo visudo -f /etc/sudoers.d/volumio-user-argon_one_up
```
Verify contents:
```
volumio ALL=(ALL) NOPASSWD: /usr/sbin/i2cset
volumio ALL=(ALL) NOPASSWD: /usr/sbin/i2cget
volumio ALL=(ALL) NOPASSWD: /usr/sbin/i2cdetect
```

### Debug Logging

Enable debug logging in Advanced Settings to see detailed operation logs:
```
journalctl -f -u volumio
```

## Translations

The plugin includes translations for:
- English (en)
- German (de)
- Spanish (es)
- French (fr)
- Italian (it)
- Japanese (ja)
- Dutch (nl)
- Polish (pl)
- Portuguese (pt)
- Russian (ru)
- Chinese Simplified (zh_CN)

## Version History

### 1.0.0
- Initial release
- Battery monitoring with charging detection
- Automatic and manual fan control
- Lid close detection with shutdown option
- Power button action configuration
- Battery warning and critical level alerts
- EEPROM PSU_MAX_CURRENT status check
- Multi-language support (11 languages)

## License

GPL-3.0

## Credits

- Argon40 for hardware design and reference scripts
- Volumio team for the plugin framework
- Community contributors for translations

## Support

- Volumio Community Forums: https://community.volumio.com
- Argon40 Forum: https://forum.argon40.com
- GitHub Issues: Report bugs and feature requests

## Related Links

- Argon ONE UP Product Page: https://argon40.com
- Volumio Documentation: https://docs.volumio.com
- Raspberry Pi I2C Documentation: https://www.raspberrypi.com/documentation/computers/raspberry-pi.html
