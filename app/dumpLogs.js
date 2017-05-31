'use strict';

const Keys = require('./Keys').keys;
const Firebase = require('firebase');
const log = require('./SystemLog2');

/**
 * Reboot the device.
 *
 * @param {String} path Firebase path of the logs to print.
*/
function printLogs(path) {
  fb.child(path).orderByChild('date').limitToLast(100).on('child_added',
    function(snapshot) {
      log.printLog(snapshot.val());
    }
  );
}

const fb = new Firebase(`https://${Keys.firebase.appId}.firebaseio.com/`);
fb.authWithCustomToken(Keys.firebase.key, function(error, authToken) {
  if (error) {
    log.exception('DUMPLOG', 'Firebase auth failed.', error);
  } else {
    log.log('DUMPLOG', 'Firebase auth success.');
    let path = process.argv[2] || 'logs';
    log.log('DUMPLOG', `logs/${path}`);
    printLogs(`logs/${path}`);
  }
});
