// Tests Node hors Next.js : neutralise le garde-fou « server-only » (qui n'a de sens que dans le bundle client).
const path = require.resolve('server-only');
require.cache[path] = { id: path, filename: path, loaded: true, exports: {} };
