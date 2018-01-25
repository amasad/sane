'use strict';

var fs = require('fs');
var path = require('path');
var common = require('./common');
var watchmanClient = require('./watchman_client');
var EventEmitter = require('events').EventEmitter;
var RecrawlWarning = require('./utils/recrawl-warning-dedupe');

/**
 * Constants
 */

var CHANGE_EVENT = common.CHANGE_EVENT;
var DELETE_EVENT = common.DELETE_EVENT;
var ADD_EVENT = common.ADD_EVENT;
var ALL_EVENT = common.ALL_EVENT;

/**
 * Export `WatchmanWatcher` class.
 */

module.exports = WatchmanWatcher;

/**
 * Watches `dir`.
 *
 * @class WatchmanWatcher
 * @param String dir
 * @param {Object} opts
 * @public
 */

function WatchmanWatcher(dir, opts) {
  common.assignOptions(this, opts);
  this.root = path.resolve(dir);
  this.init();
}

WatchmanWatcher.prototype.__proto__ = EventEmitter.prototype;

/**
 * Run the watchman `watch` command on the root and subscribe to changes.
 *
 * @private
 */
WatchmanWatcher.prototype.init = function() {
  var self = this;
  
  if (this.client) {
    this.client = null;
  }

  // Create the 'options' structure for subscribe.
  // NOTE: this leaves out two things from the options, that
  // will be added by the WatchmanClient.
  //   - the 'since' field. This will be added in WC based on
  //     doing its own call to 'clock' for this watch.
  //   - the 'relative_root' field. We're hiding the existence
  //     of 'watch' vs 'watch-project' in the WatchmanClient, so
  //     this level doesn't even know about it.

  watchmanClient.getClient()
    .then((client) => {
      self.client = client;

      return self.client.subscribe(self, self.root)
        .then((resp) => {
          handleWarning(resp);
          self.emit('ready');
        });
    })
    .catch((error) => handleError(self, error));
};

/**
 * Called by WatchmanClient to create the options, either during initial 'subscribe'
 * or to recalculate after a disconnect+reconnect ('end' event), in case 'wildmatch'
 * changes values in the meantime. Note that we are leaving out the 'since' and 
 * 'relative_root' options. Those are dealt with inside the WatchmanClient--this 
 * watcher doesn't really need to even know about them.
 */
WatchmanWatcher.prototype.createOptions = function() {
  var self = this;

  let options = {
    fields: ['name', 'exists', 'new']
  };

  // If the server has the wildmatch capability available it supports
  // the recursive **/*.foo style match and we can offload our globs
  // to the watchman server.  This saves both on data size to be
  // communicated back to us and compute for evaluating the globs
  // in our node process.
  if (this.client.wildmatch) {
    if (this.globs.length === 0) {
      if (!this.dot) {
        // Make sure we honor the dot option if even we're not using globs.
        options.expression = [
          'match',
          '**',
          'wholename',
          {
            includedotfiles: false,
          },
        ];
      }
    } else {
      options.expression = ['anyof'];
      for (var i in this.globs) {
        options.expression.push([
          'match',
          this.globs[i],
          'wholename',
          {
            includedotfiles: this.dot,
          },
        ]);
      }
    }
  }

  return options;
}

/**
 * Called by WatchmanClient when it receives an error from the watchman server.
 */
WatchmanWatcher.prototype.handleErrorEvent = function(error) {
  this.emit('error', error);
}

/**
 * Handles a change event coming from the subscription.
 *
 * @param {Object} resp
 * @private
 */

WatchmanWatcher.prototype.handleChangeEvent = function(resp) {
  console.log("WW.handleChangeEvent for resp.subscription [" + resp.subscription + "]");
  if (Array.isArray(resp.files)) {
    resp.files.forEach(this.handleFileChange, this);
  }
};

/**
 * Handles a single change event record.
 *
 * @param {Object} changeDescriptor
 * @private
 */

WatchmanWatcher.prototype.handleFileChange = function(changeDescriptor) {
  var self = this;
  var absPath;
  var relativePath;

  relativePath = changeDescriptor.name;
  absPath = path.join(this.root, relativePath);

  if (!(this.client.wildmatch && !this.hasIgnore) &&
      !common.isFileIncluded(this.globs, this.dot, this.doIgnore, relativePath)) {
    return;
  }

  if (!changeDescriptor.exists) {
    self.emitEvent(DELETE_EVENT, relativePath, self.root);
  } else {
    fs.lstat(absPath, function(error, stat) {
      // Files can be deleted between the event and the lstat call
      // the most reliable thing to do here is to ignore the event.
      if (error && error.code === 'ENOENT') {
        return;
      }

      if (handleError(self, error)) {
        return;
      }

      var eventType = changeDescriptor.new ? ADD_EVENT : CHANGE_EVENT;

      // Change event on dirs are mostly useless.
      if (!(eventType === CHANGE_EVENT && stat.isDirectory())) {
        self.emitEvent(eventType, relativePath, self.root, stat);
        // For quick test
        self.client.onEnd();
      }
    });
  }
};

WatchmanWatcher.prototype.handleEndEvent = function() {
  console.warn('[sane] Warning: Lost connection to watchman, reconnecting..');
  this.init();
}

/**
 * Dispatches the event.
 *
 * @param {string} eventType
 * @param {string} filepath
 * @param {string} root
 * @param {fs.Stat} stat
 * @private
 */

WatchmanWatcher.prototype.emitEvent = function(eventType, filepath, root, stat) {
  this.emit(eventType, filepath, root, stat);
  this.emit(ALL_EVENT, eventType, filepath, root, stat);
};

/**
 * Closes the watcher.
 *
 * @param {function} callback
 * @private
 */

WatchmanWatcher.prototype.close = function(callback) {
  this.client.removeAllListeners();
  this.client.end();
  callback && callback(null, true);
};

/**
 * Handles an error and returns true if exists.
 *
 * @param {WatchmanWatcher} self
 * @param {Error} error
 * @private
 */

function handleError(self, error) {
  if (error != null) {
    self.emit('error', error);
    return true;
  } else {
    return false;
  }
}

/**
 * Handles a warning in the watchman resp object.
 *
 * @param {object} resp
 * @private
 */

function handleWarning(resp) {
  if ('warning' in resp) {
    if (RecrawlWarning.isRecrawlWarningDupe(resp.warning)) {
      return true;
    }
    console.warn(resp.warning);
    return true;
  } else {
    return false;
  }
}
