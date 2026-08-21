// global test setup: ensure tests run with sqlite in-memory
process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';
