'use strict';

/**
 * Argon ONE UP Plugin for Volumio 4
 * 
 * Provides UPS battery monitoring, fan control, power button handling,
 * and lid close detection for Argon ONE UP case.
 * 
 * Hardware interfaces:
 * - Battery gauge: I2C 0x64
 * - Fan controller: I2C 0x1a
 * - Power button: GPIO 4
 * - Lid sensor: GPIO 27
 */

var libQ = require('kew');
var fs = require('fs-extra');
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;

module.exports = ArgonOneUp;

function ArgonOneUp(context) {
    var self = this;

    self.context = context;
    self.commandRouter = self.context.coreCommand;
    self.logger = self.context.logger;
    self.configManager = self.context.configManager;

    // I2C configuration
    self.i2cBus = 1;
    self.batteryAddress = 0x64;
    self.fanAddress = 0x1a;

    // Device state
    self.deviceFound = false;
    self.batteryFound = false;
    self.fanFound = false;

    // Battery state
    self.batteryLevel = 0;
    self.batteryCharging = false;
    self.lastBatteryWarning = 0;

    // Fan state
    self.currentFanSpeed = 0;
    self.cpuTemperature = 0;

    // Lid state
    self.lidClosed = false;
    self.lidShutdownTimer = null;

    // Monitoring intervals
    self.batteryMonitorInterval = null;
    self.fanControlInterval = null;
    self.gpioMonitorInterval = null;

    // Timing constants
    self.BATTERY_CHECK_MS = 10000;   // 10 seconds
    self.FAN_CHECK_MS = 5000;        // 5 seconds
    self.GPIO_CHECK_MS = 500;        // 500ms

    // Debug logging
    self.debugLogging = false;
}

// ---------------------------------------------------------------------------
// Volumio Lifecycle
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.onVolumioStart = function() {
    var self = this;
    var configFile = self.commandRouter.pluginManager.getConfigurationFile(
        self.context, 'config.json'
    );

    self.config = new (require('v-conf'))();
    self.config.loadFile(configFile);

    return libQ.resolve();
};

ArgonOneUp.prototype.onStart = function() {
    var self = this;
    var defer = libQ.defer();

    self.logger.info('ArgonOneUp: Starting plugin');

    self.loadI18nStrings();
    self.loadConfig();

    self.checkDevices()
        .then(function() {
            if (self.deviceFound) {
                self.initializeHardware();
                self.startMonitoring();
                self.logger.info('ArgonOneUp: Plugin started successfully');
            } else {
                self.logger.warn('ArgonOneUp: No Argon ONE UP hardware detected');
            }
            defer.resolve();
        })
        .fail(function(err) {
            self.logger.error('ArgonOneUp: Startup failed: ' + err);
            defer.resolve();
        });

    return defer.promise;
};

ArgonOneUp.prototype.onStop = function() {
    var self = this;
    var defer = libQ.defer();

    self.logger.info('ArgonOneUp: Stopping plugin');

    self.stopMonitoring();

    // Turn off fan gracefully
    if (self.fanFound) {
        self.setFanSpeed(0);
    }

    defer.resolve();
    return defer.promise;
};

ArgonOneUp.prototype.onVolumioShutdown = function() {
    var self = this;

    self.logger.info('ArgonOneUp: System shutdown');
    self.stopMonitoring();

    // Signal power off to Argon controller
    if (self.fanFound) {
        self.signalPowerOff();
    }

    return libQ.resolve();
};

ArgonOneUp.prototype.onVolumioReboot = function() {
    var self = this;

    self.logger.info('ArgonOneUp: System reboot');
    self.stopMonitoring();

    return libQ.resolve();
};

// ---------------------------------------------------------------------------
// Configuration Loading
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.loadConfig = function() {
    var self = this;

    self.i2cBus = self.config.get('i2c_bus', 1);
    self.batteryAddress = parseInt(self.config.get('battery_address', '0x64'), 16);
    self.fanAddress = parseInt(self.config.get('fan_address', '0x1a'), 16);
    self.debugLogging = self.config.get('debug_logging', false);
};

ArgonOneUp.prototype.logDebug = function(msg) {
    var self = this;
    if (self.debugLogging) {
        self.logger.info(msg);
    }
};

