var fs = require('fs');
var os = require('os');
var path = require('path');
var walker = require('walker');
var minimatch = require('minimatch');
var EventEmitter = require('events').EventEmitter;

var isMac = os.platform() === 'darwin';

/**
 * Conditional dep.
 */

var fsevents;
if (isMac) {
  fsevents = require('fsevents');
}

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
 * @param {Array<string>} globs
 */

function Watcher(files, globs) {
  this.globs = globs || [];
  if (!Array.isArray(files)) files = [files];
  this.onChange = this.onChange.bind(this);
  this.processItem = this.processItem.bind(this);
  this.watchers = [];
  this.fileCount = 0;
  for (var i = 0; i < files.length; i++) {
    this.processItem(files[i]);
  }
}

Watcher.prototype.__proto__ = EventEmitter.prototype;

/**
 * Process a file or directory.
 *
 * @param {string} file
 * @private
 */

Watcher.prototype.processItem = function(file) {
  this.fileCount++;
  fs.stat(file, function (err, stat) {
    if (isMac) {
      this.watchFile(file);
    } else if (stat.isDirectory()) {
      this.fileCount -= 1;
      recReaddir(file, this.processItem);
    } else {
      this.watchFile(file);
    }
  }.bind(this));
};

/**
 * Watch a file or directory.
 *
 * @param {string} file
 * @private
 */

Watcher.prototype.watchFile = function(file) {
  var watcher;
  if (isMac) {
    watcher = createFSEventsWatcher(file, this.onChange);
  } else {
    watcher = fs.watch(file, function(event, filename) {
      if (event === 'change') {
        this.onChange(filename);
      }
    });
  }
  this.watchers.push(watcher);
  this.fileCount -= 1;
  if (this.fileCount === 0) {
    this.emit('ready');
  }
};

/**
 * End watching.
 *
 * @public
 */

Watcher.prototype.close = function() {
  var watchers = this.watchers;
  for (var i = 0; i < watchers.length; i++) {
    if (watchers[i].stop) {
      watchers[i].stop();
    } else {
      watchers[i].close();
    }
  }
  this.removeAllListeners();
};

/**
 * End watching.
 *
 * @public
 */

Watcher.prototype.onChange = function(file) {
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
};

/**
 * Create an FSEvents based watcher.
 *
 * @param {string} filepath
 * @param {function} callback
 * @return {FSEvents}
 * @private
 */

function createFSEventsWatcher(filepath, callback) {
  var watcher = fsevents(filepath);
  watcher.on('fsevent', function(filepath, flags) {
    var info = fsevents.getInfo(filepath, flags);
    if (info.event === 'modified') {
      callback(filepath);
    }
  });
  return watcher;
}

/**
 * Traverse a directory recursively calling `cb` on every file.
 *
 * @param {string} dir
 * @param {function} cb
 * @private
 */

function recReaddir(dir, cb) {
  walker(dir).on('file', cb);
}
