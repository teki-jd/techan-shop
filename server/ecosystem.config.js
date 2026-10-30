// pm2 进程守护配置
// 用法：pm2 start ecosystem.config.js && pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'techan-shop',
      script: 'index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      // 内存超了自动重启（1G 小机器建议 300M）
      max_memory_restart: '300M',
      // 崩溃自动拉起，但连续快速崩溃时不要无限重试
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '127.0.0.1'
      },
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true
    }
  ]
}