// ---------------------------------------------------------------------------
// I2C Operations
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.i2cDetect = function(address) {
    var self = this;
    var defer = libQ.defer();

    var cmd = 'sudo i2cdetect -y ' + self.i2cBus + ' 0x' + 
              address.toString(16) + ' 0x' + address.toString(16);

    exec(cmd, function(error, stdout, stderr) {
        if (error) {
            defer.resolve(false);
        } else {
            // Check if address appears in output (not --)
            var found = stdout.indexOf(address.toString(16)) !== -1 &&
                       stdout.indexOf('--') === -1;
            defer.resolve(found);
        }
    });

    return defer.promise;
};

ArgonOneUp.prototype.i2cRead = function(address, register) {
    var self = this;
    var defer = libQ.defer();

    var cmd = 'sudo i2cget -y ' + self.i2cBus + ' 0x' +
              address.toString(16) + ' 0x' + register.toString(16);

    exec(cmd, function(error, stdout, stderr) {
        if (error) {
            self.logDebug('ArgonOneUp: I2C read error: ' + error.message);
            defer.reject(error);
        } else {
            var value = parseInt(stdout.trim(), 16);
            defer.resolve(value);
        }
    });

    return defer.promise;
};

ArgonOneUp.prototype.i2cWrite = function(address, register, value) {
    var self = this;
    var defer = libQ.defer();

    var cmd = 'sudo i2cset -y ' + self.i2cBus + ' 0x' +
              address.toString(16) + ' 0x' + register.toString(16) +
              ' 0x' + value.toString(16);

    exec(cmd, function(error, stdout, stderr) {
        if (error) {
            self.logDebug('ArgonOneUp: I2C write error: ' + error.message);
            defer.reject(error);
        } else {
            defer.resolve();
        }
    });

    return defer.promise;
};

ArgonOneUp.prototype.i2cWriteByte = function(address, value) {
    var self = this;
    var defer = libQ.defer();

    var cmd = 'sudo i2cset -y ' + self.i2cBus + ' 0x' +
              address.toString(16) + ' 0x' + value.toString(16);

    exec(cmd, function(error, stdout, stderr) {
        if (error) {
            self.logDebug('ArgonOneUp: I2C write byte error: ' + error.message);
            defer.reject(error);
        } else {
            defer.resolve();
        }
    });

    return defer.promise;
};

// ---------------------------------------------------------------------------
// Device Detection and Initialization
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.checkDevices = function() {
    var self = this;
    var defer = libQ.defer();

    // Check for fan controller first (always present on Argon ONE)
    self.i2cDetect(self.fanAddress)
        .then(function(found) {
            self.fanFound = found;
            self.logDebug('ArgonOneUp: Fan controller ' + 
                         (found ? 'found' : 'not found') + 
                         ' at 0x' + self.fanAddress.toString(16));
            
            // Check for battery gauge (only on UP version)
            return self.i2cDetect(self.batteryAddress);
        })
        .then(function(found) {
            self.batteryFound = found;
            self.logDebug('ArgonOneUp: Battery gauge ' + 
                         (found ? 'found' : 'not found') + 
                         ' at 0x' + self.batteryAddress.toString(16));
            
            // Device is found if at least fan controller is present
            self.deviceFound = self.fanFound;
            defer.resolve();
        })
        .fail(function(err) {
            self.logger.error('ArgonOneUp: Device detection failed: ' + err);
            defer.resolve();
        });

    return defer.promise;
};

ArgonOneUp.prototype.initializeHardware = function() {
    var self = this;

    // Initialize fan to off
    if (self.fanFound) {
        self.setFanSpeed(0);
    }

    // Initialize battery profile if battery is present
    if (self.batteryFound) {
        self.initBattery();
    }
};

// ---------------------------------------------------------------------------
// Battery Management
// ---------------------------------------------------------------------------

// Battery register addresses (based on Argon scripts)
ArgonOneUp.prototype.BATTERY_REG = {
    CONTROL: 0x08,
    SOC_HIGH: 0x04,
    SOC_LOW: 0x05,
    CURRENT_HIGH: 0x0E,
    SOCALERT: 0x0B,
    ICSTATE: 0xA7
};

