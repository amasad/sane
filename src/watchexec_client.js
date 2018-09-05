'use strict';

const {
  WATCHEXEC_COMMON_PATH,
  WATCHEXEC_WRITTEN_PATH,
  WATCHEXEC_RENAMED_PATH,
  WATCHEXEC_REMOVED_PATH,
  WATCHEXEC_CREATED_PATH,
} = process.env;

const { EOL } = require('os');

function toFullPath(arr) {
  return arr.map(path => (WATCHEXEC_COMMON_PATH || '') + path);
}

function withPrefixes(prefixes) {
  return function withPrefix(arr, i) {
    return arr.map(str => {
      return `${prefixes[i]} ${str}`;
    });
  };
}

let allPrefixes = ['write', 'rename', 'remove', 'create'];
let events = [
  WATCHEXEC_WRITTEN_PATH,
  WATCHEXEC_RENAMED_PATH,
  WATCHEXEC_REMOVED_PATH,
  WATCHEXEC_CREATED_PATH,
];

let currentPrefixes = events.map((l, i) => l && allPrefixes[i]).filter(Boolean);

let message = events
  .filter(Boolean)
  .map(str => str.split(':'))
  .map(toFullPath)
  .map(withPrefixes(currentPrefixes))
  .reduce((e, memo) => memo.concat(e), [])
  .join(EOL);

message && console.log(message);
