'use strict';

/* eslint-disable no-unused-expressions */

const chai = require(`chai`);
const fs = require(`fs`);
const mocha = require(`mocha`);
const path = require(`path`);
const sinon = require(`sinon`);
const sinonChai = require(`sinon-chai`);
const nock = require('nock');
const tmp = require(`tmp`);

const setNpmAuthTokenForCIPackage = require(`./index`);
const setNpmAuthTokenForCI = setNpmAuthTokenForCIPackage.setNpmAuthTokenForCI;

chai.use(sinonChai);
var expect = chai.expect;

const afterEach = mocha.afterEach;
const before = mocha.before;
const beforeEach = mocha.beforeEach;
const describe = mocha.describe;
const it = mocha.it;

describe(`semantic-release-gitlab`, function () {
  // Setting up our fake project takes longer than the default Mocha timeout.
  this.timeout(20000);

  before(function () {
    nock.disableNetConnect();
  });

  beforeEach(function () {
    // Switch into a temporary directory to isolate the behavior of this tool from
    // the rest of the environment.
    this.cwd = process.cwd();
    this.tmpDir = tmp.dirSync();
    process.chdir(this.tmpDir.name);

    this.oldToken = process.env.NPM_TOKEN;
    process.env.NPM_TOKEN = `token`;

    // Create a stub for the `fs` module that we can pass to `setNpmAuthTokenForCI`. We want to stub
    // filesystem calls, in particular writes, so that we're not exposing the user's home directory to
    // bad tests, or code.
    this.fs = {
      readFileSync: sinon.stub(),
      writeFileSync: sinon.stub(),
    };

    this.registryUrl = sinon.stub();
    this.registryUrl.returns(`https://registry.npmjs.org/`);

    this.wrapped = () => setNpmAuthTokenForCI(this.fs, this.registryUrl);
  });

  afterEach(function () {
    process.env.NPM_TOKEN = this.oldToken;
    process.chdir(this.cwd);
  });

  it(`will fail fast from the package entry point if NPM_TOKEN is not set in the environment`, function () {
    delete process.env.NPM_TOKEN;

    // Ensures our main execution path is connected correctly to the method containing all the functionality.
    expect(setNpmAuthTokenForCIPackage).to.throw(Error, `Cannot find NPM_TOKEN set in your environment.`);
  });

  it(`will fail fast if NPM_TOKEN is not set in the environment`, function () {
    // Fail fast by checking existence of `NPM_TOKEN`, before any file operations take place.
    delete process.env.NPM_TOKEN;
    expect(this.wrapped).to.throw(Error);
    expect(this.fs.readFileSync).to.not.have.been.called;
    expect(this.fs.writeFileSync).to.not.have.been.called;
  });

  it(`will fail when no 'package.json' file exists`, function () {
    expect(this.wrapped).to.throw(Error);
    expect(this.fs.writeFileSync).to.not.have.been.called;
  });

  describe(`local project '.npmrc' file`, function () {
    beforeEach(function () {
      // Write out `.npmrc` file into local test directory so that `local-or-home-npmrc`
      // will return a path to that `.npmrc` file, instead of the user's `.npmrc` file.
      fs.writeFileSync(`.npmrc`, ``);

      // Write out `package.json` file into local test directory so that `local-or-home-npmrc`
      // will find the local directory containing the following `package.json` file.
      fs.writeFileSync(`package.json`, `{"name": "test-package"}`);

      this.npmrcFile = path.join(this.tmpDir.name, `.npmrc`);

      this.fs.readFileSync
        .withArgs(path.join(process.cwd(), `package.json`))
        .returns(`{"name": "test-package"}`);

      this.fs.readFileSync
        .withArgs(this.npmrcFile)
        .returns(``);
    });

    it(`reads the local project '.npmrc' file`, function () {
      this.wrapped();
      expect(this.fs.readFileSync).to.have.been.calledWith(this.npmrcFile);
    });

    it(`will set authentication token if not already set`, function () {
      this.wrapped();
      expect(this.fs.writeFileSync).to.have.been.calledWith(this.npmrcFile, `\n//registry.npmjs.org/:_authToken=\${NPM_TOKEN}\n`);
    });

    it(`does nothing when authentication token is already set`, function () {
      this.fs.readFileSync
        .withArgs(this.npmrcFile)
        .returns(`//registry.npmjs.org/:_authToken=\${NPM_TOKEN}`);

      this.wrapped();
      expect(this.fs.writeFileSync).to.not.have.been.called;
    });

    it(`appends authentication token string to '.npmrc' file if a real authentication token is already set`, function () {
      this.fs.readFileSync
        .withArgs(this.npmrcFile)
        .returns(`//registry.npmjs.org/:_authToken=TOKEN`);

      this.wrapped();
      expect(this.fs.writeFileSync).to.have.been
        .calledWith(this.npmrcFile, `//registry.npmjs.org/:_authToken=TOKEN\n//registry.npmjs.org/:_authToken=\${NPM_TOKEN}\n`);
    });

    it(`will use 'publishConfig' registry value from 'package.json' if set`, function () {
      this.fs.readFileSync
        .withArgs(path.join(process.cwd(), `package.json`))
        .returns(`{"name": "test-package", "publishConfig": { "registry": "https://example.com/" }}`);

      this.wrapped();
      expect(this.fs.writeFileSync).to.have.been.calledWith(this.npmrcFile, `\n//example.com/:_authToken=\${NPM_TOKEN}\n`);
    });
  });
});
