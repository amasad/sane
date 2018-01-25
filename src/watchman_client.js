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

  // local vars initialized in getClient
  var _client;
  var _clientPromise;
  var _wildmatch;
  var _relative_root;
  var _subscriptionId;
  var _watcherMap;
  var _watchmanPath;

  var _clientListeners = null;  // direct listeners from WC to watchman.Client.

  // first time init of local vars. Called again in 'onEnd' if we
  // are reestablishing the connection.
  clearLocalVars();
  
  // Set up the connection to the watchman client. If the optional
  // value watchmanPath is passed in AND we're not already in the
  // middle of setting up the client, use that as the path to the
  // binary. In either case, return a promise that will be fulfilled
  // when the client has been set up and capabilities have been returned.
  function getClient(watchmanPath) {
    var self = this;
    
    if (!_clientPromise) {
      _clientPromise = new Promise((resolve, reject) => {

        let client = new watchman.Client(watchmanPath ? { watchmanBinaryPath: watchmanPath} : {});

        // reset the relevant local values

        client.capabilityCheck(
          {optional: ['wildmatch', 'relative_root']},
          (error, resp) => {
            if (error) {
              reject(error);
            } else {
              _wildmatch = resp.capabilities.wildmatch;
              _relative_root = resp.capabilities.relative_root;
              _client = client;

              setupClientListeners(self);
              resolve(self);
            }
          }
        );
      });
    }

    return _clientPromise;
  }

  function clearLocalVars() {
    if (_client) {
      _client.removeAllListeners();
      _client.end();
    }

    _client = null;
    _clientPromise = null;
    _wildmatch = false;
    _relative_root = false;
    _subscriptionId = 1;
    _watcherMap = {};
    _watchmanPath = null;
  }

  /**
   * This singleton is the only object directly listening to our
   * watchman.Client. Set up our listeners.
   */
  function setupClientListeners(self) {
    _client.on('subscription', onSubscription.bind(self));
    _client.on('error', onError.bind(self));
    _client.on('end', onEnd.bind(self));
  }

  function getSubscription() {
    let val = 'sane_' + _subscriptionId++;
    return val;
  }

  /**
   * Create a new watcherInfo entry for the given watchmanWatcher and 
   * initialize it.
   */
  function createWatcherInfo(watchmanWatcher) {
    let watcherInfo = {
      subscription: getSubscription(),
      watchmanWatcher: watchmanWatcher,           
      root: null,                      // set during 'watch' or 'watch-project'
      relativePath: null,              // same
      since: null,                     // set during 'clock'
      options: null                    // created and set during 'subscribe'.
    };

    _watcherMap[watcherInfo.subscription] = watcherInfo;

    return watcherInfo;
  }

  /**
   * Find an existing watcherInfo instance.
   */
  function getWatcherInfo(subscription) {
    var watcherInfo = _watcherMap[subscription];
    return watcherInfo;
  }

  /**
   * Given a watchmanWatcher and a root, issue the correct 'watch'
   * or 'watch-project' command and handle it with the callback.
   * Because we're operating in 'sane', we'll keep the results
   * of the 'watch' or 'watch-project' here.
   */
  function watch(subscription, root) {
    var self = this;
    
    let promise = new Promise((resolve, reject) => {
      let watcherInfo = getWatcherInfo(subscription);

      if (_relative_root) { 
        _client.command(['watch-project', root], (error, resp) => {
          if (error) {
            reject(error);
          } else {
            watcherInfo.root = resp.watch;
            watcherInfo.relativePath = resp.relative_path ? resp.relative_path : '';
            resolve(resp);
          }
        });
      } else {
        _client.command(['watch', root], (error, resp) => {
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
  }
  
  /**
   * Issue the 'clock' command to get the time value for use with the 'since'
   * option during 'subscribe'.
   */
  function clock(subscription) {
    var self = this;

    let promise = new Promise((resolve, reject) => {
      let watcherInfo = getWatcherInfo(subscription);

      _client.command(['clock', watcherInfo.root], (error, resp) => {
        if (error) {
          reject(error);
        } else {
          watcherInfo.since = resp.clock;
          resolve(resp);
        }
      });
    });

    return promise;
  }

  /**
   * Called from WatchmanWatcher (or this object during reconnect) to create
   * a watcherInfo entry in our _watcherMap and issue a 'subscribe' to the
   * watchman.Client, to be handled in this object.
   */
  function subscribe(watchmanWatcher, root) {
    var self = this;

    let watcherInfo = createWatcherInfo(watchmanWatcher);
    let subscription = watcherInfo.subscription;
    
    let promise = new Promise((resolve, reject) => {
      watch(subscription, root)
        .then((resp) => clock(subscription))
        .then((data) => {
            let watcherInfo = getWatcherInfo(subscription);

            // create the 'bare' options w/o 'since' or relative_root.
            // Store in watcherInfo for later use if we need to reset
            // things after an 'end' caught here.
            let options = watchmanWatcher.createOptions();  
            watcherInfo.options = options;
            
            // Dup the options object so we can add 'relative_root' and 'since'
            // and leave the original options object alone. We'll do this again
            // later if we need to resubscribe after 'end' and reconnect.
            options = Object.assign({}, options);

            if (_relative_root) {
              options.relative_root = watcherInfo.relativePath;
            }

            options.since = watcherInfo.since;

            _client.command(['subscribe',
                             watcherInfo.root,
                             subscription,
                             options],
                            (error, resp) => {
                              if (error) {
                                reject(error);
                              } else {
                                resolve(resp);
                              }
                            });
            console.log("For subscription '" + subscription +
                        "', subscribing against root '" + watcherInfo.root +
                        "', with relative_root = '" + options.relative_root + "'");
        })
        .catch(function(error) {
          console.error("Caught error in subscribe for watchmanWatcher root " + root);
          console.error(error);
          reject(error)
        });
    });

    return promise;
  }

  /**
   * Handle the 'subscription' (file change) event, by calling the 
   * handler on the relevant WatchmanWatcher.
   */
  function onSubscription(resp) {
    let watcherInfo = getWatcherInfo(resp.subscription);
    if (watcherInfo) {
      watcherInfo.watchmanWatcher.handleChangeEvent(resp);
    } else {
      // Note it in the log, but otherwise ignore it
      console.log("WatchmanClient error - received 'subscription' event " +
                  "for non-existent subscription '" +
                  resp.subscription + "'");
    }
  }

  /**
   * Handle the 'error' event by forwarding to the
   * handler on the relevant WatchmanWatcher.
   */
  function onError(error) {
    console.error('Error from watchman in WatchmanClient. Forwarding to WatchmanWatchers');
    console.error(error);
    Object.values(_watcherMap).forEach((watcherInfo) =>
                                       watcherInfo.watchmanWatcher.handleErrorEvent(error));
  }
  
  /**
   * Handle the 'end' event by creating a new watchman.Client and
   * attempting to resubscribe all the existing subscriptions, but
   * without notifying the WatchmanWatchers about it. They should
   * not be aware the connection was lost and recreated.
   * If something goes wrong during any part of the reconnect/setup,
   * call the error handler on each existing WatchmanWatcher.
   */
  function onEnd() {
    console.warn('[sane.WatchmanClient] Warning: Lost connection to watchman, reconnecting..');

    // hold the old watcher map so we use it to recreate all subscriptions.
    let oldWatcherInfos = Object.values(_watcherMap);
    let watchmanPath = _watchmanPath;

    clearLocalVars();
    
    getClient(watchmanPath)
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
  }

  return {
    get wildmatch() {
      return _wildmatch;
    },

    getClient: getClient,
    subscribe: subscribe
  }
}

module.exports = new WatchmanClient()
