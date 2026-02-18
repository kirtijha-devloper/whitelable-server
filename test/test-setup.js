// global test setup: ensure tests run with sqlite in-memory
process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

// Increase mocha timeout globally if needed
// mocha --timeout can be configured in package.json or CLI; leaving default here.
