var EventEmitter = require("events").EventEmitter;
var util = require("util");
var exec = require("child_process").exec;
var log = require("./SystemLog");
var Keys = require("./Keys");

var InsideTemperature = require("./InsideTemperature");
var Firebase = require("firebase");
var AirConditioner = require("./AirConditioner");
var Harmony = require("./Harmony");
var Hue = require("./Hue");
var Door = require("./Door");
var GoogleVoice = require("./GoogleVoice");

function Home(fb) {
  this.state = {};
  this.harmonyConfig = {};
  var ready = false;
  var config;
  var _self = this;

  var awayTimer;
  var hue, harmony, airConditioners, insideTemp, door, gv;

  this.set = function(command, options, source) {
    var logMsg = "Command Received: " + command + " " + "[" + options + "]";
    if (source) {
      logMsg += " from: " + source;
    }
    log.log(logMsg);
    var cmd = config.commands[command];
    if (cmd) {
      if (cmd.system_state) {
        setState(cmd.system_state);
      }
      if (cmd.hue) {
        for (var i = 0; i < cmd.hue.length; i++) {
          var hue_cmd = options || cmd.hue[i].command;
          hue_cmd = config.light_recipes[hue_cmd];
          hue.setLights(cmd.hue[i].lights, hue_cmd);
        }
      }
      if (cmd.ac) {
        var acKeys = Object.keys(cmd.ac);
        for (var i = 0; i < acKeys.length; i++) {
          var temperature = cmd.ac[acKeys[i]];
          _self.setACTemperature(acKeys[i], temperature);
        }
      }
      if (cmd.harmony) {
        harmony.startActivity(cmd.harmony);
      }
      if (cmd.sound) {
        playSound(cmd.sound);
      }
    }
    return {"result": "OK"};
  };

  this.setTemperature = function(id, temperature) {
    log.log("Set AC [" + id + "] to " + temperature + "F");
    if (temperature === "AUTO") {
      if ((_self.state.temperature.inside >= config.airconditioners.auto.inside) ||
          (_self.state.temperature.outside >= config.airconditioners.auto.outside)) {
        temperature = config.airconditioners.default_temperature;
      } else {
        temperature = null;
      }
    }
    if (temperature !== null) {
      airConditioners[id].setTemperature(temperature);
      _self.state.ac[id] = temperature;
      fbSet("state/ac/" + id, temperature);
    }
    return {"result": "OK"};
  };

  this.shutdown = function() {
    harmony.close();
    // would be nice to have a shutdown time.
  };

  function fbPush(path, value) {
    var fbObj = fb;
    if (path) {
      fbObj = fb.child(path);
    }
    fb.child("state/time").update({"last_updated": Date.now()});
    fbObj.push(value);
  }

  function fbSet(path, value) {
    var fbObj = fb;
    if (path) {
      fbObj = fb.child(path);
    }
    fb.child("state/time").update({"last_updated": Date.now()});
    fbObj.set(value);
  }

  function setState(state) {
    log.log("Set State: " + state);
    if (state === "ARMED") {
      if (awayTimer) {
        clearTimeout(awayTimer);
      }
      awayTimer = setTimeout(function() {
        awayTimer = null;
        setState("AWAY");
      }, config.away_timeout);
    }
    _self.state.system_state = state;
    fbSet("state/system_state", state);
    fbPush("system_state", {"date": Date.now(), "state": state});
  }

  function playSound(file) {
    setTimeout(function() {
      var cmd = "mplayer -ao alsa -really-quiet -noconsolecontrols ";
      cmd += file;
      exec(cmd, function(error, stdout, stderr) {
        if (error !== null) {
          log.error("[HOME] PlaySound Error: " + error.toString());
        }
      });
      log.debug("PlaySound: " + file);
    }, 1);
  }

  function initInsideTemp() {
    insideTemp = new InsideTemperature(config.temperature.inside.interval);
    if (_self.state.temperature === undefined) {
      _self.state.temperature = {};
    }
    insideTemp.on("error", function(error) {
      _self.state.temperature.inside = -1;
      fbSet("state/temperature/inside", error);
      log.error("[HOME] Error reading inside temperature: " + error);
    });
    insideTemp.on("change", function(data) {
      _self.state.temperature.inside = data.f;
      fbSet("state/temperature/inside", data.f);
      log.debug("[HOME] Inside temperature is " + data.f + "F");
    });
  }

  function initOutsideTemp() {
    if (_self.state.temperature === undefined) {
      _self.state.temperature = {};
    }
    var url = "https://publicdata-weather.firebaseio.com/";
    url += config.temperature.outside.city + "/currently";
    var weatherRef = new Firebase(url);
    weatherRef.child('temperature').on('value', function(snapshot) {
      _self.state.temperature.outside = snapshot.val();
      fbSet("state/temperature/outside", snapshot.val());
      log.debug("[HOME] Outside temperature is " + snapshot.val() + "F");
    });
  }

  function initAC() {
    airConditioners = {};
    _self.state.ac = {};
    var ip = config.airconditioners.itach_ip;
    var port = config.airconditioners.itach_port;
    config.airconditioners.ac.forEach(function(elem) {
      var id = elem.id;
      var cmds = config.airconditioners.commands[elem.protocol];
      airConditioners[id] = new AirConditioner(id, ip, port, cmds);
      _self.state.ac[id] = 0;
      fbSet("state/ac/" + id, 0);
    });
  }

  function initHarmony() {
    harmony = new Harmony(config.harmony.ip, Keys.keys.harmony);
    harmony.on("activity", function(activity) {
      _self.state.harmony_activity = activity;
      fbSet("state/harmony_activity", activity);
      log.log("[HOME] Harmony activity changed: " + activity);
    });
    harmony.on("config", function(cfg) {
      _self.harmonyConfig = cfg;
      fbSet("harmony_config", cfg);
    });
    harmony.on("error", function(err) {
      log.error("[HOME] Harmony Error");
      log.debug("[HARMONY] " + err.toString());
    });
    harmony.on("ready", function() {
      harmony.getConfig();
      harmony.getActivity();
    });
  }

  function initHue() {
    hue = new Hue(config.hue.interval, Keys.keys.hue, config.hue.ip);
    hue.on("update", function(data) {
      _self.state.hue = data;
      fbSet("state/hue", data);
    });
    hue.on("error", function (err) {
      var error = {"error": true, "result": err};
      _self.state.hue = error;
      fbSet("state/hue", error);
      log.error("[HOME] Error reading Hue state.");
      log.debug("[HUE] " + JSON.stringify(err));
    });
  }

  function initDoor() {
    _self.state.door = false;
    door = new Door();
    door.on("no-gpio", function() {
      _self.state.door = undefined;
      fbSet("state/door", null);
      log.error("[HOME] No GPIO found for door detection.");
    });
    door.on("change", function(data) {
      if (_self.state.system_state === "AWAY") {
        _self.set("HOME");
      }
      _self.state.door = data;
      fbSet("state/door", data);
      fbPush("door", {"date": Date.now(), "state": data});
    });
  }

  function initGoogleVoice() {
    gv = new GoogleVoice(config.gvoice.interval);
    gv.on("zero", function(count) {
      if (_self.state.system_state === "HOME") {
        _self.set("GV_ZERO");
      }
      _self.state.gvoice = count;
      fbSet("state/gvoice", count);
    });
    gv.on("new", function(count) {
      if (_self.state.system_state === "HOME") {
        _self.set("GV_NEW");
      }
      _self.state.gvoice = count;
      fbSet("state/gvoice", count);
    });
    gv.on("change", function(count) {
      _self.state.gvoice = count;
      fbSet("state/gvoice", count);
    });
    gv.on("error", function() {
      if (_self.state.system_state === "HOME") {
        _self.set("GV_ERROR");
      }
    });
  }

  function loadConfig() {
    log.log("[HOME] Reading config from Firebase.");
    fb.child("config").on("value", function(snapshot) {
      config = snapshot.val();
      log.log("[HOME] Config file updated.");
      if (ready === false) {
        init();
      }
    });
  }

  function init() {
    ready = true;
    fb.child("state/time").update({"started": Date.now()});
    log.log("[HOME] Initalizing components.");
    _self.state.system_state = "AWAY";
    initAC();
    initGoogleVoice();
    initInsideTemp();
    initOutsideTemp();
    initDoor();
    initHarmony();
    initHue();
    _self.emit("ready");
    playSound(config.ready_sound);
  }

  loadConfig();
}


util.inherits(Home, EventEmitter);

module.exports = Home;