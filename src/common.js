'use strict';

var minimatch = require('minimatch');

/**
 * Constants
 */

exports.DEFAULT_DELAY = 100;
exports.CHANGE_EVENT = 'change';
exports.DELETE_EVENT = 'delete';
exports.ADD_EVENT = 'add';
exports.ALL_EVENT = 'all';

/**
 * Assigns options to the watcher.
 *
 * @param {NodeWatcher|PollWatcher|WatchmanWatcher} watcher
 * @param {?object} opts
 * @return {boolean}
 * @public
 */

exports.assignOptions = function(watcher, opts) {
  opts = opts || {};
  watcher.globs = opts.glob || [];
  watcher.ignore = opts.ignore || [];
  watcher.dot = opts.dot || false;
  if (!Array.isArray(watcher.globs)) {
    watcher.globs = [watcher.globs];
  }
  if (!Array.isArray(watcher.ignore)) {
    watcher.ignore = [watcher.ignore];
  }
  return opts;
};

/**
 * Checks a file relative path against the globs array.
 *
 * @param {array} globs
 * @param {string} relativePath
 * @return {boolean}
 * @public
 */

exports.isFileIncluded = function(globs, dot, ignore, relativePath) {
  var matched = false;
  var i;
  var l;
  if (ignore.length) {
    for (i = 0, l = ignore.length; i < l; i++) {
      if (minimatch(relativePath, ignore[i])) {
        return false;
      }
    }
  }
  if (globs.length) {
    for (i = 0, l = globs.length; i < l; i++) {
      if (minimatch(relativePath, globs[i], {dot: dot})) {
        matched = true;
        break;
      }
    }
  } else {
    // Make sure we honor the dot option if even we're not using globs.
    if (!dot) {
      matched = minimatch(relativePath, '**/*', {dot: false});
    } else {
      matched = true;
    }
  }
  return matched;
};
