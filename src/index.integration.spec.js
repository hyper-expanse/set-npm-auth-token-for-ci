'use strict';

/* eslint-disable no-unused-expressions */

const chai = require('chai');
const fs = require('fs');
const { afterEach, beforeEach, describe, it } = require('mocha');
const path = require('path');
const registryUrl = require('registry-url');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const tmp = require('tmp');

const setNpmAuthTokenForCIPackage = require('../');
const { setNpmAuthTokenForCI } = setNpmAuthTokenForCIPackage;

chai.use(sinonChai);
const { expect } = chai;

describe('set-npm-auth-token-for-ci', function () {
  // Setting up our fake project takes longer than the default Mocha timeout.
  this.timeout(20000);

  beforeEach(function () {
    // Switch into a temporary directory to isolate the behavior of this tool from
    // the rest of the environment.
    this.cwd = process.cwd();
    this.tmpDir = tmp.dirSync();
    process.chdir(this.tmpDir.name);

    // Create a stub for the `fs` module that we can pass to `setNpmAuthTokenForCI`. We want to stub
    // filesystem calls, in particular writes, so that we're not exposing the user's home directory to
    // bad tests, or code.
    this.fs = {
      readFileSync: sinon.stub(),
      writeFileSync: sinon.stub()
    };

    /**
     * We stub out the `registry-url` package because if you run `yarn test` to execute this project's unit tests,
     * `yarn test` will inject its own registry into the environment in which the tests are executed. Therefore, `yarn test`
     * will cause the `registry-url` package to return the Yarn package registry, while `npm test`, will cause the
     * `registry-rul` package to return the Npm package registry.
     *
     * We will independently test that `registry-url` returns a package registry with a trailing slash.
     */
    this.registryUrl = sinon.stub();
    this.registryUrl.returns('https://registry.npmjs.org/');

    this.wrapped = () => setNpmAuthTokenForCI(this.fs, this.registryUrl);
  });

  afterEach(function () {
    process.chdir(this.cwd);
  });

  it('should use \'registry-url\' that returns a URL with a trailing slash', () => {
    expect(registryUrl()).to.match(/^.*\/$/);
  });

  it('will fail when no \'package.json\' file exists', function () {
    expect(this.wrapped).to.throw(Error);
    expect(this.fs.writeFileSync).to.not.have.been.called;
  });

  describe('local project \'.npmrc\' file', () => {
    beforeEach(function () {
      // Write out `.npmrc` file into local test directory so that `local-or-home-npmrc`
      // will return a path to that `.npmrc` file, instead of the user's `.npmrc` file.
      fs.writeFileSync('.npmrc', '');

      // Write out `package.json` file into local test directory so that `local-or-home-npmrc`
      // will find the local directory containing the following `package.json` file.
      fs.writeFileSync('package.json', '{"name": "test-package"}');

      this.npmrcFile = path.join(this.tmpDir.name, '.npmrc');

      this.fs.readFileSync
        .withArgs(path.join(process.cwd(), 'package.json'))
        .returns('{"name": "test-package"}');

      this.fs.readFileSync
        .withArgs(this.npmrcFile)
        .returns('');
    });

    it('reads the local project \'.npmrc\' file', function () {
      this.wrapped();
      expect(this.fs.readFileSync).to.have.been.calledWith(this.npmrcFile);
    });

    it('will set authentication token if not already set', function () {
      this.wrapped();
      expect(this.fs.writeFileSync).to.have.been.calledWith(this.npmrcFile, '\n//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n'); // eslint-disable-line no-template-curly-in-string
    });

    it('does nothing when authentication token is already set', function () {
      this.fs.readFileSync
        .withArgs(this.npmrcFile)
        .returns('//registry.npmjs.org/:_authToken=${NPM_TOKEN}'); // eslint-disable-line no-template-curly-in-string

      this.wrapped();
      expect(this.fs.writeFileSync).to.not.have.been.called;
    });

    it('appends authentication token string to \'.npmrc\' file if a real authentication token is already set', function () {
      this.fs.readFileSync
        .withArgs(this.npmrcFile)
        .returns('//registry.npmjs.org/:_authToken=TOKEN');

      this.wrapped();
      expect(this.fs.writeFileSync).to.have.been
        .calledWith(this.npmrcFile, '//registry.npmjs.org/:_authToken=TOKEN\n//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n'); // eslint-disable-line no-template-curly-in-string
    });

    it('will use \'publishConfig\' registry value from \'package.json\' if set', function () {
      this.fs.readFileSync
        .withArgs(path.join(process.cwd(), 'package.json'))
        .returns('{"name": "test-package", "publishConfig": { "registry": "https://example.com/" }}');

      this.wrapped();
      expect(this.fs.writeFileSync).to.have.been.calledWith(this.npmrcFile, '\n//example.com/:_authToken=${NPM_TOKEN}\n'); // eslint-disable-line no-template-curly-in-string
    });

    it('will use \'publishConfig\' registry value from \'package.json\' if set after normalizing ending slash', function () {
      this.fs.readFileSync
        .withArgs(path.join(process.cwd(), 'package.json'))
        .returns('{"name": "test-package", "publishConfig": { "registry": "https://example.com" }}');

      this.wrapped();
      expect(this.fs.writeFileSync).to.have.been.calledWith(this.npmrcFile, '\n//example.com/:_authToken=${NPM_TOKEN}\n'); // eslint-disable-line no-template-curly-in-string
    });

    it('will create a new \'.npmrc\' file if one doesn\'t already exist\'', function () {
      this.fs.readFileSync
        .withArgs(this.npmrcFile)
        .throws(new Error('ENOENT: no such file or directory, open \'.npmrc\''));

      this.wrapped();
      expect(this.fs.writeFileSync).to.have.been.calledWith(this.npmrcFile, '\n//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n'); // eslint-disable-line no-template-curly-in-string
    });
  });
});
