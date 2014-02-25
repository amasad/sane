var fs = require('fs');
var path = require('path');
var walker = require('walker');
var minimatch = require('minimatch');
var EventEmitter = require('events').EventEmitter;

module.exports = sane;

/**
 * Sugar for creating a watcher.
 *
 * @param {Array<string>} files
 * @param {Array<string>} globs
 * @return {Watcher}
 * @public
 */

function sane(files, globs) {
  return new Watcher(files, globs);
}

/**
 * Export `Watcher` class.
 */

sane.Watcher = Watcher;

/**
 * Watches files and dirs.
 *
 * @class Watcher
 * @param {Array<string>} files
 * @param {object} opts
 */

function Watcher(dir, opts) {
  opts = opts || {};
  this.persistent = opts.persistent || false;
  this.globs = opts.glob || [];
  if (!Array.isArray(this.globs)) this.globs = [this.glob];
  this.watchers = [];
  this.changeTimers = {};
  this.dir = dir
  this.watchdir = this.watchdir.bind(this);
  this.watchdir(dir);
  recReaddir(dir, this.watchdir, this.emit.bind(this, 'ready'));
}

Watcher.prototype.__proto__ = EventEmitter.prototype;

/**
 * Watch a directory.
 *
 * @param {string} dir
 */

Watcher.prototype.watchdir = function(dir) {
  var relativePath = path.relative(this.dir, dir);
  var watcher = fs.watch(dir, function(event, filename) {
    this.onChange(path.join(relativePath, filename));
  }.bind(this));
  this.watchers.push(watcher);
};

/**
 * End watching.
 *
 * @public
 */

Watcher.prototype.close = function() {
  var watchers = this.watchers;
  for (var i = 0; i < watchers.length; i++) {
    watchers[i].close();
  }
  this.removeAllListeners();
};

/**
 * Triggers a 'change' event after debounding it to take care of duplicate
 * events on os x.
 *
 * @public
 */

Watcher.prototype.onChange = function(file) {
  clearTimeout(this.changeTimers[file]);
  this.changeTimers[file] = setTimeout(function() {
    var globs = this.globs;
    if (globs.length) {
      for (var i = 0; i < globs.length; i++) {
        if (minimatch(file, globs[i])) {
          this.emit('change', file);
          return true;
        }
      }
      return false;
    } else {
      this.emit('change', file);
      return true;
    }
  }.bind(this), 100);
};

/**
 * Traverse a directory recursively calling `callback` on every directory.
 *
 * @param {string} dir
 * @param {function} callback
 * @param {function} endCallback
 * @private
 */

function recReaddir(dir, callback, endCallback) {
  walker(dir)
    .on('dir', callback)
    .on('end', endCallback);
}
