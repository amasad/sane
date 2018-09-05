'use strict';

const { spawn } = require('child_process');
const promisify = require('util.promisify');

const fs = require('fs');
const path = require('path');
const common = require('./common');
const EventEmitter = require('events').EventEmitter;

const { EOL } = require('os');

const statPromise = promisify(fs.stat);

/**
 * Constants
 */

const CHANGE_EVENT = common.CHANGE_EVENT;
const DELETE_EVENT = common.DELETE_EVENT;
const ADD_EVENT = common.ADD_EVENT;
const ALL_EVENT = common.ALL_EVENT;

/**
 * Export `WatchexecWatcher` class.
 * Watches `dir`.
 *
 * @class WatchexecWatcher
 * @param String dir
 * @param {Object} opts
 * @public
 */

module.exports = class WatchexecWatcher extends EventEmitter {
  constructor(dir, opts) {
    super();

    common.assignOptions(this, opts);

    this.root = path.resolve(dir);

    this._process = spawn(
      'watchexec',
      ['-n', '--', 'node', __dirname + '/watchexec_client.js'],
      { cwd: dir }
    );

    this._process.stdout.on('data', data => {
      data
        .toString()
        .split(EOL)
        .filter(Boolean)
        .map(line => {
          const [, command, path] = [
            ...line.match(/(rename|write|remove|create)\s(.+)/),
          ];
          return [command, path];
        })
        .forEach(([command, file]) => {
          let typeMap = {
            rename: CHANGE_EVENT,
            write: CHANGE_EVENT,
            remove: DELETE_EVENT,
            create: ADD_EVENT,
          };
          let statPromise;
          let type = typeMap[command];
          if (type === DELETE_EVENT) {
            statPromise = Promise.resolve();
          } else {
            statPromise = this._statPromise(file);
          }
          statPromise.then(stat => {
            this.emitEvent(type, path.relative(this.root, file), stat);
          });
        });
    });
  }

  _statPromise(fullPath) {
    console.log('FULL_PATH', fullPath);
    return statPromise(fullPath).catch(() => undefined);
  }

  close(callback) {
    this.removeAllListeners();
    this._process && !this._process.killed && this._process.kill();
    if (typeof callback === 'function') {
      setImmediate(callback.bind(null, null, true));
    }
  }

  /**
   * Initiate the polling file watcher with the event emitter passed from
   * `watch.watchTree`.
   *
   * @param {EventEmitter} monitor
   * @public
   */

  init(monitor) {
    this.watched = monitor.files;
    monitor.on('changed', this.emitEvent.bind(this, CHANGE_EVENT));
    monitor.on('removed', this.emitEvent.bind(this, DELETE_EVENT));
    monitor.on('created', this.emitEvent.bind(this, ADD_EVENT));
    // 1 second wait because mtime is second-based.
    setTimeout(this.emit.bind(this, 'ready'), 1000);
  }

  /**
   * Transform and emit an event comming from the poller.
   *
   * @param {EventEmitter} monitor
   * @public
   */

  emitEvent(type, file, stat) {
    console.log(type, file, !!stat);
    this.emit(type, file, this.root, stat);
    this.emit(ALL_EVENT, type, file, this.root, stat);
  }
};
