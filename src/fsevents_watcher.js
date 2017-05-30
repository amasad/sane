'use strict';

var fs = require('fs');
var path = require('path');
var common = require('./common');
var EventEmitter = require('events').EventEmitter;
var fsevents = require('fsevents');

/**
 * Constants
 */

var CHANGE_EVENT = common.CHANGE_EVENT;
var DELETE_EVENT = common.DELETE_EVENT;
var ADD_EVENT = common.ADD_EVENT;
var ALL_EVENT = common.ALL_EVENT;

/**
 * Export `FSEventsWatcher` class.
 */

module.exports = FSEventsWatcher;

/**
 * Watches `dir`.
 *
 * @class FSEventsWatcher
 * @param String dir
 * @param {Object} opts
 * @public
 */

function FSEventsWatcher(dir, opts) {
  common.assignOptions(this, opts);

  this.root = path.resolve(dir);
  this.watcher = fsevents(this.root);

  this.watcher
    .start()
    .on('modified', this.emitEvent.bind(this, CHANGE_EVENT))
    .on('created', this.emitEvent.bind(this, ADD_EVENT))
    .on('deleted', this.emitEvent.bind(this, DELETE_EVENT));

  setTimeout(this.emit.bind(this, 'ready'));
}

FSEventsWatcher.prototype.__proto__ = EventEmitter.prototype;

/**
 * Given an absolute path of a file or directory check if we need to watch it.
 *
 * @param {string} filepath
 * @param {object} stat
 * @private
 */

FSEventsWatcher.prototype.filter = function(filepath, stat) {
  return (
    stat.isDirectory() ||
    common.isFileIncluded(
      this.globs,
      this.dot,
      this.doIgnore,
      path.relative(this.root, filepath)
    )
  );
};

/**
 * Normalize and emit an event.
 *
 * @param {EventEmitter} monitor
 * @private
 */

FSEventsWatcher.prototype.emitEvent = function(type, file) {
  var self = this;
  console.log('here');
  if (type === DELETE_EVENT) {
    emit(null);
  } else {
    fs.lstat(file, function(err, stat) {
      if (err) {
        self.emit('error', err);
        return;
      }

      emit(stat);
    });
  }

  function emit(stat) {
    file = path.relative(self.root, file);
    self.emit(type, file, self.root, stat);
    self.emit(ALL_EVENT, type, file, self.root, stat);
  }
};

/**
 * End watching.
 *
 * @public
 */

FSEventsWatcher.prototype.close = function(callback) {
  this.watcher.stop();
  this.removeAllListeners();
  if (typeof callback === 'function') {
    setImmediate(callback.bind(null, null, true));
  }
};
