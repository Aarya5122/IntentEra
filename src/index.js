'use strict';

/**
 * src/index.js
 * ------------
 * Optional convenience module that re-exports both Lambda handlers so a
 * single deployed Lambda could host both if that is desired. In the
 * recommended deployment we use two SEPARATE Lambdas pointing at the two
 * dedicated handler files under `src/handler/`.
 */

const { handler: ingestHandler } = require('./handler/ingest');
const { handler: retrieveHandler } = require('./handler/retrieve');

module.exports = {
  ingest: ingestHandler,
  retrieve: retrieveHandler,
};
