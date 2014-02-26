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
  this.watched = Object.create(null);
  this.changeTimers = Object.create(null);
  this.dirRegistery = Object.create(null);
  this.root = path.resolve(dir);
  this.watchdir = this.watchdir.bind(this);
  this.register = this.register.bind(this);
  this.stopWatching = this.stopWatching.bind(this);
  this.watchdir(dir);
  recReaddir(
    dir,
    this.watchdir,
    this.register,
    this.emit.bind(this, 'ready')
  );
}

Watcher.prototype.__proto__ = EventEmitter.prototype;

/**
 * Register files that matches our globs to know what to type of event to
 * emit in the future.
 *
 * Registery looks like the following:
 *
 *  dirRegister => Map {
 *    dirpath => Map {
 *       filename => true
 *    }
 *  }
 *
 * @param {string} filepath
 * @return {boolean} whether or not we have registered the file.
 * @private
 */

Watcher.prototype.register = function(filepath) {
  var globs = this.globs;
  var matched;
  if (globs.length) {
    for (var i = 0; i < globs.length; i++) {
      if (minimatch(filepath, globs[i])) {
        matched = true;
        break;
      }
    }
  } else {
    matched = true;
  }
  if (!matched) return false;

  var dir = path.dirname(filepath);
  if (!this.dirRegistery[dir]) {
    this.dirRegistery[dir] = Object.create(null);
  }

  var filename = path.basename(filepath);
  this.dirRegistery[dir][filename] = true;

  return true;
};

/**
 * Removes a file from the registery.
 *
 * @param {string} filepath
 * @private
 */

Watcher.prototype.unregister = function(filepath) {
  var dir = path.dirname(filepath);
  if (this.dirRegistery[dir]) {
    var filename = path.basename(filepath);
    this.dirRegistery[dir][filename] = null;
  }
};

/**
 * Removes a dir from the registery.
 *
 * @param {string} dirpath
 * @private
 */

Watcher.prototype.unregisterDir = function(dirpath) {
  if (this.dirRegistery[dirpath]) {
    this.dirRegistery[dirpath] = null;
  }
};

/**
 * Checks if a file or directory exists in the registery.
 *
 * @param {string} fullpath
 * @return {boolean}
 * @private
 */

Watcher.prototype.registered = function(fullpath) {
  var dir = path.dirname(fullpath);
  return this.dirRegistery[fullpath] ||
    this.dirRegistery[dir] && this.dirRegistery[dir][path.basename(fullpath)];
};

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
  var relativePath = path.join(path.relative(this.root, dir), file);
  fs.stat(fullPath, function(error, stat) {
    if (error && error.code !== 'ENOENT') {
      this.emit('error', error);
    } else if (!error && stat.isDirectory()) {
      this.watchdir(fullPath);
      this.emitEvent('add', relativePath);
    } else {
      var registered = this.registered(fullPath);
      if (error && error.code === 'ENOENT') {
        this.unregister(fullPath);
        this.stopWatching(fullPath);
        this.unregisterDir(fullPath);
        if (registered) {
          this.emitEvent('delete', relativePath);
        }
      } else if (registered) {
        this.emitEvent('change', relativePath);
      } else {
        if (this.register(fullPath)) {
          this.emitEvent('add', relativePath);
        }
      }
    }
  }.bind(this));
};

/**
 * Triggers a 'change' event after debounding it to take care of duplicate
 * events on os x.
 *
 * @private
 */

Watcher.prototype.emitEvent = function(type, file) {
  var key = type + '-' + file;
  clearTimeout(this.changeTimers[key]);
  this.changeTimers[key] = setTimeout(function() {
    this.changeTimers[key] = null;
    this.emit(type, file);
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

function recReaddir(dir, dirCallback, fileCallback, endCallback) {
  walker(dir)
    .on('dir', dirCallback)
    .on('file', fileCallback)
    .on('end', endCallback);
}