ArgonOneUp.prototype.initBattery = function() {
    var self = this;

    // Check battery status and activate if needed
    self.i2cRead(self.batteryAddress, self.BATTERY_REG.CONTROL)
        .then(function(value) {
            if (value !== 0) {
                self.logDebug('ArgonOneUp: Battery needs activation');
                return self.activateBattery();
            }
            return libQ.resolve();
        })
        .fail(function(err) {
            self.logger.warn('ArgonOneUp: Battery init warning: ' + err.message);
        });
};

ArgonOneUp.prototype.activateBattery = function() {
    var self = this;
    var defer = libQ.defer();

    // Restart sequence from Argon scripts
    self.i2cWrite(self.batteryAddress, self.BATTERY_REG.CONTROL, 0x30)
        .then(function() {
            return libQ.delay(500);
        })
        .then(function() {
            return self.i2cWrite(self.batteryAddress, self.BATTERY_REG.CONTROL, 0x00);
        })
        .then(function() {
            self.logger.info('ArgonOneUp: Battery activated');
            defer.resolve();
        })
        .fail(function(err) {
            self.logger.error('ArgonOneUp: Battery activation failed: ' + err);
            defer.reject(err);
        });

    return defer.promise;
};

ArgonOneUp.prototype.getBatteryLevel = function() {
    var self = this;
    var defer = libQ.defer();

    if (!self.batteryFound) {
        defer.resolve(-1);
        return defer.promise;
    }

    self.i2cRead(self.batteryAddress, self.BATTERY_REG.SOC_HIGH)
        .then(function(value) {
            var level = Math.min(100, Math.max(0, value));
            defer.resolve(level);
        })
        .fail(function(err) {
            defer.resolve(-1);
        });

    return defer.promise;
};

ArgonOneUp.prototype.isBatteryCharging = function() {
    var self = this;
    var defer = libQ.defer();

    if (!self.batteryFound) {
        defer.resolve(false);
        return defer.promise;
    }

    self.i2cRead(self.batteryAddress, self.BATTERY_REG.CURRENT_HIGH)
        .then(function(value) {
            // Positive current (MSB = 0) means charging
            var charging = (value & 0x80) === 0;
            defer.resolve(charging);
        })
        .fail(function(err) {
            defer.resolve(false);
        });

    return defer.promise;
};

// ---------------------------------------------------------------------------
// Fan Control
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.setFanSpeed = function(speed) {
    var self = this;

    if (!self.fanFound) {
        return libQ.resolve();
    }

    speed = Math.min(100, Math.max(0, speed));
    self.currentFanSpeed = speed;

    return self.i2cWriteByte(self.fanAddress, speed);
};

ArgonOneUp.prototype.signalPowerOff = function() {
    var self = this;

    if (!self.fanFound) {
        return libQ.resolve();
    }

    // Send 0xFF to signal power off to Argon controller
    return self.i2cWriteByte(self.fanAddress, 0xFF);
};

ArgonOneUp.prototype.getCpuTemperature = function() {
    var self = this;
    var defer = libQ.defer();

    fs.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8', function(err, data) {
        if (err) {
            defer.resolve(0);
        } else {
            var temp = parseInt(data.trim(), 10) / 1000;
            defer.resolve(temp);
        }
    });

    return defer.promise;
};

ArgonOneUp.prototype.calculateFanSpeed = function(temperature) {
    var self = this;

    var fanMode = self.config.get('fan_mode', 'auto');
    
    if (fanMode === 'manual') {
        return self.config.get('fan_manual_speed', 50);
    }

    // Auto mode - use temperature thresholds
    var tempLow = self.config.get('fan_temp_low', 45);
    var speedLow = self.config.get('fan_speed_low', 25);
    var tempMed = self.config.get('fan_temp_med', 55);
    var speedMed = self.config.get('fan_speed_med', 50);
    var tempHigh = self.config.get('fan_temp_high', 65);
    var speedHigh = self.config.get('fan_speed_high', 100);

    if (temperature < tempLow) {
        return 0;
    } else if (temperature < tempMed) {
        return speedLow;
    } else if (temperature < tempHigh) {
        return speedMed;
    } else {
        return speedHigh;
    }
};

