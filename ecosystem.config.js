module.exports = {
  apps: [
    {
      name: "pos-server",
      script: "server.js",
      cwd: "/var/www/pos.abheepay.com/pos-server", // ensure PM2 uses the correct directory
      env: {
        NODE_ENV: "production",
        PORT: "5003",
        DB_NAME: "posdb",
        DB_USER: "posuser",
        DB_PASS: "pos@_2525",
        DB_HOST: "localhost",
        DB_DIALECT: "postgres",
        // Redis Configuration for Queue System
        REDIS_HOST: "localhost",  // or your Redis host (e.g., redis-cloud-host.com)
        REDIS_PORT: "6379",       // Default Redis port
        REDIS_PASSWORD: "",       // Leave empty if no password, or set your Redis password
      }
    },
    {
      name: "pos-server-staging",
      script: "server.js",
      cwd: "/var/www/pos-staging.abheepay.com/pos-server",
      env: {
        NODE_ENV: "staging",
        PORT: "5004"
        // DB/redis come from /var/www/pos-staging.abheepay.com/pos-server/.env on the server
      }
    }
  ]
};

