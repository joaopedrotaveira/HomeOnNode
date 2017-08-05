'use strict';

const fs = require('fs');
const Keypad = require('./Keypad');
const log = require('./SystemLog2');
const Keys = require('./Keys').keys;
const Firebase = require('firebase');
const WSClient = require('./WSClient');
const DeviceMonitor = require('./DeviceMonitor');

const APP_NAME = process.argv[2];

let _fb;
let _config;
let _wsClient;
let _deviceMonitor;

if (!APP_NAME) {
  log.error('REMOTE', 'App Name not provided on command line');
  process.exit(1);
}
log.setAppName(APP_NAME);
const logOpt = {
  firebaseLogLevel: 40,
  firebasePath: `logs/${APP_NAME.toLowerCase()}`,
};
log.setOptions(logOpt);
log.startWSS();
log.appStart();

/**
 * Init
 */
function init() {
  _fb = new Firebase(`https://${Keys.firebase.appId}.firebaseio.com/`);
  _fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
    if (error) {
      log.exception(APP_NAME, 'Firebase auth failed.', error);
    } else {
      log.log(APP_NAME, 'Firebase auth success.');
    }
  });
  log.setFirebaseRef(_fb);
  _deviceMonitor = new DeviceMonitor(_fb.child('devices'), APP_NAME);
  _deviceMonitor.on('restart_request', () => {
    _deviceMonitor.restart();
  });
  _deviceMonitor.on('shutdown_request', () => {
    _exit('FB', 0);
  });

  _fb.child(`config/${APP_NAME}/logs`).on('value', (snapshot) => {
    log.setOptions(snapshot.val());
    log.debug(APP_NAME, 'Log config updated.');
  });

  let data;
  try {
    log.debug(APP_NAME, `Reading 'config.json'.`);
    data = fs.readFileSync('config.json', {encoding: 'utf8'});
  } catch (ex) {
    log.exception(APP_NAME, `Error reading 'config.json' file.`, ex);
    _exit('read_config', 1);
    return;
  }

  try {
    log.debug(APP_NAME, `Parsing 'config.json'.`);
    _config = JSON.parse(data);
  } catch (ex) {
    log.exception(APP_NAME, `Error parsing 'config.json' file.`, ex);
    _exit('parse_config', 1);
    return;
  }

  if (_config.enabled !== true) {
    log.error(APP_NAME, 'Disabled by config.', _config);
    _exit('disabled_by_config', 1);
    return;
  }

  _wsClient = new WSClient(_config.wsServer, true);

  _fb.child(`config/${APP_NAME}/keypad`).on('value', function(snapshot) {
    _config.keypad = snapshot.val();
    log.log(APP_NAME, 'Keypad settings updated.');
  });

  Keypad.listen(_config.keypad.modifiers, _handleKeyPress);
  setInterval(function() {
    log.cleanFile();
  }, 60 * 60 * 24 * 1000);
}

/**
 * Send a command
 *
 * @param {Object} command Command to send.
 * @return {Promise} The result of the ws send command.
*/
function _sendCommand(command) {
  if (_wsClient) {
    return _wsClient.send(JSON.stringify(command));
  }
  log.error(APP_NAME, `WebSocket client not ready.`);
}

/**
 * Handles a key press
 *
 * @param {String} key Character hit by the user.
 * @param {String} modifier If a modifier is used.
 * @param {Boolean} exitApp If the app should exit.
 */
function _handleKeyPress(key, modifier, exitApp) {
  const details = {
    key: key,
    modifier: modifier,
    exitApp: exitApp,
  };
  log.verbose(APP_NAME, 'Key pressed', details);
  if (exitApp) {
    log.log(APP_NAME, 'Exit requested.');
    _exit('KEYPAD', 0);
    return;
  }
  let cmd = _config.keypad.keys[key];
  if (cmd) {
    cmd.modifier = modifier;
    _sendCommand(cmd);
    return;
  }
  log.warn(APP_NAME, `Unknown key pressed.`, details);
}

/**
 * Exit the app.
 *
 * @param {String} sender Who is requesting the app to exit.
 * @param {Number} exitCode The exit code to use.
*/
function _exit(sender, exitCode) {
  exitCode = exitCode || 0;
  const details = {
    exitCode: exitCode,
    sender: sender,
  };
  log.log(APP_NAME, 'Starting shutdown process', details);
  if (_wsClient) {
    _wsClient.shutdown();
  }
  if (_deviceMonitor) {
    _deviceMonitor.shutdown(sender);
  }
  setTimeout(function() {
    log.appStop(sender);
    process.exit(exitCode);
  }, 1500);
}

process.on('SIGINT', function() {
  _exit('SIGINT', 0);
});

init();