// ---------------------------------------------------------------------------
// GPIO Monitoring (Lid and Power Button)
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.readGpio = function(pin) {
    var self = this;
    var defer = libQ.defer();

    var path = '/sys/class/gpio/gpio' + pin + '/value';
    
    fs.readFile(path, 'utf8', function(err, data) {
        if (err) {
            // GPIO not exported, try to export it
            self.exportGpio(pin)
                .then(function() {
                    return fs.readFile(path, 'utf8');
                })
                .then(function(data) {
                    defer.resolve(parseInt(data.trim(), 10));
                })
                .fail(function() {
                    defer.resolve(-1);
                });
        } else {
            defer.resolve(parseInt(data.trim(), 10));
        }
    });

    return defer.promise;
};

ArgonOneUp.prototype.exportGpio = function(pin) {
    var self = this;
    var defer = libQ.defer();

    var exportPath = '/sys/class/gpio/export';
    var directionPath = '/sys/class/gpio/gpio' + pin + '/direction';

    fs.writeFile(exportPath, pin.toString(), function(err) {
        if (err && err.code !== 'EBUSY') {
            defer.reject(err);
            return;
        }

        // Set as input with pull-up
        setTimeout(function() {
            fs.writeFile(directionPath, 'in', function(err) {
                if (err) {
                    defer.reject(err);
                } else {
                    defer.resolve();
                }
            });
        }, 100);
    });

    return defer.promise;
};

ArgonOneUp.prototype.checkLidStatus = function() {
    var self = this;
    var GPIO_LID = 27;

    self.readGpio(GPIO_LID)
        .then(function(value) {
            if (value === -1) return;

            var lidNowClosed = (value === 0);  // 0 = closed (pulled low)

            if (lidNowClosed && !self.lidClosed) {
                // Lid just closed
                self.lidClosed = true;
                self.onLidClosed();
            } else if (!lidNowClosed && self.lidClosed) {
                // Lid just opened
                self.lidClosed = false;
                self.onLidOpened();
            }
        });
};

ArgonOneUp.prototype.onLidClosed = function() {
    var self = this;
    var lidAction = self.config.get('lid_action', 'nothing');

    self.logDebug('ArgonOneUp: Lid closed, action: ' + lidAction);

    if (lidAction === 'shutdown') {
        var delayMinutes = self.config.get('lid_shutdown_delay', 5);
        var delayMs = delayMinutes * 60 * 1000;

        self.commandRouter.pushToastMessage('warning',
            self.getI18nString('PLUGIN_NAME'),
            self.getI18nString('NOTIFY_LID_CLOSED') + ' ' + delayMinutes + ' ' + 
            self.getI18nString('MINUTES'));

        self.lidShutdownTimer = setTimeout(function() {
            if (self.lidClosed) {
                self.logger.info('ArgonOneUp: Lid shutdown triggered');
                exec('sudo shutdown -h now');
            }
        }, delayMs);
    }
};

ArgonOneUp.prototype.onLidOpened = function() {
    var self = this;

    self.logDebug('ArgonOneUp: Lid opened');

    if (self.lidShutdownTimer) {
        clearTimeout(self.lidShutdownTimer);
        self.lidShutdownTimer = null;

        self.commandRouter.pushToastMessage('info',
            self.getI18nString('PLUGIN_NAME'),
            self.getI18nString('NOTIFY_LID_OPENED'));
    }
};

// ---------------------------------------------------------------------------
// Monitoring Loop
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.startMonitoring = function() {
    var self = this;

    // Battery monitoring
    if (self.batteryFound) {
        self.batteryMonitorInterval = setInterval(function() {
            self.monitorBattery();
        }, self.BATTERY_CHECK_MS);
        
        // Initial check
        self.monitorBattery();
    }

    // Fan control
    if (self.fanFound) {
        self.fanControlInterval = setInterval(function() {
            self.updateFanSpeed();
        }, self.FAN_CHECK_MS);
        
        // Initial update
        self.updateFanSpeed();
    }

    // GPIO monitoring (lid)
    self.gpioMonitorInterval = setInterval(function() {
        self.checkLidStatus();
    }, self.GPIO_CHECK_MS);
};

