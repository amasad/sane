/* eslint-env node, mocha */
'use strict';

const { _messageHandler: handler } = require('../src/watchexec_watcher');
const EventEmitter = require('events').EventEmitter;
const assert = require('assert');
const { Stats } = require('fs');
const { relative } = require('path');

class WatcherMock extends EventEmitter {
  constructor() {
    super();
    this.root = '/';
  }

  receive(stream) {
    handler.call(this, stream);
  }
  emitEvent() {
    assert.fail('you must override this method in your test');
  }
}

describe('Watchexec handler', function() {
  beforeEach(function() {
    this.mock = new WatcherMock();
    this.makeBuffer = function(str) {
      return Buffer.from(str || '', 'utf8');
    };
  });

  it('does not send events on empty strings', function() {
    this.mock.emitEvent = function() {
      assert.fail('it should not be called never called');
    };
    this.mock.receive(this.makeBuffer(''));
    this.mock.receive(
      this.makeBuffer(`


    `)
    );
  });

  it('does not send events on malformed strings', function() {
    this.mock.emitEvent = function() {
      assert.fail('it should not be called never called');
    };
    this.mock.receive(this.makeBuffer('sorry not sorry:'));
    this.mock.receive(
      this.makeBuffer(`
      never gonna give you up
      never gonna let you down
    `)
    );
  });

  it('does not send events on malformed strings', function() {
    this.mock.emitEvent = function() {
      assert.fail('it should not be called never called');
    };
    this.mock.receive(this.makeBuffer('sorry not sorry:'));
    this.mock.receive(
      this.makeBuffer(`
      never gonna give you up
      never gonna let you down
    `)
    );
  });

  it('sends the correct event on file creation', function() {
    const mock = this.mock;
    mock.emitEvent = function(type, path, stat) {
      assert.equal(type, 'add');
      assert.equal(path, relative(mock.root, __filename));
      assert.ok(stat instanceof Stats);
    };
    this.mock.receive(this.makeBuffer(`create ${__filename}`));
  });

  it('sends the correct event on file update', function() {
    const mock = this.mock;
    mock.emitEvent = function(type, path, stat) {
      assert.equal(type, 'change');
      assert.equal(path, relative(mock.root, __filename));
      assert.ok(stat instanceof Stats);
    };
    this.mock.receive(this.makeBuffer(`write ${__filename}`));
  });

  it('sends the correct event on file renaming', function() {
    const mock = this.mock;
    mock.emitEvent = function(type, path, stat) {
      assert.equal(type, 'change');
      assert.equal(path, relative(mock.root, __filename));
      assert.ok(stat instanceof Stats);
    };
    this.mock.receive(this.makeBuffer(`rename ${__filename}`));
  });

  it('sends the correct event on file deletion', function() {
    const mock = this.mock;
    mock.emitEvent = function(type, path, stat) {
      assert.equal(type, 'delete');
      assert.equal(path, relative(mock.root, __filename));
      assert.ok(!stat);
    };
    this.mock.receive(this.makeBuffer(`remove ${__filename}`));
  });

  it('handles multiline messages', function() {
    let count = 0;
    this.mock.emitEvent = () => count++;

    this.mock.receive(
      this.makeBuffer(`
remove ${__filename}


create ${__filename}
this is a wrong message, it will be ignored
rename ${__filename}
`)
    );
    if (count !== 3) {
      assert.fail('there should be 3 events');
    }
    assert.ok('everything went well');
  });
});
