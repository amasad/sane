var fs = require('fs');
var sane = require('../');
var rimraf = require('rimraf');
var path = require('path');
var assert = require('assert');

var testdir = '/private/tmp/sane_test';
before(function() {
  rimraf.sync(testdir);
    try {
    fs.mkdirSync(testdir);
  } catch (e) {}
  for (var i = 0; i < 10; i++) {
    fs.writeFileSync(testdir + '/file_' + i, 'test_' + i);
    var subdir = testdir + '/sub_' + i;
    try {
      fs.mkdirSync(subdir);
    } catch (e) {}
    for (var j = 0; j < 10; j++) {
      fs.writeFileSync(subdir + '/file_' + j, 'test_' + j);
    }
  }
})

describe('sane(file)', function() {
  beforeEach(function () {
    this.watcher = sane(testdir);
  });

  afterEach(function() {
    this.watcher.close();
  });

  it('emits a ready event', function(done) {
    this.watcher.on('ready', done);
  });

  it('change emits event', function(done) {
    var testfile = testdir + '/file_1';
    this.watcher.on('change', function(filepath) {
      assert.equal(filepath, path.relative(testdir, testfile));
      done();
    });
    this.watcher.on('ready', function() {
      fs.writeFileSync(testfile, 'wow');
    });
  });

  it('emits change events for subdir files', function(done) {
    var testfile = testdir + '/sub_1/file_1';
    this.watcher.on('change', function(filepath) {
      assert.equal(filepath, path.relative(testdir, testfile));
      done();
    });
    this.watcher.on('ready', function() {
      fs.writeFileSync(testfile, 'wow');
    });
  });

  it('adding a file will trigger a change', function(done) {
    var testfile = testdir + '/file_x' + Math.floor(Math.random() * 10000);
    this.watcher.on('change', function(filepath) {
      assert.equal(filepath, path.relative(testdir, testfile));
      done();
    });
    this.watcher.on('ready', function() {
      fs.writeFileSync(testfile, 'wow');
    });
  });
});

describe('sane(file, glob)', function() {
  beforeEach(function () {
    this.watcher = sane(testdir, ['**/file_1', '**/file_2']);
  });

  afterEach(function() {
    this.watcher.close();
  });

  it('ignore files according to glob', function (done) {
    var i = 0;
    this.watcher.on('change', function(filepath) {
      assert.ok(filepath.match(/file_(1|2)/), 'only file_1 and file_2');
      if (++i == 2) done();
    });
    this.watcher.on('ready', function() {
      fs.writeFileSync(testdir + '/file_1', 'wow');
      fs.writeFileSync(testdir + '/file_9', 'wow');
      fs.writeFileSync(testdir + '/file_3', 'wow');
      fs.writeFileSync(testdir + '/file_2', 'wow');
    });
  });
});