ArgonOneUp.prototype.stopMonitoring = function() {
    var self = this;

    if (self.batteryMonitorInterval) {
        clearInterval(self.batteryMonitorInterval);
        self.batteryMonitorInterval = null;
    }

    if (self.fanControlInterval) {
        clearInterval(self.fanControlInterval);
        self.fanControlInterval = null;
    }

    if (self.gpioMonitorInterval) {
        clearInterval(self.gpioMonitorInterval);
        self.gpioMonitorInterval = null;
    }

    if (self.lidShutdownTimer) {
        clearTimeout(self.lidShutdownTimer);
        self.lidShutdownTimer = null;
    }
};

ArgonOneUp.prototype.monitorBattery = function() {
    var self = this;

    libQ.all([
        self.getBatteryLevel(),
        self.isBatteryCharging()
    ])
    .then(function(results) {
        var level = results[0];
        var charging = results[1];

        if (level === -1) return;

        var wasCharging = self.batteryCharging;
        self.batteryLevel = level;
        self.batteryCharging = charging;

        // Power state change notifications
        if (charging && !wasCharging) {
            self.commandRouter.pushToastMessage('info',
                self.getI18nString('PLUGIN_NAME'),
                self.getI18nString('NOTIFY_POWER_CONNECTED'));
        } else if (!charging && wasCharging) {
            self.commandRouter.pushToastMessage('warning',
                self.getI18nString('PLUGIN_NAME'),
                self.getI18nString('NOTIFY_POWER_DISCONNECTED'));
        }

        // Low battery warnings (only when on battery)
        if (!charging) {
            var warnLevel = self.config.get('battery_warn_level', 20);
            var criticalLevel = self.config.get('battery_critical_level', 5);
            var criticalAction = self.config.get('battery_critical_action', 'shutdown');
            var now = Date.now();

            if (level <= criticalLevel) {
                self.commandRouter.pushToastMessage('error',
                    self.getI18nString('PLUGIN_NAME'),
                    self.getI18nString('NOTIFY_BATTERY_CRITICAL'));

                if (criticalAction === 'shutdown') {
                    self.logger.info('ArgonOneUp: Critical battery shutdown');
                    exec('sudo shutdown -h +1 "Battery critical"');
                }
            } else if (level <= warnLevel && (now - self.lastBatteryWarning) > 60000) {
                self.commandRouter.pushToastMessage('warning',
                    self.getI18nString('PLUGIN_NAME'),
                    self.getI18nString('NOTIFY_BATTERY_LOW') + ': ' + level + '%');
                self.lastBatteryWarning = now;
            }
        }
    });
};

ArgonOneUp.prototype.updateFanSpeed = function() {
    var self = this;

    self.getCpuTemperature()
        .then(function(temp) {
            self.cpuTemperature = temp;
            var targetSpeed = self.calculateFanSpeed(temp);

            if (targetSpeed !== self.currentFanSpeed) {
                self.logDebug('ArgonOneUp: CPU temp ' + temp.toFixed(1) + 
                             'C, fan ' + self.currentFanSpeed + '% -> ' + targetSpeed + '%');
                self.setFanSpeed(targetSpeed);
            }
        });
};

