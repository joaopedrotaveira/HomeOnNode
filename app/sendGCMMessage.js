'use strict';

var GCMPush = require('./GCMPush');
var Keys = require('./Keys').keys;
var Firebase = require('firebase');
var log = require('./SystemLog2');

var gcmMessage = {
  title: 'HomeOnNode - Eep!',
  body: 'Something unexpected happened at',
  tag: 'HoN-unexpected',
  appendTime: true
};

function init() {
  var fbURL = 'https://' + Keys.firebase.appId + '.firebaseio.com';
  var fb = new Firebase(fbURL);
  fb.authWithCustomToken(Keys.firebase.key, function(error) {
    if (error) {
      log.exception('FB', 'Authentication error', error);
      process.exit(1);
    } else {
      var gcmPush = new GCMPush(fb);
      gcmPush.on('ready', function() {
        gcmPush.sendMessage(gcmMessage);
      });
    }
  });
}

init();
setTimeout(function() {
  process.exit(0);
}, 3000);
