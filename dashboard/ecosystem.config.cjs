module.exports = {
  apps: [
    {
      name: "charon-dashboard",
      cwd: "/opt/charon/dashboard",
      script: "./node_modules/.bin/next",
      args: ["start", "--hostname", "127.0.0.1", "--port", "3000"],
      env: {
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: "3000",
        CHARON_DB_PATH: "/opt/charon/charon.sqlite",
      },
      autorestart: true,
      max_restarts: 10,
      time: true,
      out_file: "/var/log/pm2/charon-dashboard.out.log",
      error_file: "/var/log/pm2/charon-dashboard.err.log",
      merge_logs: true,
    },
  ],
};
