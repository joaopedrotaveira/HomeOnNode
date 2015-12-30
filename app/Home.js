'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var exec = require('child_process').exec;
var log = require('./SystemLog');
var Keys = require('./Keys').keys;
var version = require('./version');
var moment = require('moment');
var fs = require('fs');

var Firebase = require('firebase');
var Harmony = require('./Harmony');
var Hue = require('./Hue');
var Presence = require('./Presence');
var Nest = require('./Nest');
var ZWave = require('./ZWave');

function Home(config, fb) {
  this.state = {};
  var _self = this;

  var nest;
  var hue;
  var harmony;
  var zwave;
  var presence;

  var armingTimer;
  var zwaveTimer;

  /*****************************************************************************
   *
   * Primary commands
   *
   ****************************************************************************/

  function getCommandByName(commandName) {
    var result = config.commands[commandName];
    if (result) {
      return result;
    } else {
      log.error('[HOME] Unable to find command: ' + commandName);
      return {};
    }
  }

  function getLightSceneByName(sceneName) {
    var defaultScene = {bri: 254, ct: 369, on: true};
    sceneName = sceneName.toString();
    if (sceneName) {
      try {
        sceneName = sceneName.toUpperCase();
        var result = config.lightScenes[sceneName];
        if (result.hue) {
          return result.hue;
        }
      } catch (ex) {
        log.error('[HOME] Error retreiving light scene: ' + sceneName);
        return defaultScene;
      }
    }
    log.warn('[HOME] Could not determine light scene: ' + sceneName);
    return defaultScene;
  }

  this.handleKeyEntry = function(key, modifier, sender) {
    try {
      var cmdName = config.keypad.keys[key];
      if (cmdName) {
        _self.executeCommandByName(cmdName, modifier, sender);
      } else {
        log.warn('[HOME] Unknown key pressed: ' + key);
      }
    } catch (ex) {
      log.exception('[HOME] Error handling key entry.', ex);
    }
  };

  this.executeCommandByName = function(commandName, modifier, source) {
    var result = {};
    var msg = '[HOME] Command received: ' + commandName + ' [' + modifier + ']';
    msg += ' from ' + source;
    log.log(msg);
    var command = getCommandByName(commandName);
    if (command) {
      result = _self.executeCommand(command, modifier, source);
    } else {
      msg = '[HOME] Command (' + commandName + ') not found.';
      log.warn(msg);
      result = {error: msg};
    }
    return result;
  };

  this.executeCommand = function(command, modifier, source) {
    var result = {};
    if (command.state) {
      log.debug('[HOME] ExecuteCommand:state ' + command.state);
      setState(command.state);
    }
    if (command.hueScene) {
      if (hue) {
        log.debug('[HOME] ExecuteCommand:hueScene');
        try {
          result.hueScene = hue.activateScene(command.hueScene);
        } catch (ex) {
          log.exception('[HOME] Hue scene failed', ex);
          result.hueScene = {hueScene: cmd.hueScene, error: ex};
        }
      } else {
        result.hueScene = '[HOME] Hue scene failed, Hue not ready.';
        log.warn(result.hueScene);
      }
    }
    if (command.hue) {
      if (hue) {
        log.debug('[HOME] ExecuteCommand:hue');
        result.hue = [];
        command.hue.forEach(function(cmd) {
          var scene;
          if (modifier) {
            scene = getLightSceneByName(modifier);
          } else {
            scene = getLightSceneByName(cmd.command);
          }
          try {
            hue.setLightState(cmd.lights, scene);
            result.hue.push({lights: cmd.lights, scene: scene});
          } catch (ex) {
            log.exception('[HOME] Hue command failed', ex);
            result.hue.push({lights: cmd.lights, scene: scene, error: ex});
          }
        });
      } else {
        result.hue = '[HOME] Hue command failed, Hue not ready.';
        log.warn(result.hue);
      }
    }
    if (command.zwave) {
      if (zwave) {
        log.debug('[HOME] ExecuteCommand:zwave');
        result.zwave = [];
        var keys = Object.keys(command.zwave);
        keys.forEach(function(k) {
          var onOff = command.zwave[k];
          if (modifier === 'OFF') {
            onOff = false;
          }
          try {
            result.zwave.push(zwave.setNodeBinary(k, onOff));
          } catch (ex) {
            log.exception('[HOME] ZWave command failed', ex);
            result.zwave.push({zwave: k, onOff: onOff, error: ex});
          }
        });
      } else {
        result.zwave = '[HOME] ZWave command failed, ZWave not ready.';
        log.warn(result.zwave);
      }
    }
    if (command.zwaveAdmin) {
      if (zwave) {
        log.debug('[HOME] ExecuteCommand:zwaveAdmin');
        try {
          if (command.zwaveAdmin === 'addDevice') {
            result.zwaveAdmin = zwave.addDevice();
          } else if (command.zwaveAdmin === 'healNetwork') {
            result.zwaveAdmin = zwave.healNetwork();
          }
        } catch (ex) {
          log.exception('[HOME] ZWave AddDevice command failed', ex);
          result.zwaveAdmin = ex;
        }
      } else {
        result.zwaveAdmin = '[HOME] ZWave command failed, ZWave not ready.';
        log.warn(result.zwaveAdmin);
      }
    }
    if (command.nest) {
      log.debug('[HOME] ExecuteCommand:nest');
      command.nest.forEach(function(cmd) {
        result.nest = [];
        /* jshint -W106 */
        // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
        var thermostatId = cmd.thermostatId;
        var mode = cmd.hvac_mode;
        var temperature = cmd.targetTemperature;
        var current = _self.state.nest.devices.thermostats[thermostatId];
        if (modifier === 'OFF') {
          mode = 'off';
        } else if (modifier === 'DOWN') {
          temperature = current.target_temperature_f - 1;
        } else if (modifier === 'UP') {
          temperature = current.target_temperature_f + 1;
        }
        result.nest.push(setNestThermostat(thermostatId, temperature, mode));
        /* jshint +W106 */
        // jscs:enable
      });
    }
    if (command.harmony) {
      if (harmony) {
        log.debug('[HOME] ExecuteCommand:harmony');
        try {
          result.harmony = harmony.setActivityByName(command.harmony);
        } catch (ex) {
          log.exception('[HOME] Harmony activity failed', ex);
          result.harmony = ex;
        }
      } else {
        result.harmony = '[HOME] Harmony activity failed, Harmony not ready.';
        log.warn(result.harmony);
      }
    }
    if (command.harmonyCmd) {
      if (harmony) {
        log.debug('[HOME] ExecuteCommand:harmonyCmd');
        try {
          result.harmony = harmony.sendCommand(command.harmonyCmd);
        } catch (ex) {
          log.exception('[HOME] Harmony command failed', ex);
          result.harmonyCmd = ex;
        }
      } else {
        result.harmonyCmd = '[HOME] Harmony command failed, Harmony not ready.';
        log.warn(result.harmony);
      }
    }
    if (command.hasOwnProperty('dropcam')) {
      if (nest) {
        log.debug('[HOME] ExecuteCommand:dropcam');
        try {
          if (modifier === 'OFF' || command.dropcam === false) {
            nest.disableCamera();
            result.dropcam = false;
          } else {
            nest.enableCamera();
            result.dropcam = true;
          }
        } catch (ex) {
          log.exception('[HOME] Nest Cam change failed', ex);
          result.dropcam = ex;
        }
      } else {
        result.dropcam = '[HOME] Nest Cam change failed, Nest cam not ready.';
        log.warn(result.dropcam);
      }
    }
    if (command.sound) {
      log.debug('[HOME] ExecuteCommand:sound');
      playSound(command.sound, command.soundForce);
    }
    if (command.hasOwnProperty('doNotDisturb')) {
      log.debug('[HOME] ExecuteCommand:doNotDisturb');
      log.log('TEST - 1 ' + command.doNotDisturb);
      if (modifier === 'OFF') {
        command.doNotDisturb = false;
      }
      log.log('TEST - 2 ' + command.doNotDisturb);
      setDoNotDisturb(command.doNotDisturb);
      result.doNotDisturb = command.doNotDisturb;
    }
    return result;
  };

  this.executeHueCommand = function(light, sceneName, source) {
    var scene = getLightSceneByName(sceneName);
    var msg = '[HOME] ExecuteHueCommand [' + light + '] to ';
    msg += sceneName + ' from: ' + source;
    log.log(msg);
    return hue.setLightState([light], scene);
  };

  this.executeHueScene = function(hueSceneId, source) {
    var msg = '[HOME] ExecuteHueScene [' + hueSceneId + '] from ';
    msg += source;
    log.log(msg);
    return hue.activateScene(hueSceneId);
  };

  this.ringDoorbell = function(source) {
    log.log('[HOME] Doorbell');
    fbSet('state/lastDoorbell', Date.now());
    return _self.executeCommandByName('RUN_ON_DOORBELL', null, source);
  };

  /*****************************************************************************
   *
   * Primary command helpers
   *
   ****************************************************************************/

  function setNestThermostat(thermostatId, targetTemperature, mode) {
    /* jshint -W106 */
    // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
    if (nest) {
      var current = _self.state.nest.devices.thermostats[thermostatId];
      if (!targetTemperature) {
        targetTemperature = current.target_temperature_f;
      }
      if (!mode) {
        mode = current.hvac_mode;
      }
      return nest.setTemperature(thermostatId, targetTemperature, mode);
    } else {
      log.warn('[HOME] Nest thermostat change failed, Nest not ready.');
    }
    /* jshint +W106 */
    // jscs:enable
  }

  function handleDoorEvent(doorName, doorState, updateState) {
    try {
      if (_self.state.doors[doorName] === doorState) {
        log.info('[HOME] Door debouncer, door already ' + doorState);
        return;
      }
    } catch (ex) {
      // NoOp - if the door wasn't set before, it will be now.
    }
    fbSet('state/doors/' + doorName, doorState);
    var now = Date.now();
    var doorLogObj = {
      level: 'INFO',
      message: doorName + ' door ' + doorState,
      doorName: doorName,
      state: doorState,
      date: now,
      date_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS')
    };
    fbPush('logs/doors', doorLogObj);
    log.log('[HOME] ' + doorName + ' ' + doorState);
    if (updateState === true) {
      if (_self.state.systemState === 'AWAY' && doorState === 'OPEN') {
        setState('HOME');
      }
    }
    var cmdName = 'DOOR_' + doorName;
    var modifier;
    if (doorState === 'CLOSED') {
      modifier = 'OFF';
    }
    return _self.executeCommandByName(cmdName, modifier, 'DOOR_' + doorName);
  }

  function setDoNotDisturb(val) {
    log.log('TEST - 3 ' + val);
    fbSet('state/doNotDisturb', val);
    log.log('[HOME] Do Not Disturb set to: ' + val);
  }

  function setState(newState) {
    if (armingTimer) {
      clearTimeout(armingTimer);
      armingTimer = null;
    }
    var armingDelay = config.armingDelay || 90000;
    if (newState === 'ARMED') {
      armingTimer = setTimeout(function() {
        armingTimer = null;
        setState('AWAY');
      }, armingDelay);
    }
    if (_self.state.systemState === newState) {
      log.warn('[HOME] State already set to ' + newState);
      return;
    }
    fbSet('state/systemState', newState);
    var now = Date.now();
    var stateLog = {
      level: 'INFO',
      message: newState,
      state: newState,
      date: now,
      date_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS')
    };
    fbPush('logs/systemState', stateLog);
    log.log('[HOME] State changed to: ' + newState);
    if (nest) {
      if (newState === 'AWAY' || newState === 'ARMED') {
        nest.setAway();
      } else {
        nest.setHome();
      }
    }
    _self.executeCommandByName('RUN_ON_' + newState, null, 'SET_STATE');
    return newState;
  }

  function playSound(file, force) {
    if (_self.state.doNotDisturb === false || force === true) {
      setTimeout(function() {
        var cmd = 'mplayer ';
        cmd += file;
        exec(cmd, function(error, stdout, stderr) {
          if (error) {
            log.exception('[HOME] PlaySound Error', error);
          }
        });
        log.debug('[HOME] PlaySound: ' + file);
      }, 1);
    }
  }

  /*****************************************************************************
   *
   * Firebase & Log Helpers
   *
   ****************************************************************************/

  function fbPush(path, value) {
    var fbObj = fb;
    if (path) {
      fbObj = fb.child(path);
    }
    try {
      fbObj.push(value, function(err) {
        if (err) {
          log.exception('[HOME] Unable to push data to Firebase. (CB)', err);
        }
      });
      fbSetLastUpdated();
    } catch (ex) {
      log.exception('[HOME] Unable to PUSH data to Firebase. (TC)', ex);
    }
  }

  function fbSet(path, value) {
    var fbObj = fb;
    if (path) {
      fbObj = fb.child(path);
    }
    try {
      if (value === null) {
        fbObj.remove();
      } else {
        fbObj.set(value, function(err) {
          if (err) {
            log.exception('[HOME] Set data failed on path: ' + path, err);
          }
        });
      }
      fbSetLastUpdated();
    } catch (ex) {
      log.exception('[HOME] Unable to set data on path: ' + path, ex);
    }
  }

  function fbSetLastUpdated() {
    var now = Date.now();
    fb.child('state/time').update({
      lastUpdated: now,
      lastUpdated_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS')
    });
  }

  /*****************************************************************************
   *
   * Weather - Initialization
   *
   ****************************************************************************/

  function initWeather() {
    var url = 'https://publicdata-weather.firebaseio.com/';
    url += config.fbWeatherCity;
    var weatherRef = new Firebase(url);
    weatherRef.child('currently').on('value', function(snapshot) {
      fbSet('state/weather/now', snapshot.val());
    });
    weatherRef.child('daily/data/0').on('value', function(snapshot) {
      fbSet('state/weather/today', snapshot.val());
    });
  }

  /*****************************************************************************
   *
   * Presence - Initialization & Shut Down
   *
   ****************************************************************************/

  function initPresence() {
    try {
      presence = new Presence();
    } catch (ex) {
      log.exception('[HOME] Unable to initialize Presence', ex);
      shutdownPresence();
      return;
    }

    if (presence) {
      presence.on('adapterError', shutdownPresence);
      presence.on('presence_unavailable', shutdownPresence);
      presence.on('error', function(err) {
        log.exception('[HOME] Presence error', err);
      });
      presence.on('change', function(person, present, who) {
        var presenceLog = {
          level: 'INFO',
          message: person.name + ' is ' + person.state,
          name: person.name,
          state: person.state,
          date: person.lastSeen,
          date_: person.lastSeen_
        };
        fbPush('logs/presence', presenceLog);
        fbSet('state/presence', who);
        var cmdName = 'PRESENCE_SOME';
        if (present === 0) {
          cmdName = 'PRESENCE_NONE';
        }
        _self.executeCommandByName(cmdName, null, 'PRESENCE');
      });
      var fbPresPath = 'config/HomeOnNode/presence/people';
      fb.child(fbPresPath).on('child_added', function(snapshot) {
        if (presence) {
          presence.addPerson(snapshot.val());
        }
      });
      fb.child(fbPresPath).on('child_removed', function(snapshot) {
        if (presence) {
          var uuid = snapshot.val().uuid;
          presence.removePersonByKey(uuid);
        }
      });
      fb.child(fbPresPath).on('child_changed', function(snapshot) {
        if (presence) {
          presence.updatePerson(snapshot.val());
        }
      });
    }
  }

  function shutdownPresence() {
    log.log('[HOME] Shutting down Presence.');
    try {
      presence.shutdown();
    } catch (ex) {
      log.debug('[HOME] Error attempting to shut down Presence.');
    }
    var fbPresPath = 'config/HomeOnNode/presence/people';
    fb.child(fbPresPath).off();
    presence = null;
  }

  /*****************************************************************************
   *
   * Harmony - Initialization & Shut Down
   *
   ****************************************************************************/

  function initHarmony() {
    try {
      harmony = new Harmony(Keys.harmony.key);
    } catch (ex) {
      log.exception('[HOME] Unable to initialize Harmony', ex);
      shutdownHarmony();
      return;
    }

    if (harmony) {
      harmony.on('ready', function(config) {
      });
      harmony.on('activity', function(activity) {
        fbSet('state/harmony', activity);
        log.log('[HOME] Harmony activity is: ' + JSON.stringify(activity));
      });
      harmony.on('no_hubs_found', shutdownHarmony);
      harmony.on('connection_failed', shutdownHarmony);
      harmony.on('error', function(err) {
        log.exception('[HOME] Harmony error occured.', err);
      });
    }
  }

  function shutdownHarmony() {
    log.log('[HOME] Shutting down Harmony.');
    try {
      harmony.close();
    } catch (ex) {
      log.debug('[HOME] Error attempting to shut down Harmony.');
    }
    harmony = null;
  }

  /*****************************************************************************
   *
   * Nest - Initialization & Shut Down
   *
   ****************************************************************************/

  function initNest() {
    try {
      nest = new Nest();
      log.todo('[HOME] Setup Nest Alarms');
    } catch (ex) {
      log.exception('[HOME] Unable to initialize Nest', ex);
      shutdownNest();
      return;
    }

    if (nest) {
      nest.login(Keys.nest.token);
      nest.on('authError', function(err) {
        log.exception('[HOME] Nest auth error occured.', err);
        shutdownNest();
      });
      nest.on('change', function(data) {
        log.debug('[HOME] Nest changed');
        fbSet('state/nest', data);
      });
      nest.on('alarm', function(kind, protect) {
        // TODO
        var msg = '[HOME] Nest Alarm NYI!!';
        msg += ' kind: ' + JSON.stringify(kind);
        msg += ' protect: ' + JSON.stringify(protect);
        log.warn(msg);
        _self.executeCommand({soundOverride: 'sounds/bell.mp3'});
      });
      nest.on('ready', function(data) {
        nest.enableListener();
      });
    }
  }

  function shutdownNest() {
    log.log('[HOME] Shutting down Nest.');
    nest = null;
  }

  /*****************************************************************************
   *
   * Hue - Initialization & Shut Down
   *
   ****************************************************************************/

  function initHue() {
    try {
      hue = new Hue(Keys.hueBridge.key);
    } catch (ex) {
      log.exception('[HOME] Unable to initialize Hue', ex);
      shutdownHue();
      return;
    }

    if (hue) {
      hue.on('no_hubs_found', function() {
        log.error('[HOME] No Hue Hubs found.');
        shutdownHue();
      });
      hue.on('change', function(hueState) {
        fbSet('state/hue', hueState);
        hueAwayToggle(hueState.sensors);
      });
      hue.on('ready', function() {
      });
      hue.on('error', function(err) {
        log.error('[HOME] Hue error occured.' + JSON.stringify(err));
      });
    }
  }

  function hueAwayToggle(sensors) {
    var sensorId = config.hueAwaySensorToggleId;
    if (sensorId && sensors && sensors[sensorId]) {
      var sensor = sensors[sensorId];
      if (sensor.modelid !== 'awayToggler') {
        log.error('[HOME] Invalid Hue Sensor type for Away Toggler.');
        return;
      }
      if (sensor.state.flag === true) {
        hue.setSensorFlag(sensorId, false);
        log.log('[HOME] State change triggered by Hue');
        if (_self.state.systemState === 'HOME') {
          setState('ARMED');
        } else {
          setState('HOME');
        }
      }
    }
  }

  function shutdownHue() {
    log.log('[HOME] Shutting down Hue.');
    hue = null;
  }

  /*****************************************************************************
   *
   * Notifications - Initialization & Shut Down
   *
   ****************************************************************************/

  function initNotifications() {
    fb.child('state/hasNotification').on('value', function(snapshot) {
      if (snapshot.val() === true) {
        if (_self.state.systemState === 'HOME') {
          _self.executeCommandByName('NEW_NOTIFICATION', null, 'HOME');
        }
        log.log('[HOME] New notification received.');
        snapshot.ref().set(false);
      }
    });
  }

  /*****************************************************************************
   *
   * ZWave - Initialization, Shut Down & Event handlers
   *
   ****************************************************************************/

  function initZWave() {
    try {
      zwave = new ZWave();
      log.todo('[HOME] Setup ZWave Timer');
    } catch (ex) {
      log.exception('[HOME] Unable to initialize ZWave', ex);
      shutdownZWave();
      return;
    }

    if (zwave) {
      zwave.on('zwave_unavailable', shutdownZWave);
      zwave.on('invalid_network_key', shutdownZWave);
      zwave.on('error', function(err) {
        log.error('[HOME] ZWave Error: ' + JSON.stringify(err));
      });
      zwave.on('ready', function(nodes) {
        fbSet('state/zwave/nodes', nodes);
        zwaveTimer = setInterval(zwaveTimerTick, 30000);
      });
      zwave.on('node_event', zwaveEvent);
      zwave.on('node_value_change', zwaveSaveNodeValue);
      zwave.on('node_value_refresh', zwaveSaveNodeValue);
      zwave.on('node_value_removed', function(nodeId, info) {
        var msg = '[' + nodeId + '] ' + JSON.stringify(info);
        log.warn('[HOME] ZWave - nodeValueRemoved: ' + msg);
      });
    }
  }

  function zwaveEvent(nodeId, value) {
    var device = config.zwave[nodeId];
    if (device) {
      var deviceName = device.label.toUpperCase();
      if (device.kind === 'DOOR') {
        var doorState = value === 255 ? 'OPEN' : 'CLOSED';
        handleDoorEvent(deviceName, doorState, device.updateState);
      } else if (device.kind === 'MOTION') {
        var cmdName = 'MOTION_' + deviceName;
        _self.executeCommandByName(cmdName, null, deviceName);
      } else {
        log.warn('[HOME] Unknown ZWave device kind: ' + nodeId);
      }
    } else {
      log.warn('[HOME] Unhandled ZWave Event:' + nodeId + ':' + value);
    }
  }

  function zwaveSaveNodeValue(nodeId, info) {
    /* jshint -W106 */
    // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
    var valueId = info.value_id;
    // jscs:enable
    /* jshint +W106 */
    if (valueId) {
      try {
        var path;
        valueId = valueId.replace(nodeId + '-', '');
        if (valueId === '49-1-1') { // Temperature
          path = 'temperature';
        } else if (valueId === '49-1-5') { // Humidity
          path = 'humidity';
        } else if (valueId === '49-1-3') { // Luminance
          path = 'luminance';
        } else if (valueId === '49-1-27') { // UV
          path = 'uv';
        } else if (valueId === '128-1-0') { // Battery
          path = 'battery';
        } else if (valueId === '113-1-1') { // Alarm
          path = 'alarm';
        } else {
          path = valueId;
        }
        var now = new Date();
        var value = {
          date: now,
          date_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS')
        };
        value.value = info.value;
        if (info.value === undefined || info.value === null) {
          value.value = info;
        }
        var nodeName = config.zwave[nodeId].label || nodeId;
        path = 'state/sensor/' + nodeName + '/' + path;
        fbSet(path, value);
        log.log('[HOME] ZWave - saveNodeValue: ' + path + ': ' + value.value);
      } catch (ex) {
        log.exception('[HOME] Error in saveNodeValue', ex);
      }
    } else {
      log.error('[HOME] ZWave - no valueId for saveNodeValue');
    }
  }

  function zwaveTimerTick() {
    //log.debug('[HOME] ZWave Timer Tick');
    var nodes = zwave.getNode();
    fbSet('state/zwave/nodes', nodes);
  }

  function shutdownZWave() {
    log.log('[HOME] Shutting down ZWave.');
    if (zwaveTimer) {
      clearInterval(zwaveTimer);
      zwaveTimer = null;
    }
    try {
      zwave.disconnect();
    } catch (ex) {
      log.debug('[HOME] Error attempting to shut down Harmony.');
    }
    zwave = null;
    fbSet('state/zwave');
  }

  /*****************************************************************************
   *
   * Main App - Initialization & Shut Down
   *
   ****************************************************************************/

  function init() {
    log.init('[HOME] Initializing home.');
    var now = Date.now();
    _self.state = {
      doNotDisturb: false,
      hasNotification: false,
      systemState: 'AWAY',
      time: {
        started: now,
        started_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS'),
        lastUpdated: now,
        lastUpdated_: moment(now).format('YYYY-MM-DDTHH:mm:ss.SSS')
      },
      gitHead: version.head
    };
    fbSet('state/time/started', _self.state.time.started);
    fbSet('state/time/updated', _self.state.time.started);
    fbSet('state/time/started_', _self.state.time.started_);
    fbSet('state/time/updated_', _self.state.time.started_);
    fbSet('state/gitHead', _self.state.gitHead);
    fb.child('state').on('value', function(snapshot) {
      _self.state = snapshot.val();
    });
    fb.child('config/HomeOnNode').on('value', function(snapshot) {
      config = snapshot.val();
      log.log('[HOME] Config file updated.');
      fs.writeFile('config.json', JSON.stringify(config, null, 2));
    });
    initNotifications();
    initZWave();
    initNest();
    initHue();
    initHarmony();
    initPresence();
    initWeather();
    setTimeout(function() {
      log.log('[HOME] Ready');
      _self.emit('ready');
    }, 750);
    playSound(config.readySound);
  }

  this.shutdown = function() {
    shutdownHarmony();
    shutdownHue();
    shutdownNest();
    shutdownZWave();
    shutdownPresence();
  };

  init();
}

util.inherits(Home, EventEmitter);

module.exports = Home;
