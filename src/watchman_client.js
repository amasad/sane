'use strict';

var watchman = require('fb-watchman');

/**
 * Constants
 */

/**
 * Singleton that provides a public API for a single connection to a watchman instance for 'sane'.
 * It tries to abstract/remove as much of the boilerplate processing as necessary
 * from WatchmanWatchers that use it. In particular, they have no idea whether
 * we're using 'watch-project' or 'watch', what the 'project root' is when
 * we internally use watch-project, whether a connection has been lost
 * and reestablished, etc. Also switched to doing things with promises and known-name
 * methods in WatchmanWatcher, so as much information as possible can be kept in 
 * the WatchmanClient, ultimately making this the only object listening directly
 * to watchman.Client, then forwarding appropriately (via the known-name methods) to 
 * the relevant WatchmanWatcher(s).
 *
 * @class WatchmanClient
 * @param String dir
 * @param {Object} opts
 * @public
 */

function WatchmanClient() {

  // define/clear some local state. The properties will be initialized
  // in getClient(). This is also called again in _onEnd when
  // trying to reestablish connection to watchman.Client.
  this._clearLocalVars(); 

  this._clientListeners = null;  // direct listeners from here to watchman.Client.

  // we may want to call 'getClient()' and return a promise instead later,
  // but for now we'll assume the WatchmanWatchers will not use wildmatch
  // until they've done a getClient to retrieve the instance, so the
  // capabilityCheck call is done.
  Object.defineProperty(this, 'wildmatch', {
    get() { return this._wildmatch; }
  });
}

/**
 * Set up the connection to the watchman client. If the optional
 * value watchmanBinaryPath is passed in AND we're not already in the
 * middle of setting up the client, use that as the path to the
 * binary. In either case, return a promise that will be fulfilled
 * when the client has been set up and capabilities have been returned.
 */
WatchmanClient.prototype.getClient = function(watchmanBinaryPath) {
  
  if (!this._clientPromise) {
    this._clientPromise = new Promise((resolve, reject) => {

      let client = new watchman.Client(watchmanBinaryPath
                                       ? { watchmanBinaryPath: watchmanBinaryPath}
                                       : {});

      // reset the relevant local values

      try {
        client.capabilityCheck(
          {optional: ['wildmatch', 'relative_root']},
          (error, resp) => {
            if (error) {
              reject(error);
            } else {
              this._watchmanBinaryPath = watchmanBinaryPath;
              this._wildmatch = resp.capabilities.wildmatch;
              this._relative_root = resp.capabilities.relative_root;
              this._client = client;

              this._setupClientListeners();
              resolve(this);
            }
          }
        );
      } catch (err) {
        console.error("Client capabilityCheck threw error somehow: " + err);
        // XXX Do something here to throw an error or reject?
      }
    });
  }

  return this._clientPromise;
};

/**
 * Called from WatchmanWatcher (or this object during reconnect) to create
 * a watcherInfo entry in our _watcherMap and issue a 'subscribe' to the
 * watchman.Client, to be handled in this object.
 */
WatchmanClient.prototype.subscribe = function(watchmanWatcher, root) {

  let watcherInfo = this._createWatcherInfo(watchmanWatcher);
  let subscription = watcherInfo.subscription;
  
  return this._watch(subscription, root)
    .then((resp) => this._clock(subscription))
    .then((data) => this._subscribe(subscription))
    .catch((error) => {
      console.error("Caught error in subscribe for watchmanWatcher root " + root);
      console.error(error);
      return Promise.reject(error); // XXX is this right? Or do I just do 'reject(error)'?
    });
};

/**
 * Remove the information about a specific WatchmanWatcher.
 * Once done, if no watchers are left, clear the local vars,
 * which will end the connection to the watchman.Client, too.
 */
