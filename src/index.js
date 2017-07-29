'use strict';

const debug = require(`debug`)(`set-npm-auth-token-for-ci`);
const fs = require(`fs`);
const localOrHomeNpmrc = require(`local-or-home-npmrc`);
const registryUrl = require(`registry-url`);
const path = require(`path`);

module.exports = () => setNpmAuthTokenForCI(fs, registryUrl);
module.exports.setNpmAuthTokenForCI = setNpmAuthTokenForCI;

function setNpmAuthTokenForCI(fs, registryUrl) {
  if (!process.env.NPM_TOKEN) {
    throw new Error(`Cannot find NPM_TOKEN set in your environment.`);
  }

  const packageContents = JSON.parse(fs.readFileSync(path.join(process.cwd(), `package.json`)).toString());

  const npmrcFile = localOrHomeNpmrc();
  const contents = fs.readFileSync(npmrcFile).toString();

  // If set, prefer the value of the `packageConfig.registry` property over the value of the registry as set
  // in the user's `.npmrc` file.
  //
  // In one scenario, a package may fetch its dependencies from a virtual registry that is an overlay of a private
  // registry over the public npm registry. Yet, that package is configured to publish directly to the private registry
  // URL. To account for this scenario we need to get the value of the private registry URL and configure it within
  // the `.npmrc` file.
  let registry;
  if (packageContents.publishConfig && packageContents.publishConfig.registry) {
    registry = packageContents.publishConfig.registry;
  } else {
    const scope = packageContents.name.split(`/`)[0];
    registry = registryUrl(scope);
  }

  debug(`using ${registry} registry for current package`);

  const authTokenString = `${registry.replace(/^https?:/, ``)}:_authToken=\${NPM_TOKEN}`;

  debug(`will set authentication token string in ${npmrcFile}`);

  if (contents.indexOf(authTokenString) !== -1) {
    return debug(`npmrc file, ${npmrcFile}, is already setup correctly`);
  }

  debug(`writing authentication token string, ${authTokenString}, to ${npmrcFile}`);

  fs.writeFileSync(npmrcFile, `${contents}\n${authTokenString}\n`);
}
