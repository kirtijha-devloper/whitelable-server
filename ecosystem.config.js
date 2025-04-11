module.exports = {
  apps: [
    {
      name: "pos-server",
      script: "server.js",
      cwd: "/var/www/pos.abheepay.com/pos-server", // ensure PM2 uses the correct directory
      env: {
        PORT: "5003",
        DB_NAME: "posdb",
        DB_USER: "posuser",
        DB_PASS: "pos@_2525",
        DB_HOST: "localhost",
        DB_DIALECT: "postgres"
      }
    }
  ]
};

