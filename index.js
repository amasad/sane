'use strict';

const NodeWatcher = require('./src/node_watcher');
const PollWatcher = require('./src/poll_watcher');
const WatchmanWatcher = require('./src/watchman_watcher');
const FSEventsWatcher = require('./src/fsevents_watcher');
const WatchDetector = require('watch-detector');

function sane(dir, options) {
  options = options || {};
  if (options.watcher) {
    const WatcherClass = require(options.watcher);
    return new WatcherClass(dir, options);
  } else if (options.poll) {
    return new PollWatcher(dir, options);
  } else if (options.watchman) {
    return new WatchmanWatcher(dir, options);
  } else if (options.fsevents) {
    return new FSEventsWatcher(dir, options);
  } else if (options.auto) {
    const detector = new WatchDetector({
      fs: require('fs'),
      root: dir,
      ui: {
        writeLine(message) {
          console.log(message);
        },
      },
    });
    return sane(dir, detector.findBestWatcherOption(options));
  } else {
    return new NodeWatcher(dir, options);
  }
}

module.exports = sane;
sane.NodeWatcher = NodeWatcher;
sane.PollWatcher = PollWatcher;
sane.WatchmanWatcher = WatchmanWatcher;
sane.FSEventsWatcher = FSEventsWatcher;
