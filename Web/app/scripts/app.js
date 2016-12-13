/*
Copyright (c) 2015 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
Code distributed by Google as part of the polymer project is also
subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
*/

(function(document) {
  'use strict';

  // Grab a reference to our auto-binding template
  // and give it some initial binding values
  // Learn more about auto-binding templates at http://goo.gl/Dx1u2g
  var app = document.querySelector('#app');

  // Sets app default base URL
  app.baseUrl = '/';
  if (window.location.port === '') {  // if production
    // Uncomment app.baseURL below and
    // set app.baseURL to '/your-pathname/' if running from folder in production
    // app.baseUrl = '/polymer-starter-kit/';
  }

  app.displayInstalledToast = function() {
    // Check to make sure caching is actually enabled—it won't be in the dev environment.
    if (!Polymer.dom(document).querySelector('platinum-sw-cache').disabled) {
      Polymer.dom(document).querySelector('#caching-complete').show();
    }
  };

  // Listen for template bound event to know when bindings
  // have resolved and content has been stamped to the page
  app.addEventListener('dom-change', function() {
    //console.log('Our app is ready to rock!');
  });

  // See https://github.com/Polymer/polymer/issues/1381
  window.addEventListener('WebComponentsReady', function() {
    app.confirmDialog = document.querySelector('#confirmDialog');
    app.fbData = document.querySelector('#fbData');
  });

  // Scroll page to top and expand header
  app.scrollPageToTop = function() {
    //app.$.headerPanelMain.scrollToTop(true);
  };

  app.closeDrawer = function() {
    app.$.paperDrawerPanel.closeDrawer();
  };

  app.showToast = function(text) {
    app.$.toast.text = text;
    app.$.toast.show();
  };

  app.fbRoot = new Firebase(window.fbURL);
  app.fbRoot.authWithCustomToken(window.fbKey, function(err, user) {
    if (err) {
      console.warn('fbRoot Auth', err);
    } else {
      console.log('fbRoot Auth', user);
      // app.showToast('Connected to HomeOnNode.');
      app.fbRoot.child('.info/connected').on('value', function(snapshot) {
        if (snapshot.val() === true) {
          app.showToast('Connected to HomeOnNode');
          app.fbConnected = true;
          // app.page = 'home';
        } else {
          app.showToast('ERROR: Connection to HomeOnNode lost.');
          app.fbConnected = false;
          // app.page = 'loading';
        }
      });
      app.fbRoot.child('sayThis').limitToLast(1).on('child_added', function(snapshot) {
        if (app.speechSynthesisEnabled === true) {
          var utterance = snapshot.val();
          var allowedDiff = 30 * 60 * 1000;
          var timeDiff = Date.now() - utterance.sayAt;
          if (timeDiff < allowedDiff) {
            app.sayThis(utterance.utterance, utterance.lang);
            snapshot.ref().remove();
          }
        }
      });
    }
  });
  app.fbCommandRef = app.fbRoot.child('commands');
  app.sendCommand = function(cmd) {
    app.lastInput = Date.now();
    console.log('[sendCommand]', cmd);
    app.fbCommandRef.push(cmd, function(err) {
      if (err) {
        console.error('[sendCommand]', cmd, err);
      }
    });
  };
  app.lastInput = Date.now();
  app.speechSynthesisEnabled = false;
  if (localStorage.getItem('speechSynthesis') === 'true') {
    app.speechSynthesisEnabled = true;
  }
  app.sayThis = function(sentence, lang) {
    lang = lang || 'en-GB';
    var utterance = new window.SpeechSynthesisUtterance(sentence);
    utterance.lang = lang;
    window.speechSynthesis.speak(utterance);
    return utterance;
  };

})(document);