// ---------------------------------------------------------------------------
// UI Configuration
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.getUIConfig = function() {
    var self = this;
    var defer = libQ.defer();
    var langCode = self.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(
        __dirname + '/i18n/strings_' + langCode + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    )
    .then(function(uiconf) {
        // Section 0: Device Status
        if (self.deviceFound) {
            uiconf.sections[0].content[0].value = self.getI18nString('DEVICE_DETECTED');
        } else {
            uiconf.sections[0].content[0].value = self.getI18nString('DEVICE_NOT_DETECTED');
        }

        // Battery level
        if (self.batteryFound) {
            uiconf.sections[0].content[1].value = self.batteryLevel + '%';
            uiconf.sections[0].content[2].value = self.batteryCharging ? 
                self.getI18nString('BATTERY_CHARGING') : 
                self.getI18nString('BATTERY_DISCHARGING');
        } else {
            uiconf.sections[0].content[1].value = 'N/A';
            uiconf.sections[0].content[2].value = 'N/A';
        }

        // CPU temperature
        uiconf.sections[0].content[3].value = self.cpuTemperature.toFixed(1) + ' C';

        // Fan speed
        if (self.fanFound) {
            uiconf.sections[0].content[4].value = self.currentFanSpeed === 0 ?
                self.getI18nString('FAN_OFF') : self.currentFanSpeed + '%';
        } else {
            uiconf.sections[0].content[4].value = 'N/A';
        }

        // Lid status
        uiconf.sections[0].content[5].value = self.lidClosed ?
            self.getI18nString('LID_CLOSED') : self.getI18nString('LID_OPEN');

        // Section 1: Fan Settings
        var fanMode = self.config.get('fan_mode', 'auto');
        uiconf.sections[1].content[0].value = {
            value: fanMode,
            label: fanMode === 'auto' ? 
                self.getI18nString('FAN_MODE_AUTO') : 
                self.getI18nString('FAN_MODE_MANUAL')
        };
        uiconf.sections[1].content[1].value = self.config.get('fan_manual_speed', 50);
        uiconf.sections[1].content[2].value = self.config.get('fan_temp_low', 45);
        uiconf.sections[1].content[3].value = self.config.get('fan_speed_low', 25);
        uiconf.sections[1].content[4].value = self.config.get('fan_temp_med', 55);
        uiconf.sections[1].content[5].value = self.config.get('fan_speed_med', 50);
        uiconf.sections[1].content[6].value = self.config.get('fan_temp_high', 65);
        uiconf.sections[1].content[7].value = self.config.get('fan_speed_high', 100);

        // Section 2: Lid Settings
        var lidAction = self.config.get('lid_action', 'nothing');
        uiconf.sections[2].content[0].value = {
            value: lidAction,
            label: lidAction === 'nothing' ?
                self.getI18nString('LID_ACTION_NOTHING') :
                self.getI18nString('LID_ACTION_SHUTDOWN')
        };
        uiconf.sections[2].content[1].value = self.config.get('lid_shutdown_delay', 5);

        // Section 3: Power Settings
        var powerDouble = self.config.get('power_double_action', 'reboot');
        var powerLong = self.config.get('power_long_action', 'shutdown');
        uiconf.sections[3].content[0].value = {
            value: powerDouble,
            label: self.getPowerActionLabel(powerDouble)
        };
        uiconf.sections[3].content[1].value = {
            value: powerLong,
            label: self.getPowerActionLabel(powerLong)
        };

        // Section 4: Battery Settings
        uiconf.sections[4].content[0].value = self.config.get('battery_warn_level', 20);
        uiconf.sections[4].content[1].value = self.config.get('battery_critical_level', 5);
        var criticalAction = self.config.get('battery_critical_action', 'shutdown');
        uiconf.sections[4].content[2].value = {
            value: criticalAction,
            label: criticalAction === 'warn' ?
                self.getI18nString('BATTERY_ACTION_WARN') :
                self.getI18nString('BATTERY_ACTION_SHUTDOWN')
        };

        // Section 5: EEPROM Settings
        self.checkEepromStatus()
            .then(function(status) {
                uiconf.sections[5].content[0].value = status;
            });

        // Section 6: Advanced Settings
        uiconf.sections[6].content[0].value = false;
        uiconf.sections[6].content[1].value = self.config.get('debug_logging', false);
        uiconf.sections[6].content[2].value = self.config.get('i2c_bus', 1);
        uiconf.sections[6].content[3].value = '0x' + self.batteryAddress.toString(16);
        uiconf.sections[6].content[4].value = '0x' + self.fanAddress.toString(16);

        defer.resolve(uiconf);
    })
    .fail(function(err) {
        self.logger.error('ArgonOneUp: getUIConfig failed: ' + err);
        defer.reject(err);
    });

    return defer.promise;
};

ArgonOneUp.prototype.getPowerActionLabel = function(action) {
    var self = this;
    
    switch (action) {
        case 'nothing': return self.getI18nString('POWER_ACTION_NOTHING');
        case 'reboot': return self.getI18nString('POWER_ACTION_REBOOT');
        case 'shutdown': return self.getI18nString('POWER_ACTION_SHUTDOWN');
        default: return action;
    }
};

