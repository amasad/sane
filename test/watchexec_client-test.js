/* eslint-env node, mocha */
'use strict';

const extractChanges = require('../src/watchexec_client');
const assert = require('assert');

describe('Watchexec client', function() {
  it('handles single changes', function() {
    // FILE UPDATE
    let env = { WATCHEXEC_WRITTEN_PATH: '/path/to/file' };
    assert.equal(extractChanges(env), 'write /path/to/file');

    // FILE RENAMING
    env = { WATCHEXEC_RENAMED_PATH: '/path/to/file' };
    assert.equal(extractChanges(env), 'rename /path/to/file');

    // FILE REMOVAL
    env = { WATCHEXEC_REMOVED_PATH: '/path/to/file' };
    assert.equal(extractChanges(env), 'remove /path/to/file');

    // FILE CREATION
    env = { WATCHEXEC_CREATED_PATH: '/path/to/file' };
    assert.equal(extractChanges(env), 'create /path/to/file');
  });

  it('handles multiple changes of the same type', function() {
    let env = {
      WATCHEXEC_WRITTEN_PATH: 'file:second/file',
      WATCHEXEC_COMMON_PATH: '/path/to/',
    };
    assert.equal(
      extractChanges(env),
      `write /path/to/file
write /path/to/second/file`
    );
  });

  it('handles multiple changes of multiple types', function() {
    let env = {
      WATCHEXEC_WRITTEN_PATH: 'file:second/file',
      WATCHEXEC_REMOVED_PATH: 'deleted:second_deletion',
      WATCHEXEC_COMMON_PATH: '/path/to/',
    };
    assert.equal(
      extractChanges(env),
      `remove /path/to/deleted
remove /path/to/second_deletion
write /path/to/file
write /path/to/second/file`
    );
  });
});
