var os = require('os');
var fs = require('fs');
var sane = require('../');
var rimraf = require('rimraf');
var path = require('path');
var assert = require('assert');

var tmpdir = os.tmpdir();
var jo = path.join.bind(path);
var testdir = jo(tmpdir, 'sane_test');


describe('sane in polling mode', function() {
  harness.call(this, true);
});
describe('sand in normal mode', function() {
  harness.call(this, false);
});

function harness(isPolling) {
  if (isPolling) this.timeout(5000);
  before(function() {
    rimraf.sync(testdir);
      try {
      fs.mkdirSync(testdir);
    } catch (e) {}
    for (var i = 0; i < 10; i++) {
      fs.writeFileSync(jo(testdir, 'file_' + i), 'test_' + i);
      var subdir = jo(testdir, 'sub_' + i);
      try {
        fs.mkdirSync(subdir);
      } catch (e) {}
      for (var j = 0; j < 10; j++) {
        fs.writeFileSync(jo(subdir, 'file_' + j), 'test_' + j);
      }
    }
  });

  describe('sane(file)', function() {
    beforeEach(function () {
      this.watcher = new sane.Watcher(testdir, { poll: isPolling });
    });

    afterEach(function() {
      this.watcher.close();
    });

    it('emits a ready event', function(done) {
      this.watcher.on('ready', done);
    });

    it('change emits event', function(done) {
      var testfile = jo(testdir, 'file_1');
      this.watcher.on('change', function(filepath) {
        assert.equal(filepath, path.relative(testdir, testfile));
        done();
      });
      this.watcher.on('ready', function() {
        fs.writeFileSync(testfile, 'wow');
      });
    });

    it('emits change events for subdir files', function(done) {
      var testfile = jo(testdir, 'sub_1', 'file_1');
      this.watcher.on('change', function(filepath) {
        assert.equal(filepath, path.relative(testdir, testfile));
        done();
      });
      this.watcher.on('ready', function() {
        fs.writeFileSync(testfile, 'wow');
      });
    });

    it('adding a file will trigger a change', function(done) {
      var testfile = jo(testdir, 'file_x' + Math.floor(Math.random() * 10000));
      this.watcher.on('add', function(filepath) {
        assert.equal(filepath, path.relative(testdir, testfile));
        done();
      });
      this.watcher.on('ready', function() {
        fs.writeFileSync(testfile, 'wow');
      });
    });

    it('removing a file will emit delete event', function(done) {
      var testfile = jo(testdir, 'file_9');
      this.watcher.on('delete', function(filepath) {
        assert.equal(filepath, path.relative(testdir, testfile));
        done();
      });
      this.watcher.on('ready', function() {
        fs.unlinkSync(testfile);
      });
    });

    it('removing a dir will emit delete event', function(done) {
      var subdir = jo(testdir, 'sub_9');
      this.watcher.on('delete', function(filepath) {
        // Ignore delete events for files in the dir.
        if (path.dirname(filepath) === path.relative(testdir, subdir)) {
          return;
        }
        assert.equal(filepath, path.relative(testdir, subdir));
        done();
      });
      this.watcher.on('ready', function() {
        rimraf.sync(subdir);
      });
    });

    it('adding a dir will emit an add event', function(done) {
      var subdir = jo(testdir, 'sub_x' + Math.floor(Math.random() * 10000));
      this.watcher.on('add', function(filepath) {
        assert.equal(filepath, path.relative(testdir, subdir));
        done();
      });
      this.watcher.on('ready', function() {
        fs.mkdirSync(subdir);
      });
    });

    it('adding in a new subdir will trigger an add event', function(done) {
      var subdir = jo(testdir, 'sub_x' + Math.floor(Math.random() * 10000));
      var testfile = jo(subdir, 'file_x' + Math.floor(Math.random() * 10000));
      var i = 0;
      this.watcher.on('add', function(filepath) {
        if (++i === 1) {
          assert.equal(filepath, path.relative(testdir, subdir));
        } else {
          assert.equal(filepath, path.relative(testdir, testfile));
          done();
        }
      });
      this.watcher.on('ready', function() {
        fs.mkdirSync(subdir);
        defer(function() {
          fs.writeFileSync(testfile, 'wow');
        });
      });
    });

    it('closes watchers when dirs are deleted', function(done) {
      var subdir = jo(testdir, 'sub_1');
      var testfile = jo(subdir, 'file_1');
      var i = 0;
      var actualFiles = {};
      this.watcher.on('ready', function() {
        this.watcher.on('add', function(filepath) {
          actualFiles[filepath] = true;
          if (Object.keys(actualFiles).length === 2) {
            // win32 order is not guaranteed
            var expectedFiles = {};
            expectedFiles[path.relative(testdir, subdir)] = true;
            expectedFiles[path.relative(testdir, testfile)] = true;
            assert.deepEqual(
              expectedFiles,
              actualFiles
            );
            done();
          }
        });
        rimraf.sync(subdir);
        defer(function() {
          fs.mkdirSync(subdir);
          defer(function() {
            fs.writeFileSync(testfile, 'wow');
          });
        });
      }.bind(this));
    });

    it('should be ok to remove and then add the same file', function(done) {
      var testfile = jo(testdir, 'sub_8', 'file_1');
      var i = 0;
      this.watcher.on('add', function(filepath) {
        assert.equal(filepath, path.relative(testdir, testfile));
      });
      this.watcher.on('delete', function(filepath) {
        assert.equal(filepath, path.relative(testdir, testfile));
        done();
      });
      this.watcher.on('ready', function() {
        fs.unlink(testfile);
        defer(function() {
          fs.writeFileSync(testfile, 'wow');
        });
      });
    });
  });

  describe('sane(file, glob)', function() {
    beforeEach(function () {
      this.watcher = new sane.Watcher(
        testdir,
        { glob: ['**/file_1', '**/file_2'], poll: isPolling }
      );
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
        fs.writeFileSync(jo(testdir, 'file_1'), 'wow');
        fs.writeFileSync(jo(testdir, 'file_9'), 'wow');
        fs.writeFileSync(jo(testdir, 'file_3'), 'wow');
        fs.writeFileSync(jo(testdir, 'file_2'), 'wow');
      });
    });
  });

  describe('sane shortcut alias', function () {
    
    beforeEach(function () {
      this.watcher = sane(testdir, '**/file_1');
    });

    afterEach(function() {
      this.watcher.close();
    });

    it('allows for shortcut mode using just a string as glob', function (done) { 
      this.watcher.on('change', function (filepath) {
        assert.ok(filepath.match(/file_1/));
        done();
      });
      this.watcher.on('ready', function() {
        fs.writeFileSync(jo(testdir, 'file_1'), 'wow');
      });
    });
  });

  function defer(fn) {
    setTimeout(fn, isPolling ? 1000 : 300);
  }

}
