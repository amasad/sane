var fs = require('fs');
var path = require('path');
var watch = require('watch');
var walker = require('walker');
var platform = require('os').platform();
var minimatch = require('minimatch');
var EventEmitter = require('events').EventEmitter;

module.exports = sane;

/**
 * Sugar for creating a watcher.
 *
 * @param {String} dir
 * @param {Array<String>} glob
 * @param {Object} opts
 * @return {Watcher}
 * @public
 */

function sane(dir, glob, opts) {
  opts = opts || {};
  opts.glob = glob;
  return new Watcher(dir, opts);
}

/**
 * Export `Watcher` class.
 */

sane.Watcher = Watcher;

/**
 * Watches `dir`.
 *
 * @class Watcher
 * @param String dir
 * @param {Object} opts
 * @public
 */

function Watcher(dir, opts) {
  opts = opts || {};
  this.persistent = opts.persistent != null
    ? opts.persistent
    : true;
  this.globs = opts.glob || [];
  if (!Array.isArray(this.globs)) this.globs = [this.globs];
  this.watched = Object.create(null);
  this.changeTimers = Object.create(null);
  this.dirRegistery = Object.create(null);
  this.root = path.resolve(dir);
  this.watchdir = this.watchdir.bind(this);
  this.register = this.register.bind(this);
  this.stopWatching = this.stopWatching.bind(this);
  this.filter = this.filter.bind(this);

  if (opts.poll) {
    this.polling = true;
    watch.createMonitor(
      dir,
      { interval: opts.interval || DEFAULT_DELAY , filter: this.filter },
      this.initPoller.bind(this)
    );
  } else {
    this.watchdir(dir);
    recReaddir(
      dir,
      this.watchdir,
      this.register,
      this.emit.bind(this, 'ready')
    );
  }
}

Watcher.prototype.__proto__ = EventEmitter.prototype;

/**
 * Checks a file relative path against the globs array.
 *
 * @param {string} relativePath
 * @return {boolean}
 * @private
 */

Watcher.prototype.isFileIncluded = function(relativePath) {
  var globs = this.globs;
  var matched;
  if (globs.length) {
    for (var i = 0; i < globs.length; i++) {
      if (minimatch(relativePath, globs[i])) {
        matched = true;
        break;
      }
    }
  } else {
    matched = true;
  }
  return matched;
};

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
  var relativePath = path.relative(this.root, filepath);
  if (!this.isFileIncluded(relativePath)) {
    return false;
  }

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
    delete this.dirRegistery[dir][filename];
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
    delete this.dirRegistery[dirpath];
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
    this.normalizeChange.bind(this, dir)
  );
  this.watched[dir] = watcher;

  // Workaround Windows node issue #4337.
  if (platform === 'win32') {
    watcher.on('error', function(error) {
      if (error.code !== 'EPERM') throw error;
    });
  }

  if (this.root !== dir) {
    this.register(dir);
  }
};

/**
 * In polling mode stop watching files and directories, in normal mode, stop
 * watching files.
 *
 * @param {string} filepath
 * @private
 */

Watcher.prototype.stopWatching = function(filepath) {
  if (this.polling) {
    fs.unwatchFile(filepath);
  } else if (this.watched[filepath]) {
    this.watched[filepath].close();
    delete this.watched[filepath];
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
 * On some platforms, as pointed out on the fs docs (most likely just win32)
 * the file argument might be missing from the fs event. Try to detect what
 * change by detecting if something was deleted or the most recent file change.
 *
 * @param {string} dir
 * @param {string} event
 * @param {string} file
 * @public
 */

Watcher.prototype.detectChangedFile = function(dir, event, callback) {
  var found = false;
  var closest = {mtime: 0};
  var c = 0;
  Object.keys(this.dirRegistery[dir]).forEach(function(file, i, arr) {
    fs.stat(path.join(dir, file), function(error, stat) {
      if (found) return;
      if (error) {
        if (error.code === 'ENOENT') {
          found = true;
          callback(file);
        } else {
          this.emit('error', error);
        }
      } else {
        if (stat.mtime > closest.mtime) {
          stat.file = file;
          closest = stat;
        }
        if (arr.length === ++c) {
          callback(closest.file);
        }
      }
    }.bind(this));
  }, this);
};

/**
 * Normalize fs events and pass it on to be processed.
 *
 * @param {string} dir
 * @param {string} event
 * @param {string} file
 * @public
 */

Watcher.prototype.normalizeChange = function(dir, event, file) {
  if (!file) {
    this.detectChangedFile(dir, event, function(actualFile) {
      if (actualFile) {
        this.processChange(dir, event, actualFile);
      }
    }.bind(this));
  } else {
    this.processChange(dir, event, path.normalize(file));
  }
};

/**
 * Process changes.
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
      // win32 emits usless change events on dirs.
      if (event !== 'change') {
        this.watchdir(fullPath);
        this.emitEvent(ADD_EVENT, relativePath);
      }
    } else {
      var registered = this.registered(fullPath);
      if (error && error.code === 'ENOENT') {
        this.unregister(fullPath);
        this.stopWatching(fullPath);
        this.unregisterDir(fullPath);
        if (registered) {
          this.emitEvent(DELETE_EVENT, relativePath);
        }
      } else if (registered) {
        this.emitEvent(CHANGE_EVENT, relativePath);
      } else {
        if (this.register(fullPath)) {
          this.emitEvent(ADD_EVENT, relativePath);
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
    delete this.changeTimers[key];
    this.emit(type, file);
  }.bind(this), DEFAULT_DELAY);
};

/**
 * Initiate the polling file watcher with the event emitter passed from
 * `watch.watchTree`.
 *
 * @param {EventEmitter} monitor
 * @public
 */

Watcher.prototype.initPoller = function(monitor) {
  this.watched = monitor.files;
  monitor.on('changed', this.pollerEmit.bind(this, CHANGE_EVENT));
  monitor.on('removed', this.pollerEmit.bind(this, DELETE_EVENT));
  monitor.on('created', this.pollerEmit.bind(this, ADD_EVENT));
  // 1 second wait because mtime is second-based.
  setTimeout(this.emit.bind(this, 'ready'), 1000);
};

/**
 * Transform and emit an event comming from the poller.
 *
 * @param {EventEmitter} monitor
 * @public
 */

Watcher.prototype.pollerEmit = function(type, file) {
  file = path.relative(this.root, file);
  this.emit(type, file);
};

/**
 * Given a fullpath of a file or directory check if we need to watch it.
 *
 * @param {string} filepath
 * @param {object} stat
 * @public
 */

Watcher.prototype.filter = function(filepath, stat) {
  return stat.isDirectory() || this.isFileIncluded(
    path.relative(this.root, filepath)
  );
};

/**
 * Constants
 */

var DEFAULT_DELAY = 100;
var CHANGE_EVENT = 'change';
var DELETE_EVENT = 'delete';
var ADD_EVENT = 'add';

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
    .on('dir', normalizeProxy(dirCallback))
    .on('file', normalizeProxy(fileCallback))
    .on('end', function() {
      if (platform === 'win32') {
        setTimeout(endCallback, 1000);
      } else {
        endCallback();
      }
    });
}

/**
 * Returns a callback that when called will normalize a path and call the
 * original callback
 *
 * @param {function} callback
 * @return {function}
 * @private
 */

function normalizeProxy(callback) {
  return function(filepath) {
    return callback(path.normalize(filepath));
  }
}