WatchmanClient.prototype.closeWatcher = function(watchmanWatcher) {
  let watcherInfos = Object.values(this._watcherMap);
  let numWatchers = watcherInfos.length;

  if (numWatchers > 0) {
    let watcherInfo;
    
    for (let info of watcherInfos) {
      if (info.watchmanWatcher === watchmanWatcher) {
        watcherInfo = info;
        break;
      }
    }

    if (watcherInfo) {
      delete this._watcherMap[watcherInfo.subscription];

      numWatchers--;

      if (numWatchers === 0) {
        this._clearLocalVars();
      }
    }
  }
};

/**
 * Clear out local state at the beginning and if we end up
 * getting disconnected and try to reconnect.
 */
WatchmanClient.prototype._clearLocalVars = function() {
  if (this._client) {
    this._client.removeAllListeners();
    this._client.end();
  }

  this._client = null;
  this._clientPromise = null;
  this._wildmatch = false;
  this._relative_root = false;
  this._subscriptionId = 1;
  this._watcherMap = {};
  this._watchmanBinaryPath = null;
};

/**
 * This singleton is the only object directly listening to our
 * watchman.Client. Set up our listeners.
 */
WatchmanClient.prototype._setupClientListeners = function() {
  this._client.on('subscription', this._onSubscription.bind(this));
  this._client.on('error', this._onError.bind(this));
  this._client.on('end', this._onEnd.bind(this));
};

WatchmanClient.prototype._getSubscription = function() {
  let val = 'sane_' + this._subscriptionId++;
  return val;
};

/**
 * Create a new watcherInfo entry for the given watchmanWatcher and 
 * initialize it.
 */
WatchmanClient.prototype._createWatcherInfo = function(watchmanWatcher) {
  let watcherInfo = {
    subscription: this._getSubscription(),
    watchmanWatcher: watchmanWatcher,           
    root: null,                      // set during 'watch' or 'watch-project'
    relativePath: null,              // same
    since: null,                     // set during 'clock'
    options: null                    // created and set during 'subscribe'.
  };

  this._watcherMap[watcherInfo.subscription] = watcherInfo;

  return watcherInfo;
};

/**
 * Find an existing watcherInfo instance.
 */
WatchmanClient.prototype._getWatcherInfo = function(subscription) {
  var watcherInfo = this._watcherMap[subscription];
  return watcherInfo;
}

/**
 * Given a watchmanWatcher and a root, issue the correct 'watch'
 * or 'watch-project' command and handle it with the callback.
 * Because we're operating in 'sane', we'll keep the results
 * of the 'watch' or 'watch-project' here.
 */
WatchmanClient.prototype._watch = function(subscription, root) {
  
  let promise = new Promise((resolve, reject) => {
    let watcherInfo = this._getWatcherInfo(subscription);

    if (this._relative_root) { 
      this._client.command(['watch-project', root],
                           (error, resp) => {
                             if (error) {
                               reject(error);
                             } else {
                               watcherInfo.root = resp.watch;
                               watcherInfo.relativePath = resp.relative_path
                                 ? resp.relative_path
                                 : '';
                               resolve(resp);
                             }
                           });
    } else {
      this._client.command(['watch', root],
                           (error, resp) => {
                             if (error) {
                               reject(error);
                             } else {
                               watcherInfo.root = root;
                               watcherInfo.relativePath = '';
                               resolve(resp);
                             }
                           });
    }
  });
  
  return promise;
};
  
/**
 * Issue the 'clock' command to get the time value for use with the 'since'
 * option during 'subscribe'.
 */
WatchmanClient.prototype._clock = function(subscription) {
  let promise = new Promise((resolve, reject) => {
    let watcherInfo = this._getWatcherInfo(subscription);

    this._client.command(['clock', watcherInfo.root],
                         (error, resp) => {
                           if (error) {
                             reject(error);
                           } else {
                             watcherInfo.since = resp.clock;
                             resolve(resp);
                           }
                         });
  });

  return promise;
};

