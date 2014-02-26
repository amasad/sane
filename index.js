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

function sane(files, glob) {
  return new Watcher(files, {glob: glob});
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
 * @public
 */

function Watcher(dir, opts) {
  opts = opts || {};
  this.persistent = opts.persistent || false;
  this.globs = opts.glob || [];
  if (!Array.isArray(this.globs)) this.globs = [this.glob];
  this.watchers = [];
  this.watched = Object.create(null);
  this.changeTimers = Object.create(null);
  this.dir = dir
  this.watchdir = this.watchdir.bind(this);
  this.stopWatching = this.stopWatching.bind(this);
  this.watchdir(dir);
  recReaddir(dir, this.watchdir, this.emit.bind(this, 'ready'));
}

Watcher.prototype.__proto__ = EventEmitter.prototype;

/**
 * Watch a directory.
 *
 * @param {string} dir
 * @private
 */

Watcher.prototype.watchdir = function(dir) {
  if (this.watched[dir]) return;
  var watcher = fs.watch(
    dir,
    { persistent: this.persistent },
    this.processChange.bind(this, dir)
  );
  this.watched[dir] = watcher;
};

/**
 * Stop watching a dir.s
 *
 * @param {string} dir
 * @private
 */

Watcher.prototype.stopWatching = function(dir) {
  if (this.watched[dir]) {
    this.watched[dir].close();
    this.watched[dir] = null;
  }
};

/**
 * End watching.
 *
 * @public
 */

Watcher.prototype.close = function() {
  Object.keys(this.watched).forEach(this.stopWatching);
  this.removeAllListeners();
};

/**
 * Process a change event.
 *
 * @param {string} dir
 * @param {string} event
 * @param {string} file
 * @public
 */

Watcher.prototype.processChange = function(dir, event, file) {
  var fullPath = path.join(dir, file);
  var relativePath = path.join(path.relative(this.dir, dir), file);
  fs.stat(fullPath, function(error, stat) {
    if (error && error.code === 'ENOENT') {
      this.stopWatching(fullPath);
      return;
    } else if (error) {
      this.emit('error', error);
      return;
    } else if (stat.isDirectory()) {
      this.watchdir(fullPath);
    } else if (this.globs.length) {
      var globs = this.globs;
      for (var i = 0; i < globs.length; i++) {
        if (minimatch(file, globs[i])) {
          this.emitChange(relativePath);
        }
      }
    } else {
      this.emitChange(relativePath);
    }
  }.bind(this));
};

/**
 * Triggers a 'change' event after debounding it to take care of duplicate
 * events on os x.
 *
 * @private
 */

Watcher.prototype.emitChange = function(file) {
  clearTimeout(this.changeTimers[file]);
  this.changeTimers[file] = setTimeout(function() {
    this.changeTimers[file] = null;
    this.emit('change', file);
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