// ---------------------------------------------------------------------------
// Settings Save Methods
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.saveFanSettings = function(data) {
    var self = this;

    self.config.set('fan_mode', data.fan_mode.value);
    self.config.set('fan_manual_speed', parseInt(data.fan_manual_speed, 10));
    self.config.set('fan_temp_low', parseInt(data.fan_temp_low, 10));
    self.config.set('fan_speed_low', parseInt(data.fan_speed_low, 10));
    self.config.set('fan_temp_med', parseInt(data.fan_temp_med, 10));
    self.config.set('fan_speed_med', parseInt(data.fan_speed_med, 10));
    self.config.set('fan_temp_high', parseInt(data.fan_temp_high, 10));
    self.config.set('fan_speed_high', parseInt(data.fan_speed_high, 10));

    // Apply immediately
    self.updateFanSpeed();

    self.commandRouter.pushToastMessage('success',
        self.getI18nString('PLUGIN_NAME'),
        self.getI18nString('SETTINGS_SAVED'));

    return libQ.resolve();
};

ArgonOneUp.prototype.saveLidSettings = function(data) {
    var self = this;

    self.config.set('lid_action', data.lid_action.value);
    self.config.set('lid_shutdown_delay', parseInt(data.lid_shutdown_delay, 10));

    self.commandRouter.pushToastMessage('success',
        self.getI18nString('PLUGIN_NAME'),
        self.getI18nString('SETTINGS_SAVED'));

    return libQ.resolve();
};

ArgonOneUp.prototype.savePowerSettings = function(data) {
    var self = this;

    self.config.set('power_double_action', data.power_double_action.value);
    self.config.set('power_long_action', data.power_long_action.value);

    self.commandRouter.pushToastMessage('success',
        self.getI18nString('PLUGIN_NAME'),
        self.getI18nString('SETTINGS_SAVED'));

    return libQ.resolve();
};

ArgonOneUp.prototype.saveBatterySettings = function(data) {
    var self = this;

    self.config.set('battery_warn_level', parseInt(data.battery_warn_level, 10));
    self.config.set('battery_critical_level', parseInt(data.battery_critical_level, 10));
    self.config.set('battery_critical_action', data.battery_critical_action.value);

    self.commandRouter.pushToastMessage('success',
        self.getI18nString('PLUGIN_NAME'),
        self.getI18nString('SETTINGS_SAVED'));

    return libQ.resolve();
};

ArgonOneUp.prototype.saveAdvancedSettings = function(data) {
    var self = this;

    self.config.set('debug_logging', data.debug_logging || false);
    self.debugLogging = data.debug_logging || false;

    if (data.show_advanced) {
        self.config.set('i2c_bus', parseInt(data.i2c_bus, 10));
        self.config.set('battery_address', data.battery_address);
        self.config.set('fan_address', data.fan_address);
    }

    self.commandRouter.pushToastMessage('success',
        self.getI18nString('PLUGIN_NAME'),
        self.getI18nString('SETTINGS_SAVED'));

    return libQ.resolve();
};

ArgonOneUp.prototype.refreshStatus = function() {
    var self = this;

    // Force immediate update
    if (self.batteryFound) {
        self.monitorBattery();
    }
    if (self.fanFound) {
        self.updateFanSpeed();
    }
    self.checkLidStatus();

    self.commandRouter.pushToastMessage('info',
        self.getI18nString('PLUGIN_NAME'),
        self.getI18nString('STATUS_REFRESHED'));

    return libQ.resolve();
};

ArgonOneUp.prototype.resetDefaults = function() {
    var self = this;

    // Reset all config values to defaults
    self.config.set('fan_mode', 'auto');
    self.config.set('fan_manual_speed', 50);
    self.config.set('fan_temp_low', 45);
    self.config.set('fan_speed_low', 25);
    self.config.set('fan_temp_med', 55);
    self.config.set('fan_speed_med', 50);
    self.config.set('fan_temp_high', 65);
    self.config.set('fan_speed_high', 100);
    self.config.set('lid_action', 'nothing');
    self.config.set('lid_shutdown_delay', 5);
    self.config.set('power_double_action', 'reboot');
    self.config.set('power_long_action', 'shutdown');
    self.config.set('battery_warn_level', 20);
    self.config.set('battery_critical_level', 5);
    self.config.set('battery_critical_action', 'shutdown');
    self.config.set('debug_logging', false);
    self.config.set('i2c_bus', 1);
    self.config.set('battery_address', '0x64');
    self.config.set('fan_address', '0x1a');

    self.loadConfig();

    self.commandRouter.pushToastMessage('success',
        self.getI18nString('PLUGIN_NAME'),
        self.getI18nString('DEFAULTS_RESTORED'));

    return libQ.resolve();
};