/** 
 * Do the internal handling of calling the watchman.Client for
 * a subscription.
 */
WatchmanClient.prototype._subscribe = function(subscription) {
  let promise = new Promise((resolve, reject) => {
    let watcherInfo = this._getWatcherInfo(subscription);

    // create the 'bare' options w/o 'since' or relative_root.
    // Store in watcherInfo for later use if we need to reset
    // things after an 'end' caught here.
    let options = watcherInfo.watchmanWatcher.createOptions();  
    watcherInfo.options = options;
    
    // Dup the options object so we can add 'relative_root' and 'since'
    // and leave the original options object alone. We'll do this again
    // later if we need to resubscribe after 'end' and reconnect.
    options = Object.assign({}, options);

    if (this._relative_root) {
      options.relative_root = watcherInfo.relativePath;
    }

    options.since = watcherInfo.since;

    this._client.command(['subscribe', watcherInfo.root, subscription, options],
                         (error, resp) => {
                           if (error) {
                             reject(error);
                           } else {
                             resolve(resp);
                           }
                         });
  });
  
  return promise;
}

/**
 * Handle the 'subscription' (file change) event, by calling the 
 * handler on the relevant WatchmanWatcher.
 */
WatchmanClient.prototype._onSubscription = function(resp) {
  let watcherInfo = this._getWatcherInfo(resp.subscription);
  if (watcherInfo) {
    watcherInfo.watchmanWatcher.handleChangeEvent(resp);
  } else {
    // Note it in the log, but otherwise ignore it
    console.error("WatchmanClient error - received 'subscription' event " +
                  "for non-existent subscription '" +
                  resp.subscription + "'");
  }
};

/**
 * Handle the 'error' event by forwarding to the
 * handler on the relevant WatchmanWatcher.
 */
WatchmanClient.prototype._onError = function(error) {
  Object.values(this._watcherMap).forEach((watcherInfo) =>
                                          watcherInfo.watchmanWatcher.handleErrorEvent(error));
};

/**
 * Handle the 'end' event by creating a new watchman.Client and
 * attempting to resubscribe all the existing subscriptions, but
 * without notifying the WatchmanWatchers about it. They should
 * not be aware the connection was lost and recreated.
 * If something goes wrong during any part of the reconnect/setup,
 * call the error handler on each existing WatchmanWatcher.
 */
WatchmanClient.prototype._onEnd = function() {
  console.warn('[sane.WatchmanClient] Warning: Lost connection to watchman, reconnecting..');

  // Hold the old watcher map so we use it to recreate all subscriptions.
  // Hold the old watchmanBinaryPath because it should not have changed.
  let oldWatcherInfos = Object.values(this._watcherMap);
  let watchmanBinaryPath = this._watchmanBinaryPath;

  clearLocalVars();
  
  this.getClient(watchmanBinaryPath)
    .then(
      (client) => {
        let promises = oldWatcherInfos.map((watcherInfo) =>
                                           subscribe(watcherInfo.watchmanWatcher,
                                                     watcherInfo.watchmanWatcher.root));
        Promise.all(promises)
          .then(
            (resultArray) => {
              console.log('[sane.WatchmanClient]: Reconnected to watchman');
            },
            (error) => {
              console.error("Reconnected to watchman, but failed to reestablish " +
                            "at least one subscription, cannot continue");
              console.error(error);
              oldWatcherInfos.forEach((watcherInfo) =>
                                      watcherInfo.watchmanWatcher.handleErrorEvent(error));
              // XXX not sure whether to clear all _watcherMap instances here,
              // but basically this client is inconsistent now, since at least one
              // subscribe failed. 
            });
      },
      (error) => {
        console.error('Lost connection to watchman, reconnect failed, cannot continue');
        console.error(error);
        oldWatcherInfos.forEach((watcherInfo) =>
                                watcherInfo.watchmanWatcher.handleErrorEvent(error));
      });
};

module.exports = new WatchmanClient()