// ---------------------------------------------------------------------------
// EEPROM Configuration (Pi 5)
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.checkEepromStatus = function() {
    var self = this;
    var defer = libQ.defer();

    // Check if rpi-eeprom-config exists
    fs.access('/usr/bin/rpi-eeprom-config', fs.constants.X_OK, function(err) {
        if (err) {
            defer.resolve(self.getI18nString('EEPROM_NOT_SUPPORTED'));
            return;
        }

        exec('sudo rpi-eeprom-config', function(error, stdout, stderr) {
            if (error) {
                defer.resolve(self.getI18nString('EEPROM_NOT_SUPPORTED'));
                return;
            }

            if (stdout.indexOf('PSU_MAX_CURRENT=5000') !== -1) {
                defer.resolve(self.getI18nString('PSU_CURRENT_OK'));
            } else {
                defer.resolve(self.getI18nString('PSU_CURRENT_LOW'));
            }
        });
    });

    return defer.promise;
};

ArgonOneUp.prototype.applyEepromSettings = function() {
    var self = this;
    var defer = libQ.defer();

    // Check if we're on Pi 5
    fs.readFile('/sys/firmware/devicetree/base/compatible', 'utf8', function(err, data) {
        if (err || data.indexOf('bcm2712') === -1) {
            self.commandRouter.pushToastMessage('warning',
                self.getI18nString('PLUGIN_NAME'),
                self.getI18nString('EEPROM_NOT_SUPPORTED'));
            defer.resolve();
            return;
        }

        // Apply EEPROM settings using a simple approach
        var cmd = 'sudo rpi-eeprom-config --edit';
        
        // For now, just notify that manual configuration is needed
        // Full EEPROM modification requires the script from argon-rpi-eeprom-config-psu.py
        self.commandRouter.pushToastMessage('info',
            self.getI18nString('PLUGIN_NAME'),
            'Run "sudo rpi-eeprom-config --edit" and set PSU_MAX_CURRENT=5000');

        defer.resolve();
    });

    return defer.promise;
};

// ---------------------------------------------------------------------------
// I18n
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.loadI18nStrings = function() {
    var self = this;
    var langCode = self.commandRouter.sharedVars.get('language_code');

    try {
        self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_' + langCode + '.json');
    } catch (e) {
        self.i18nStrings = {};
    }

    try {
        self.i18nStringsDefaults = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
    } catch (e) {
        self.i18nStringsDefaults = {};
    }
};

ArgonOneUp.prototype.getI18nString = function(key) {
    var self = this;

    if (self.i18nStrings && self.i18nStrings[key] !== undefined) {
        return self.i18nStrings[key];
    }
    if (self.i18nStringsDefaults && self.i18nStringsDefaults[key] !== undefined) {
        return self.i18nStringsDefaults[key];
    }
    return key;
};

// ---------------------------------------------------------------------------
// Required Stubs
// ---------------------------------------------------------------------------

ArgonOneUp.prototype.getConfigurationFiles = function() {
    return ['config.json'];
};

ArgonOneUp.prototype.onRestart = function() {};
ArgonOneUp.prototype.onInstall = function() {};
ArgonOneUp.prototype.onUninstall = function() {};
ArgonOneUp.prototype.getConf = function(varName) { return this.config.get(varName); };
ArgonOneUp.prototype.setConf = function(varName, varValue) { this.config.set(varName, varValue); };
ArgonOneUp.prototype.getAdditionalConf = function() {};
ArgonOneUp.prototype.setAdditionalConf = function() {};
ArgonOneUp.prototype.setUIConfig = function() {};
